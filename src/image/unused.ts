import { unescapeTableTarget } from './constants';

/**
 * 清理**没人引用的图片附件**（自己实现，不依赖 Clear Unused Images）。
 *
 * ## 怎么判定「有人引用」
 *
 * 引用只出现在 `.md` 与 `.canvas` 里：`![[图.png]]`、`[[图.png]]`、`![](路径/图.png)`、
 * canvas 的 `"file": "路径/图.png"`。扫描与 `dedupe.ts` 的 `collectImageTargets` 同一种写法，
 * 但判定要分成两种：
 *
 * - **只写文件名**（`![[图.png]]`）：全库可能有多张同名图，链接指向哪一张由 Obsidian 现算，
 *   本模块不猜 —— 同名文件**都算"有人用"**；
 * - **带路径**（`![[附件/图.png]]`、`![](../附件/图.png)`）：链接已经指名道姓，交给解析器
 *   （`tasks.ts` 传入 `resolveImageLink`，与改名、整理图片位置同一套）算成具体文件，
 *   **只保护那一个文件**；同名的其它副本照样算没人用。
 *
 * 路径解析不出来（写错了、文件不在了）时退回第一种，按文件名保守保护。
 *
 * 2026-11 用户报的那张图就漏在这里：以前一律按文件名比较，别的文件夹里有一张同名图被引用，
 * 这张没人用的也跟着免于清理，一直清不掉。
 *
 * 三条刻意的保守：
 *
 * - **只清图片**（png / jpg / gif / bmp / webp / heic / avif / svg）—— 别的附件
 *   （pdf、docx、音频…）一个都不碰，它们的引用写法五花八门，误判的代价比"少清几个"大得多；
 * - **只认笔记与 canvas 里的引用**：`.md` 与 `.canvas` 之外的文件（导出的 html、
 *   别的插件的数据文件）一概不看 —— 这也是 Clear Unused Images 的口径；
 * - 删除走 `fileManager.trashFile`（用户设的回收站），不是永久删除，误删了还能恢复。
 *
 * 判定收在纯函数 `selectUnusedImages` 里，读盘与删除在 `tasks.ts`。
 */

/** 会被清理的图片后缀（比受管位图宽一点：svg 也是图片，但不归"转换格式"管） */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|heic|avif|svg)$/i;

/** 只看文件名：这张图会不会被我们清理 */
export function isImageFileName(name: string): boolean {
	return IMAGE_EXT_RE.test(name);
}

/** 一篇会被扫描的文档 */
export interface ReferenceDocument {
	/** 仓库内路径：解析相对链接时要按它的目录算 */
	path: string;
	/** 正文 */
	text: string;
}

/** 一条图片引用 */
export interface ImageReference {
	/** 链接里写的目标（已去掉别名、片段、标题与尖括号） */
	link: string;
	/** 文件名（小写） */
	name: string;
	/** 目标里带了路径吗（带路径 = 指名道姓，只保护那一个文件） */
	qualified: boolean;
}

/**
 * 把一条带路径的链接解析成仓库内路径。
 * `tasks.ts` 传入基于 `resolveImageLink` 的实现（与 Obsidian 的解析结果一致）；
 * 不传时用本文件的纯函数版，供测试与离线场景使用。
 */
export type ImageLinkResolver = (link: string, sourcePath: string) => string | null;

/** 外部地址（http / https / app / file 等）不指向仓库里的图片 */
function isRemote(link: string): boolean {
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(link) || link.startsWith('//');
}

/** 去掉别名、片段、标题与尖括号，统一分隔符；不是图片返回 null */
function cleanReference(raw: string): string | null {
	let link = unescapeTableTarget(raw).trim();
	if (link.startsWith('<')) {
		const end = link.indexOf('>');
		link = end >= 0 ? link.slice(1, end) : link.slice(1);
	}
	link = link.replace(/\s+["'][^"']*["']\s*$/, '');
	link = (link.split('#')[0] ?? link).trim();
	try {
		link = decodeURIComponent(link);
	} catch {
		// 编码坏了就按原样比
	}
	link = link.replace(/\\/g, '/');
	return IMAGE_EXT_RE.test(link) ? link : null;
}

/** 取出文本里的图片引用（三种写法：双链、Markdown 嵌入、canvas 的 file 字段） */
export function collectImageReferences(text: string): ImageReference[] {
	const references: ImageReference[] = [];

	const take = (raw: string): void => {
		const link = cleanReference(raw);
		if (!link) return;
		const name = (link.split('/').pop() ?? link).toLowerCase();
		references.push({ link, name, qualified: link.includes('/') });
	};

	for (const match of text.matchAll(/!?\[\[([^\]|#]+)/g)) take(match[1] ?? '');
	for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) take(match[1] ?? '');
	for (const match of text.matchAll(/"file"\s*:\s*"([^"]+)"/g)) take(match[1] ?? '');

	return references;
}

/** 把 `a/b/../c.png` 这种写法按目录归约成 `a/c.png` */
function normalizeRelative(link: string): string {
	const parts: string[] = [];
	for (const part of link.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}

/**
 * 纯函数版解析：按仓库内路径与"相对笔记目录"两种候选去找现有文件。
 * 找到返回小写路径，找不到返回 null。
 */
function resolveInVault(link: string, sourcePath: string, knownPaths: Set<string>): string | null {
	if (isRemote(link)) return null;
	const clean = link.replace(/^\/+/, '');
	const directory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
	const candidates = [normalizeRelative(clean)];
	if (directory !== '') candidates.push(normalizeRelative(`${directory}/${clean}`));
	for (const candidate of candidates) {
		const key = candidate.toLowerCase();
		if (knownPaths.has(key)) return key;
	}
	return null;
}

/**
 * 从一批图片里挑出**没有任何文档引用**的那些。
 *
 * @param images 仓库里的图片文件（用 `path` 与 `name`）
 * @param documents 每篇笔记 / canvas 的路径与正文
 * @param resolve 带路径的引用怎么解析成仓库内路径；省略时用纯函数版
 * @returns `images` 里没人引用的那些（保持原顺序，便于结果可复现）
 */
export function selectUnusedImages<T extends { name: string; path: string }>(
	images: T[],
	documents: ReferenceDocument[],
	resolve?: ImageLinkResolver
): T[] {
	const knownPaths = new Set(images.map(image => image.path.toLowerCase()));
	const resolveLink: ImageLinkResolver = resolve ?? ((link, sourcePath) => resolveInVault(link, sourcePath, knownPaths));

	const usedPaths = new Set<string>();
	const usedNames = new Set<string>();

	for (const document of documents) {
		for (const reference of collectImageReferences(document.text)) {
			// 外部地址（http / file 之类）永远指不到仓库里的图片，连名字都不保护
			if (isRemote(reference.link)) continue;
			if (!reference.qualified) {
				usedNames.add(reference.name);
				continue;
			}
			const resolved = resolveLink(reference.link, document.path);
			const key = resolved?.replace(/\\/g, '/').toLowerCase() ?? '';
			if (key !== '' && knownPaths.has(key)) usedPaths.add(key);
			else usedNames.add(reference.name);
		}
	}

	return images.filter(image => !usedPaths.has(image.path.toLowerCase()) && !usedNames.has(image.name.toLowerCase()));
}
