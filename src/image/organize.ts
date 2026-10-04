import { App, TFile, TFolder } from 'obsidian';
import { ensureFolder, parentPathOf, resolveAttachmentFolder, AttachmentLocationSettings } from './attachment-folder';
import { unescapeTableTarget } from './constants';
import { collectImageTargets } from './dedupe';
import {
	addToBasenameIndex,
	buildCopyName,
	chooseLinkTarget,
	isImagePath,
	reseatInBasenameIndex,
	resolveImageLink,
} from './links';

/**
 * 整理笔记里的图片位置。
 *
 * 解决的问题：复制粘贴笔记后，`![[图.png]]` 这类裸文件名链接仍然解析到**原文件夹**的图片，
 * 本次笔记自己的附件夹里其实没有这张图。笔记一旦移动、原图一旦被删或被改名，图片就没了。
 *
 * 处理方式（逐条链接）：
 *   1. 图片已经在笔记自己的附件夹里、链接写的就是它 → 不动
 *   2. 附件夹里已有同内容的副本 → 只把链接指过去（不重复复制）
 *   3. 别处还有笔记在用它 → **复制**一份到附件夹（源文件保留），再改写本笔记的链接
 *   4. 只有本笔记在用它 → 直接**搬**进附件夹（源文件不留在原地）
 *
 * 第 3 / 4 条怎么分：调用方用 `options.countUsages` 告诉这里"这个文件名一共被几篇文档引用"，
 * 减去本笔记自己那一篇，还有别人引用才复制。不传 `countUsages`、或统计读不全时一律按
 * "别人还在用"处理，只复制 —— 多留一份副本只是浪费空间，把别人还在用的图搬走却会让那篇笔记断图。
 *
 * 2026-10 补第 4 条：只复制的话旧附件夹会剩下一整份没人管的重复图，而「清理没人引用的附件」
 * 是按**文件名**判断引用的（同名副本永远清不掉），用户报"整理完图片还在老文件夹里"就是这个原因。
 *
 * 链接写成文件名还是完整路径由 chooseLinkTarget 决定：
 * 全库同名时强制写完整路径，避免裸文件名指向另一张同名图片。
 */

const WIKI_IMAGE_RE = /!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/g;

/** 比较内容时的体积上限，超过则视为不同，避免把大文件整个读进内存 */
const MAX_COMPARE_BYTES = 32 * 1024 * 1024;

export interface OrganizeResult {
	/** 改写后的笔记内容（无改动时与输入相同） */
	content: string;
	/** 内容是否真的发生了变化 */
	changed: boolean;
	/** 复制进附件夹的图片数（别处还有笔记在用，源文件保留） */
	copied: number;
	/** 搬进附件夹的图片数（没有别的笔记在用，源文件不留在原地） */
	moved: number;
	/** 复用附件夹里已有副本、仅改写链接的数量 */
	relinked: number;
	/** 因无法确定目标而跳过的链接数 */
	skipped: number;
	/** 跳过原因（去重后的说明） */
	reasons: string[];
}

export interface OrganizeOptions {
	/**
	 * 这个文件名**一共被几篇文档**（笔记 / canvas，按文档去重）引用？
	 *
	 * 注意与 `collectImageTargets` 的口径不同：那边数"被引用了几次"（同目录查重时决定留哪张），
	 * 这里要的是"有几篇文档在引用"（决定一张图除本笔记外还有没有别人在用）。
	 *
	 * 不传 = 不判断，一律只复制（老行为，源文件保留）。
	 * 读不全时请返回一个大数（调用方 `ImageTasks.organizeImages` 就是这么兜的）——
	 * 读不到就不能断言"没人用"。
	 */
	countUsages?: (name: string) => Promise<number>;
}

export interface OrganizeSettings extends AttachmentLocationSettings {
	/** 链接形式：full 完整路径 / filename 仅文件名 */
	renameLinkFormat: string;
}

