import { App, TFile, normalizePath } from 'obsidian';
import { getTargetAttachmentFolder } from './attachment-folder';
import type { AttachmentLocationSettings } from './attachment-folder';
import { MANAGED_IMAGE_EXT_RE, wikiEmbedRe } from './constants';
import { buildBasenameIndex, chooseLinkTarget, isImagePath, resolveImageLink } from './links';
import { generateUniqueTargetPath, matchesNamePreset } from './naming';
import type { ImageNamingSettings } from './naming';

/**
 * 图片重命名与链接格式归一（从 main.ts 抽出）。
 *
 * 三件事，共用同一套「文件名在全库唯一」的安全线：
 * 1. **乱码改名**：`%20`、`(1)`、纯数字点号这类自动生成的名字换成预设格式；
 * 2. **全量改名**：把笔记里引用的图片统一改成预设格式（可选强制，连已合规的也改）；
 * 3. **链接格式归一**：改名由 Obsidian 原生接口改写引用，这里只把链接的写法统一。
 *
 * 整库批处理时会跨笔记共用 `reservedPaths` / `reservedBasenames` / `processedFiles`，
 * 这样同一张图被多篇笔记引用时也只处理一次 —— 否则文件名会来回跳。
 */

/** 重命名功能需要的设置项（结构子集，避免依赖 settings/） */
export interface RenameSettings extends AttachmentLocationSettings, ImageNamingSettings {
	/** 链接形式：`full` 完整路径 / `filename` 仅文件名 */
	renameLinkFormat: string;
}

/**
 * 乱码检测：特殊字符 / URL 编码残留 / 纯数字点号命名（明显不是人工取的）。
 *
 * 三条判据任一成立即算乱码：
 * - 含 `\ % { } ( ) [ ] ~ \` ^` 这类从网页、微信、QQ 里带出来的字符；
 * - `decodeURIComponent` 能解出不同结果 → 有 `%20` 这类编码残留；
 * - 主文件名只有数字、点、空格、连字符、下划线，一个字母都没有（`123.456.png`）。
 */
