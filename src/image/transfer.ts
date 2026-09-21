import { App, TFile } from 'obsidian';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getTargetAttachmentFolder } from './attachment-folder';
import type { AttachmentLocationSettings } from './attachment-folder';
import { externalImageRe } from './constants';
import { resolvePhysicalPath } from './external-path';
import { generateUniqueTargetPath } from './naming';
import type { ImageNamingSettings } from './naming';

/**
 * 外部图片导入（从 main.ts 抽出）。
 *
 * 笔记里的 `![说明](file:///D:/图.png)` 这类链接指向磁盘上的绝对路径：
 * Obsidian 在别的机器 / 别的盘符下读不到它，图片等于丢了。
 * 这里把文件**复制**进仓库的附件夹，再把链接换成内部双链 `![[新名字]]`。
 */

/** 导入功能需要的设置项（结构子集，避免依赖 settings/） */
export interface TransferSettings extends AttachmentLocationSettings, ImageNamingSettings {}

/**
 * 处理一篇笔记里的外部绝对路径图片：复制进仓库 + 换成内部双链。
 *
 * 单张图失败不影响其余图片（各自 try/catch，只打日志）。
 *
 * @param reservedPaths 批次内已预留的完整路径（整库处理时跨笔记共用）
 * @param reservedBasenames 仓库级 basename 注册表（整库处理时跨笔记共用）
 * @returns 内容是否真的改了（调用方据此决定要不要写盘）
 */
export async function transferExternalImages(
	app: App,
	settings: TransferSettings,
	file: TFile,
	reservedPaths?: Map<string, string>,
	reservedBasenames?: Map<string, string>
): Promise<boolean> {
	let content = await app.vault.read(file);
	const originalContent = content;

	const matches = Array.from(content.matchAll(externalImageRe()));

	if (matches.length === 0) return false;
	const currentAttachFolder = await getTargetAttachmentFolder(app, settings, file);
	const rp = reservedPaths ?? new Map<string, string>();
	const rbn = reservedBasenames ?? new Map<string, string>();

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

			await app.vault.createBinary(targetVaultPath, arrayBuffer);

			// `![|300](…)` 这种写法里的竖线不是说明文字的一部分，去掉它
			let altText = altPartRaw;
			if (altText.startsWith('|')) {
				altText = altText.substring(1);
			}
			const newLink = `![[${newFileName}${altText ? "|" + altText : ""}]]`;
			content = content.replace(fullMatch, newLink);

		} catch (err) {
			console.error(`❌ 处理图片时出错: ${finalPhysicalPath}`, err);
		}
	}

	if (content !== originalContent) {
		await app.vault.modify(file, content);
		return true;
	}
	return false;
}