/** 目标文件夹里现有的文件名（小写），用于挑一个不冲突的新名字 */
function collectFolderNames(app: App, folderPath: string): Set<string> {
	const names = new Set<string>();
	const folder = folderPath === '/'
		? app.vault.getRoot()
		: app.vault.getAbstractFileByPath(folderPath);

	if (folder instanceof TFolder) {
		for (const child of folder.children) {
			if (child instanceof TFile) names.add(child.name.toLowerCase());
		}
	}
	return names;
}

function joinPath(folderPath: string, name: string): string {
	return folderPath === '/' ? name : `${folderPath}/${name}`;
}

/** 两张图片内容是否完全一致（先比大小，再比字节） */
async function sameContent(app: App, a: TFile, b: TFile): Promise<boolean> {
	const sizeA = a.stat?.size;
	const sizeB = b.stat?.size;
	if (typeof sizeA === 'number' && typeof sizeB === 'number') {
		if (sizeA !== sizeB) return false;
		if (sizeA > MAX_COMPARE_BYTES) return false;
	}

	const [bufA, bufB] = await Promise.all([app.vault.readBinary(a), app.vault.readBinary(b)]);
	const bytesA = new Uint8Array(bufA);
	const bytesB = new Uint8Array(bufB);
	if (bytesA.length !== bytesB.length) return false;
	for (let i = 0; i < bytesA.length; i++) {
		if (bytesA[i] !== bytesB[i]) return false;
	}
	return true;
}

function pushReason(reasons: string[], reason: string): void {
	if (!reasons.includes(reason)) reasons.push(reason);
}

/**
 * 这张图除了本笔记，还有别人在用吗？
 *
 * `countUsages` 给的是"这个文件名一共被几篇文档引用"（按文档去重），本笔记自己引用过就减掉一篇。
 * 不传、或统计过程出错时一律返回 true（当"别人还在用"，只复制）—— 两边的代价不对等：
 * 多留一份副本只是浪费几 MB，把别人还在用的图搬走会让那篇笔记直接断图。
 */
async function isUsedElsewhere(
	name: string,
	ownTargets: Set<string>,
	options: OrganizeOptions
): Promise<boolean> {
	if (!options.countUsages) return true;
	const key = name.toLowerCase();
	try {
		const total = await options.countUsages(name);
		return total > (ownTargets.has(key) ? 1 : 0);
	} catch (e) {
		console.error(`[ImageTransfer] 统计图片引用失败，按"别人还在用"处理: ${name}`, e);
		return true;
	}
}

/**
 * 整理单篇笔记的图片位置。
 *
 * @param index 全库文件名索引（由 buildBasenameIndex 建立，调用方持有，新建 / 搬走的文件会登记回去）
 */