export function isGarbledImageName(rawLink: string): boolean {
	if (/[\\%{}()[\]~`^]/.test(rawLink)) return true;
	try {
		if (decodeURIComponent(rawLink) !== rawLink) return true;
	} catch { /* decodeURIComponent throws on malformed input */ }
	const stem = rawLink.replace(MANAGED_IMAGE_EXT_RE, '');
	if (stem.length > 0 && !/[^\d.\s\-_]/.test(stem)) return true;
	return false;
}

/**
 * 统计一篇笔记里需要重命名的图片数（只读，不改任何内容）。
 *
 * @param force 为 true 时连已符合预设格式的图片也计入
 */
export async function countImages(
	app: App,
	file: TFile,
	index: Map<string, TFile[]>,
	settings: RenameSettings,
	force: boolean
): Promise<number> {
	const content = await app.vault.read(file);
	const matches = Array.from(content.matchAll(wikiEmbedRe()));

	if (matches.length === 0) return 0;

	let count = 0;
	const processedFilePaths = new Set<string>();

	for (const match of matches) {
		if (!match[1]) continue;
		const rawLink = match[1].trim();

		if (!MANAGED_IMAGE_EXT_RE.test(rawLink)) continue;

		const linkedFile = resolveImageLink(app, file.path, rawLink, index).file;
		if (!linkedFile) continue;

		if (processedFilePaths.has(linkedFile.path)) continue;
		processedFilePaths.add(linkedFile.path);

		if (!force && matchesNamePreset(linkedFile.name, settings.imageNamePreset)) continue;

		count++;
	}
	return count;
}

/**
 * 重命名笔记里引用的乱码图片。
 *
 * @param index 全库文件名索引（同一次任务共用，识别同名歧义）
 */
export async function renameGarbledImages(
	app: App,
	settings: RenameSettings,
	file: TFile,
	index: Map<string, TFile[]>,
	reservedPaths?: Map<string, string>,
	reservedBasenames?: Map<string, string>,
	onProgress?: (current: number, total: number) => void
): Promise<number> {
	const content = await app.vault.read(file);
	const matches = Array.from(content.matchAll(wikiEmbedRe()));

	if (matches.length === 0) return 0;

	// 预统计图片链接总数用于进度
	const imageMatches = matches.filter(m => m[1] && MANAGED_IMAGE_EXT_RE.test(m[1].trim()));
	const totalImages = imageMatches.length;

	let renamedCount = 0;
	let processedCount = 0;
	const processedFilePaths = new Set<string>();
	const currentAttachFolder = await getTargetAttachmentFolder(app, settings, file);
	const rp = reservedPaths ?? new Map<string, string>();
	const rbn = reservedBasenames ?? new Map<string, string>();

	for (const match of imageMatches) {
		const rawLink = match[1]!.trim();

		if (!isGarbledImageName(rawLink)) {
			processedCount++;
			if (onProgress) onProgress(processedCount, totalImages);
			continue;
		}

		const linkedFile = resolveImageLink(app, file.path, rawLink, index).file;
		if (!linkedFile) {
			processedCount++;
			if (onProgress) onProgress(processedCount, totalImages);
			continue;
		}

		if (processedFilePaths.has(linkedFile.path)) {
			processedCount++;
			if (onProgress) onProgress(processedCount, totalImages);
			continue;
		}
		processedFilePaths.add(linkedFile.path);

		try {
			const ext = `.${linkedFile.extension}`;
			const { targetVaultPath } = await generateUniqueTargetPath(
				app, settings.imageNamePreset, currentAttachFolder, ext, window.moment(), rp, rbn
			);

			await app.fileManager.renameFile(linkedFile, targetVaultPath);
			renamedCount++;
		} catch (err) {
			console.error(`❌ 重命名乱码图片失败: ${linkedFile.path}`, err);
		}
		processedCount++;
		if (onProgress) onProgress(processedCount, totalImages);
	}
	return renamedCount;
}

/**
 * 全量重命名笔记里引用的图片为预设格式。
 *
 * @param force 为 true 时跳过 matchesNamePreset 检查，强制重命名所有图片
 * @param onProgress 可选进度回调 (当前处理数, 总数)
 * @param processedFiles 批次级去重集合：同一张图被多篇笔记引用时只处理一次
 * @returns 成功重命名的图片数量
 */
export async function renameImagesToPreset(
	app: App,
	settings: RenameSettings,
	file: TFile,
	index: Map<string, TFile[]>,
	reservedPaths?: Map<string, string>,
	reservedBasenames?: Map<string, string>,
	force?: boolean,
	onProgress?: (current: number, total: number) => void,
	processedFiles?: Set<string>
): Promise<number> {
	const content = await app.vault.read(file);
	const matches = Array.from(content.matchAll(wikiEmbedRe()));

	if (matches.length === 0) return 0;

	// 预统计有效图片总数，用于进度条
	let totalImages = 0;
	const imageMatches: RegExpExecArray[] = [];
	for (const m of matches) {
		if (!m[1]) continue;
		const link = m[1].trim();
		if (MANAGED_IMAGE_EXT_RE.test(link)) {
			totalImages++;
			imageMatches.push(m);
		}
	}

	let renamedCount = 0;
	let processedCount = 0;
	// 批次级去重：同一张图被多篇笔记引用时只处理一次。
	// 否则全库批处理会对同一张图反复重命名，文件名来回跳。
	const processedFilePaths = processedFiles ?? new Set<string>();
	const currentAttachFolder = await getTargetAttachmentFolder(app, settings, file);
	const rp = reservedPaths ?? new Map<string, string>();
	const rbn = reservedBasenames ?? new Map<string, string>();

	for (const match of imageMatches) {
		const rawLink = match[1]!.trim();

		const linkedFile = resolveImageLink(app, file.path, rawLink, index).file;
		if (!linkedFile) { processedCount++; if (onProgress) onProgress(processedCount, totalImages); continue; }

		if (processedFilePaths.has(linkedFile.path)) { processedCount++; if (onProgress) onProgress(processedCount, totalImages); continue; }
		processedFilePaths.add(linkedFile.path);

		// 非强制模式：检查已符合预设格式的图片是否需要保留原名还是因冲突而重命名
		if (!force && matchesNamePreset(linkedFile.name, settings.imageNamePreset)) {
			const existingTargetPath = normalizePath(
				currentAttachFolder === "/"
					? `/${linkedFile.name}`
					: `${currentAttachFolder}/${linkedFile.name}`
			);
			const reservedByPath = rp.get(existingTargetPath);
			const reservedByName = rbn.get(linkedFile.name);

			// 完整路径未被预留，且 basename 未被其他文件占用（或就是本文件自己）→ 保留原名
			if (reservedByPath === undefined &&
				(reservedByName === undefined || reservedByName === linkedFile.path)) {
				rp.set(existingTargetPath, linkedFile.path);
				if (reservedByName === undefined) {
					rbn.set(linkedFile.name, linkedFile.path);
				}
				processedCount++;
				if (onProgress) onProgress(processedCount, totalImages);
				continue;
			}
			// 同一文件被多条笔记引用 → 已处理过，跳过
			if (reservedByPath === linkedFile.path) {
				processedCount++;
				if (onProgress) onProgress(processedCount, totalImages);
				continue;
			}
			// 不同文件映射到同一路径或同名 basename → 冲突，强制重命名
		}

		try {
			const ext = `.${linkedFile.extension}`;
			const { targetVaultPath } = await generateUniqueTargetPath(
				app, settings.imageNamePreset, currentAttachFolder, ext, window.moment(), rp, rbn
			);

			await app.fileManager.renameFile(linkedFile, targetVaultPath);
			renamedCount++;
		} catch (err) {
			console.error(`❌ 重命名图片失败: ${linkedFile.path}`, err);
		}
		processedCount++;
		if (onProgress) onProgress(processedCount, totalImages);
	}
	return renamedCount;
}

/**
 * 批量修正全库图片链接格式（重命名完成后调用一次即可）。
 *
 * 安全线：目标文件名在全库不唯一时，即使设置为「仅文件名」也写完整路径 ——
 * 否则裸文件名会变成有歧义的链接，笔记可能显示成另一张同名图片。
 */
export async function fixImageLinkFormats(
	app: App,
	settings: { renameLinkFormat: string }
): Promise<void> {
	const format = settings.renameLinkFormat || 'full';
	// 重命名后文件名已经变化，这里重新建索引，保证歧义判断是最新的
	const index = buildBasenameIndex(app);
	const allMdFiles = app.vault.getMarkdownFiles();

	for (const mdFile of allMdFiles) {
		const content = await app.vault.read(mdFile);
		const regex = wikiEmbedRe(true);
		let newContent = content;
		let offset = 0;
		let modified = false;

		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			if (!match[1]) continue;
			const linkPath = match[1].trim();
			const alias = match[2] || '';

			// 仅处理图片链接
			if (!isImagePath(linkPath)) continue;

			const resolved = resolveImageLink(app, mdFile.path, linkPath, index).file;
			if (!resolved) continue;

			// 保留 #片段（如 ![[图.png#outline]]），否则会被当成"格式不对"而抹掉
			const fragmentIndex = linkPath.indexOf('#');
			const fragment = fragmentIndex >= 0 ? linkPath.substring(fragmentIndex) : '';
			const desiredPath = chooseLinkTarget(resolved, index, format) + fragment;

			// 格式已经正确则跳过，保证幂等
			if (linkPath === desiredPath) continue;

			const replacement = `![[${desiredPath}${alias}]]`;
			const start = match.index + offset;
			const end = start + match[0].length;
			newContent = newContent.substring(0, start) + replacement + newContent.substring(end);
			offset += replacement.length - match[0].length;
			modified = true;
		}

		if (modified) {
			await app.vault.modify(mdFile, newContent);
		}
	}
}
