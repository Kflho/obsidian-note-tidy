import { App, TFile } from 'obsidian';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getTargetAttachmentFolder } from './attachment-folder';
import type { AttachmentLocationSettings } from './attachment-folder';
import { externalImageRe } from './constants';
import { resolvePhysicalPath } from './external-path';
import { convertImageBytes, findImageConverter } from './image-converter-bridge';
import type { ConverterHandle } from './image-converter-bridge';
import { generateUniqueTargetPath, vaultPathFor } from './naming';
import type { ImageNamingSettings } from './naming';

/**
 * 外部图片导入（从 main.ts 抽出）。
 *
 * 笔记里的 `![说明](file:///D:/图.png)` 这类链接指向磁盘上的绝对路径：
 * Obsidian 在别的机器 / 别的盘符下读不到它，图片等于丢了。
 * 这里把文件**复制**进仓库的附件夹，再把链接换成内部双链 `![[新名字]]`。
 */

/** 导入功能需要的设置项（结构子集，避免依赖 settings/） */
export interface TransferSettings extends AttachmentLocationSettings, ImageNamingSettings {
	/**
	 * 导入的图片顺手交给 Image Converter 转格式（见 `image-converter-bridge.ts`）。
	 * 它没装 / 转换失败时按原格式导入，不影响图片进库。`undefined` 当作开。
	 */
	handOffImportedImages?: boolean;
}

/**
 * 处理**一段文本**里的外部绝对路径图片：复制进仓库 + 换成内部双链。
 *
 * 这是导入功能的真正内核：`transferExternalImages` 读整篇笔记调它，再写回去；
 * 「排版选中的内容」直接把选中的那段交给它（不必碰文件）。
 *
 * 单张图失败不影响其余图片（各自 try/catch，只打日志）。
 *
 * @param reservedPaths 批次内已预留的完整路径（整库处理时跨笔记共用）
 * @param reservedBasenames 仓库级 basename 注册表（整库处理时跨笔记共用）
 * @returns 处理后的文本 + 内容是否真的改了 + **本次新建的文件**（调用方写回失败时要拿它回滚，
 *   不然就是"图进了库、链接没写上"的孤儿附件）
 */
export async function transferImagesInText(
	app: App,
	settings: TransferSettings,
	file: TFile,
	content: string,
	reservedPaths?: Map<string, string>,
	reservedBasenames?: Map<string, string>
): Promise<{ content: string; changed: boolean; created: TFile[] }> {
	const originalContent = content;
	const created: TFile[] = [];
	const matches = Array.from(content.matchAll(externalImageRe()));

	if (matches.length === 0) return { content, changed: false, created };

	const currentAttachFolder = await getTargetAttachmentFolder(app, settings, file);
	const rp = reservedPaths ?? new Map<string, string>();
	const rbn = reservedBasenames ?? new Map<string, string>();
	// 交接对象在批次里只找一次：它没装就是 null，后面每张图都直接按原格式导入
	const converter: ConverterHandle | null = settings.handOffImportedImages === false
		? null
		: findImageConverter(app);

	for (const match of matches) {
		const fullMatch = match[0];
		const altPartRaw = match[1] || "";
		const rawLink = match[2] || "";
		const finalPhysicalPath = await resolvePhysicalPath(rawLink);

		if (!finalPhysicalPath) continue;

		try {
			const ext = path.extname(finalPhysicalPath);
			const { newFileName, targetVaultPath } = await generateUniqueTargetPath(
				app, settings.imageNamePreset, currentAttachFolder, ext, window.moment(), rp, rbn
			);

			const fileBuffer = await fs.readFile(finalPhysicalPath);
			const arrayBuffer = fileBuffer.buffer.slice(
				fileBuffer.byteOffset,
				fileBuffer.byteOffset + fileBuffer.byteLength
			);

			// 交给 Image Converter 转格式（例如 png → webp）：**先在内存里转、再落盘**，
			// 免得仓库里先多出一个谁也指不到的 png（同步插件可能已经把它传走了）
			const converted = await convertImageBytes(
				app,
				{ name: newFileName, bytes: arrayBuffer, folder: currentAttachFolder },
				converter
			);
			const finalName = converted?.name ?? newFileName;
			const finalPath = converted ? vaultPathFor(currentAttachFolder, finalName) : targetVaultPath;
			const imported = await app.vault.createBinary(finalPath, converted?.bytes ?? arrayBuffer);
			created.push(imported);
			if (converted) {
				// 转换后的名字也要占位：同一批里的后续图片不能再撞上它
				rp.set(finalPath, '');
				rbn.set(finalName, '');
			}

			// `![|300](…)` 这种写法里的竖线不是说明文字的一部分，去掉它
			let altText = altPartRaw;
			if (altText.startsWith('|')) {
				altText = altText.substring(1);
			}
			// 链接用的是**最终**文件名：转了格式就是 `.webp`，没转就是原来的 `.png`
			const newLink = `![[${imported.name}${altText ? "|" + altText : ""}]]`;
			content = content.replace(fullMatch, newLink);

		} catch (err) {
			console.error(`❌ 处理图片时出错: ${finalPhysicalPath}`, err);
		}
	}

	return { content, changed: content !== originalContent, created };
}

/**
 * 丢弃**本次刚导入、还没有任何引用**的图片（写回失败时的回滚）。
 *
 * 为什么要回滚：导入是"先复制文件、再写回链接"两步，中间隔着异步（收图、转码、排版）。
 * 期间编辑器内容一变，调用方就不敢写回了 —— 这时文件已经躺在附件夹里，链接却永远不会出现，
 * 于是攒出一堆谁也指不到的孤儿附件（2026-09 用户库里 40 张就是这么来的）。
 *
 * 走 Obsidian 自己的删除（`fileManager.trashFile` → 用户设置的回收站）；
 * 删不动只记日志：这些文件是我们几毫秒前刚建的，不会覆盖任何已有内容。
 */
export async function discardImportedFiles(app: App, files: TFile[]): Promise<void> {
	for (const file of files) {
		try {
			await app.fileManager.trashFile(file);
		} catch (err) {
			console.error(`⚠️ 回滚导入的图片失败：${file.path}`, err);
		}
	}
}

/**
 * 处理一篇笔记里的外部绝对路径图片：复制进仓库 + 换成内部双链。
 *
 * 写盘失败时把**本次刚导入的文件**一并回滚（否则链接没写上，附件先留在库里 = 孤儿附件），
 * 错误照旧抛给调用方，让批量外壳去汇报。
 *
 * @returns 内容是否真的改了（调用方据此决定要不要写盘）
 */
export async function transferExternalImages(
	app: App,
	settings: TransferSettings,
	file: TFile,
	reservedPaths?: Map<string, string>,
	reservedBasenames?: Map<string, string>
): Promise<boolean> {
	const content = await app.vault.read(file);

	const { content: updated, changed, created } = await transferImagesInText(
		app, settings, file, content, reservedPaths, reservedBasenames
	);

	if (!changed) {
		// 有文件没链接（例如链接原样被替换成同名双链却没改动文字）——一样不能留
		await discardImportedFiles(app, created);
		return false;
	}

	try {
		await app.vault.modify(file, updated);
	} catch (err) {
		await discardImportedFiles(app, created);
		throw err;
	}
	return true;
}