export async function organizeNoteImages(
	app: App,
	settings: OrganizeSettings,
	note: TFile,
	index: Map<string, TFile[]>,
	options: OrganizeOptions = {}
): Promise<OrganizeResult> {
	const content = await app.vault.read(note);
	const targetFolder = resolveAttachmentFolder(app, settings, note);
	const targetKey = targetFolder.toLowerCase();
	const existingNames = collectFolderNames(app, targetFolder);
	// 本笔记自己引用了哪些图片名（判断"别人还在用吗"时要减掉自己这一篇）
	const ownTargets = new Set(collectImageTargets(content));

	let result = '';
	let lastIndex = 0;
	let copied = 0;
	let moved = 0;
	let relinked = 0;
	let skipped = 0;
	const reasons: string[] = [];

	/**
	 * 这一次跑动中已经搬走的图：**旧链接写法 / 旧路径** → 搬到的那个文件。
	 *
	 * 同一张图被这篇笔记引用两次时，第二次读到的还是老路径（笔记文本是一开头读进来的快照），
	 * 直接解析会失败 —— 先查这里，两处链接才能都改写对。
	 */
	const movedAliases = new Map<string, TFile>();

	WIKI_IMAGE_RE.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = WIKI_IMAGE_RE.exec(content)) !== null) {
		const rawTarget = (match[1] ?? '').trim();
		// 表格里 `![[图.png\|100]]` 的目标末尾多一个转义反斜杠：判断用还原后的名字
		const linkName = unescapeTableTarget(rawTarget);
		// 别名表的键：链接里写的那串（去掉 `#片段`，大小写不敏感）
		const linkKey = (linkName.split('#')[0] ?? linkName).trim().toLowerCase();
		const alias = match[2];
		if (!isImagePath(linkName)) continue; // 不是图片链接，原样保留

		const alreadyMoved = movedAliases.get(linkKey);
		const { file: source, ambiguous } = alreadyMoved
			? { file: alreadyMoved, ambiguous: false }
			: resolveImageLink(app, note.path, linkName, index);
		if (!source) {
			skipped++;
			pushReason(reasons, ambiguous ? '存在同名图片，无法确定指向哪一张' : '找不到对应的图片文件');
			continue;
		}

		// 已经在笔记自己的附件夹里、链接写的就是它 → 不需要搬运，也不用改写
		if (!alreadyMoved && parentPathOf(source).toLowerCase() === targetKey) continue;

		// 附件夹里是否已有同内容的副本（`candidate === source` 是自己的重复引用：上面刚搬过来那张）
		const candidate = app.vault.getAbstractFileByPath(joinPath(targetFolder, source.name));
		let destination: TFile | null = null;

		if (candidate instanceof TFile && (candidate === source || await sameContent(app, source, candidate))) {
			destination = candidate;
			relinked++;
		} else {
			const destName = buildCopyName(existingNames, source.name);
			const destPath = joinPath(targetFolder, destName);
			const shared = await isUsedElsewhere(source.name, ownTargets, options);
			try {
				await ensureFolder(app, targetFolder);
				existingNames.add(destName.toLowerCase());

				if (shared) {
					const data = await app.vault.readBinary(source);
					const created = await app.vault.createBinary(destPath, data);
					addToBasenameIndex(index, created);
					destination = created;
					copied++;
				} else {
					// 只有本笔记在用它：直接搬。走 Obsidian 的 renameFile，时间戳保留、
					// 万一还有别处（我们没扫到的 html 导出之类）引用它，链接也会被一并更新
					const oldPath = source.path;
					await app.fileManager.renameFile(source, destPath);
					const landed = app.vault.getAbstractFileByPath(destPath);
					destination = landed instanceof TFile ? landed : source;
					reseatInBasenameIndex(index, oldPath, destination);
					// 同一张图被这篇笔记引用多次时，后面的链接还写着旧路径 / 旧名字
					movedAliases.set(linkKey, destination);
					movedAliases.set(oldPath.toLowerCase(), destination);
					moved++;
				}
			} catch (e) {
				const what = shared ? '复制' : '移动';
				console.error(`[ImageTransfer] ${what}图片失败: ${source.path} → ${destPath}`, e);
				skipped++;
				pushReason(reasons, `${what}图片失败，详见控制台`);
				continue;
			}
		}

		const fragmentIndex = linkName.indexOf('#');
		const fragment = fragmentIndex >= 0 ? linkName.substring(fragmentIndex) : '';
		const target = chooseLinkTarget(destination, index, settings.renameLinkFormat) + fragment;
		// 别名前面的竖线在表格里是转义的：原来怎么写就怎么写回去，否则单元格会被切断
		const aliasSeparator = alias === undefined ? '' : rawTarget.endsWith('\\') ? '\\|' : '|';
		const link = `![[${target}${aliasSeparator}${alias ?? ''}]]`;

		result += content.substring(lastIndex, match.index) + link;
		lastIndex = match.index + match[0].length;
	}

	result += content.substring(lastIndex);

	return { content: result, changed: result !== content, copied, moved, relinked, skipped, reasons };
}
