import { wikiEmbedRe } from './constants';
import { isImagePath } from './links';
import { inlineCodeRanges, markFenceLines } from '../text/line-scan';

/**
 * 从文本里找出所有"图片嵌入"（纯函数，不依赖 Obsidian API）。
 *
 * 两个功能共用这一份扫描：状态栏数选中内容里的图片张数（ui/selection-count.ts）、
 * 复制图片时要知道复制哪几张（image/copy.ts）。以前只有前者，扫描写在状态栏模块里；
 * 复制功能要的是**目标和位置**而不是一个数字，所以挪到这里，让两边问同一份实现。
 *
 * ## 什么算"一张图片"
 *
 * 只认**嵌入**（正文里真的会渲染成图片的那两种写法），不认指向图片的普通链接：
 * - 双链嵌入 `![[图.png]]`、带尺寸 / 别名 / 片段 `![[图.png|100]]`、`![[图.png#center]]`；
 * - Markdown 嵌入 `![说明](附件/图.png)`，含外部绝对路径 `![说明](D:\图.png)`。
 *
 * "这个链接指向的算不算图片"由 `image/links.ts` 的 `isImagePath` 说了算（比受管位图格式宽，
 * 多 avif / svg）—— 与改名、导入用的是同一张表，不在这里另写扩展名判断。
 *
 * 围栏代码块与行内代码里的链接**不算**：那里写的是代码，不是笔记里的图片。
 * 保护区判定走 `text/line-scan.ts`（只取围栏那一半 —— 拿到的是选区或整篇文本，
 * 开头的 `---` 多半是分隔线，按 frontmatter 判会把"以 --- 包起来"的内容整段吃掉）。
 */

/** 一条图片嵌入：目标、语法种类，以及它在文本里的位置 */
export interface ImageRef {
	/** 链接里写的目标（已去掉 `<>` 包裹与 `"标题"`，已 trim） */
	target: string;
	/** `wiki` = `![[目标]]`；`markdown` = `![说明](目标)` */
	kind: 'wiki' | 'markdown';
	/** 整条嵌入的起始位置（含 `![[` / `![` 语法） */
	from: number;
	/** 整条嵌入的结束位置（左闭右开） */
	to: number;
}

/** Markdown 嵌入：`![说明](目标)`；目标之后可能还跟着 `"标题"` */
function markdownEmbedRe(): RegExp {
	return /!\[[^\]]*\]\(([^)]*)\)/g;
}

/** 从 Markdown 嵌入的括号里取出目标：去掉 `<>` 包裹与后面的 `"标题"` */
function markdownTarget(raw: string): string {
	const target = raw.trim();
	if (target.startsWith('<')) {
		const end = target.indexOf('>');
		if (end >= 0) return target.slice(1, end);
	}
	return target.replace(/\s+["'][^"']*["']\s*$/, '');
}

/** 这个位置落在某段行内代码里吗（区间左闭右开） */
function isInRanges(index: number, ranges: Array<[number, number]>): boolean {
	return ranges.some(([start, end]) => index >= start && index < end);
}

/** 扫一行，把命中的嵌入追加进 out（行首在整段文本里的偏移是 lineStart） */
function collectFromLine(line: string, lineStart: number, out: ImageRef[]): void {
	const codeRanges = inlineCodeRanges(line);
	let match: RegExpExecArray | null;

	// 双链嵌入 `![[目标]]` / `![[目标|别名]]`
	const wiki = wikiEmbedRe();
	while ((match = wiki.exec(line)) !== null) {
		// 空匹配兜底：不让 lastIndex 停在同一处，否则死循环（同 inlineCodeRanges 的写法）
		if (wiki.lastIndex === match.index) wiki.lastIndex++;
		if (isInRanges(match.index, codeRanges)) continue;
		const target = (match[1] ?? '').trim();
		if (isImagePath(target)) {
			out.push({ target, kind: 'wiki', from: lineStart + match.index, to: lineStart + match.index + match[0].length });
		}
	}

	// Markdown 嵌入 `![说明](目标)`
	const markdown = markdownEmbedRe();
	while ((match = markdown.exec(line)) !== null) {
		if (markdown.lastIndex === match.index) markdown.lastIndex++;
		if (isInRanges(match.index, codeRanges)) continue;
		const target = markdownTarget(match[1] ?? '');
		if (isImagePath(target)) {
			out.push({ target, kind: 'markdown', from: lineStart + match.index, to: lineStart + match.index + match[0].length });
		}
	}
}

/**
 * 找出文本里所有图片嵌入（按出现顺序）。
 *
 * @param text 整篇笔记、一段选区，或任意片段
 * @param baseOffset 这段文本在整篇笔记里的起始偏移（选区 / 单行片段用得上），默认 0
 */
export function collectImageRefs(text: string, baseOffset = 0): ImageRef[] {
	// 两种嵌入都以 `!` 开头，先挡掉绝大多数调用（选区变化很频繁，这段每次都要跑）
	if (!text.includes('!')) return [];

	const lines = text.split('\n');
	const fenceLines = markFenceLines(lines);
	const refs: ImageRef[] = [];
	let lineStart = baseOffset;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (fenceLines[i] !== true && line.includes('!')) collectFromLine(line, lineStart, refs);
		lineStart += line.length + 1; // +1：被 split 掉的换行符
	}

	return refs;
}

/** 数一段文本里有几张图片（状态栏用；同一张图被嵌两次算两张） */
export function countImageRefs(text: string): number {
	return collectImageRefs(text).length;
}

/** 光标 / 鼠标位置落在哪条图片嵌入里（右键点在图片上时就是它） */
export function findImageRefAt(refs: ImageRef[], offset: number): ImageRef | null {
	return refs.find(ref => offset >= ref.from && offset < ref.to) ?? null;
}

/**
 * 这一次该复制哪几张图：**选区里有图片就复制选区里的**（批量复制），
 * 否则退回到光标处那一条（右键点在图片上、或光标停在图片链接里）。
 */
export function pickImageRefs(text: string, cursorOffset: number, selection: { from: number; to: number } | null): ImageRef[] {
	if (selection && selection.to > selection.from) {
		const inSelection = collectImageRefs(text.slice(selection.from, selection.to), selection.from);
		if (inSelection.length > 0) return inSelection;
	}
	const at = findImageRefAt(collectImageRefs(text), cursorOffset);
	return at ? [at] : [];
}
