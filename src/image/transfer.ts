import { App, TFile } from 'obsidian';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getTargetAttachmentFolder } from './attachment-folder';
import type { AttachmentLocationSettings } from './attachment-folder';
import { externalImageRe } from './constants';
import { convertImageBytes, convertPlanFrom, plannedExtension } from './convert';
import type { ConvertPlan } from './convert';
import { resolvePhysicalPath } from './external-path';
import { formatImageName, generateUniqueTargetPath, vaultPathFor } from './naming';
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
	 * 导入的图片顺手转成目标格式（`vaultConvertFormat` + `convertQuality`，见 `image/convert.ts`）。
	 * 解不开的格式 / 转完更大的图按原格式导入，不影响图片进库。`undefined` 当作开。
	 */
	convertImportedImages?: boolean;
	vaultConvertFormat: string;
	convertQuality: string;
}

/**
 * 把**一张已经在内存里**的图片存进附件夹：起名（按最终扩展名）→ 转格式 → 落盘。
 *
 * 两条路共用：正文里的 `file:///…` 导入（`transferImagesInText`）与「粘贴图片」
 * （`tasks.importPastedImages`）。名字怎么起、要不要转格式、批次里怎么预留，只有这一份。
 *
 * @param reservedPaths 批次内已预留的完整路径（整库处理时跨笔记共用）
 * @param reservedBasenames 仓库级 basename 注册表（整库处理时跨笔记共用）
 * @returns 落盘的仓库文件（写盘失败直接抛给调用方，那一张跳过、其余照旧）
 */
export async function importImageBytes(
	app: App,
	settings: TransferSettings,
	folder: string,
	source: { name: string; bytes: ArrayBuffer },
	plan: ConvertPlan | null,
	reservedPaths: Map<string, string>,
	reservedBasenames: Map<string, string>
): Promise<TFile> {
	const ext = path.extname(source.name);
	const now = window.moment();
	// 这张图最终会是什么格式：**名字按最终扩展名生成**（`generateUniqueTargetPath` 只认
	// "文件最终会有的名字"，撞了它自己会往后推一秒）。按源扩展名生成会出这种事：同一批里的
	// png 与 jpg 落在同一秒，两个名字各自"没被占"，可两张最终都叫 `xxx.webp`
	// （2026-09 用户报的"粘贴多张图只有第一张转了 webp"）。
	const planned = plannedExtension(formatImageName(settings.imageNamePreset, ext, now), plan);
	const namingExt = planned ? `.${planned}` : ext;
	const { newFileName, targetVaultPath } = await generateUniqueTargetPath(
		app, settings.imageNamePreset, folder, namingExt, now, reservedPaths, reservedBasenames
	);

	// 转码器要按**源**名字判格式：`formatImageName` 只在末尾加扩展名，换个尾巴就是它
	// （词干一致 —— 连命名推过的那几秒也在）
	const sourceName = namingExt === ext
		? newFileName
		: `${newFileName.slice(0, newFileName.length - namingExt.length)}${ext}`;
	const converted = await convertImageBytes(
		app, { name: sourceName, bytes: source.bytes, folder }, plan
	);

	let finalName = newFileName;
	let finalPath = targetVaultPath;
	if (converted) {
		finalName = converted.name;
		finalPath = vaultPathFor(folder, finalName);
	} else if (planned) {
		// 名字按目标格式生成了，可它没转成（解不开 / 更大 / 编码失败）：换回原扩展名重新要个空位
		const fallback = await generateUniqueTargetPath(
			app, settings.imageNamePreset, folder, ext, now, reservedPaths, reservedBasenames
		);
		finalName = fallback.newFileName;
		finalPath = fallback.targetVaultPath;
	}

	const imported = await app.vault.createBinary(finalPath, converted?.bytes ?? source.bytes);
	if (converted) {
		// 命名时已经占过这个名字；这里再占一次只是兜底，同一批里的后续图片不会撞上它
		reservedPaths.set(finalPath, '');
		reservedBasenames.set(finalName, '');
	}
	return imported;
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
	// 转换计划在整批里只算一次：目标格式认不出来（手改坏了 data.json）就是"不转"
	const plan = settings.convertImportedImages === false
		? null
		: convertPlanFrom(settings.vaultConvertFormat, settings.convertQuality);

	for (const match of matches) {
		const fullMatch = match[0];
		const altPartRaw = match[1] || "";
		const rawLink = match[2] || "";
		const finalPhysicalPath = await resolvePhysicalPath(rawLink);

		if (!finalPhysicalPath) continue;

		try {
			const fileBuffer = await fs.readFile(finalPhysicalPath);
			const arrayBuffer = fileBuffer.buffer.slice(
				fileBuffer.byteOffset,
				fileBuffer.byteOffset + fileBuffer.byteLength
			);

			// 存图（起名 / 转格式 / 落盘）整段复用 `importImageBytes` —— 与「粘贴图片」同一条路
			const imported = await importImageBytes(
				app,
				settings,
				currentAttachFolder,
				{ name: path.basename(finalPhysicalPath), bytes: arrayBuffer },
				plan,
				rp,
				rbn
			);
			created.push(imported);

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
