/**
 * 逐行扫描的"保护区"判定（纯函数，不依赖 Obsidian API）。
 *
 * 有三类区域，任何排版类功能都不该碰：
 * - **YAML frontmatter**：缩进是语法，而且 YAML 里本来就禁止用 Tab 缩进；
 * - **围栏代码块内部**（``` / ~~~）：缩进、`#标签`、`|` 都是代码本身；
 * - **缩进代码块**（4 个空格或一个 Tab）：同上，见 markIndentedCodeLines。
 *
 * 行首缩进修复、标记排版、标签排版、板块排序四个模块都需要这套判定。
 * 共用一份实现，免得各写一份、各有各的边界 bug（例如未闭合的围栏）。
 */

/** 围栏代码块的围栏：字符 + 长度（``` 与 ```` 是两种不同的围栏） */
interface Fence {
	char: string;
	length: number;
}

/**
 * 围栏代码块的状态机：喂进一行，回答"这一行属于围栏代码块吗"（围栏行本身也算）。
 *
 * 围栏必须同字符、且闭合围栏不短于开始围栏才算闭合，未闭合时后面全部受保护。
 * 提取成闭包是为了让下面两个函数共用同一份判定 —— 只标围栏的 `markFenceLines`
 * 与连 frontmatter 一起标的 `markProtectedLines`，两边不能各写一套。
 */
function createFenceTracker(): (line: string) => boolean {
	let fence: Fence | null = null;

	return (line: string): boolean => {
		const fenceMatch = /^[ \t]*(`{3,}|~{3,})/.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			if (fence === null) {
				fence = { char: marker.charAt(0), length: marker.length };
			} else if (fence.char === marker.charAt(0) && marker.length >= fence.length) {
				fence = null;
			}
			return true;
		}
		return fence !== null;
	};
}

/**
 * 标记出哪些行属于"保护区"。
 *
 * 约定与 Obsidian 一致：
 * - frontmatter 只在**第 0 行**是 `---` 时成立，正文中间的 `---` 是分隔线；
 * - 围栏必须同字符、且闭合围栏不短于开始围栏才算闭合，未闭合时后面全部受保护。
 *
 * @param lines 按 `\n` 切好的行
 * @returns 与 lines 等长的布尔数组，true 表示该行不可改动
 */
export function markProtectedLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	const trackFence = createFenceTracker();
	let inFrontmatter = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';

		if (i === 0 && /^---[ \t]*\r?$/.test(line)) {
			inFrontmatter = true;
			flags[i] = true;
			continue;
		}
		if (inFrontmatter) {
			flags[i] = true;
			if (/^(?:---|\.\.\.)[ \t]*\r?$/.test(line)) inFrontmatter = false;
			continue;
		}

		flags[i] = trackFence(line);
	}

	return flags;
}

/**
 * 只标围栏代码块的行，**不做 frontmatter 判定**。
 *
 * 给"拿到的是笔记片段而不是整篇"的调用方用（例如状态栏数选区内图片张数）：
 * 片段开头那个 `---` 多半是分隔线，照 `markProtectedLines` 判会把
 * "以 `---` 开头、以 `---` 结尾"的选区整段当成 frontmatter 吃掉。
 */
export function markFenceLines(lines: string[]): boolean[] {
	const trackFence = createFenceTracker();
	return lines.map(line => trackFence(line));
}

/** 列表符号：`-` `*` `+` `1.` `1)`，后面跟空白或行尾 */
const LIST_MARKER_RE = /^(?:[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$))/;

/** 行内代码：`…` 或 ``…``（成对的同长度反引号） */
const INLINE_CODE_RE = /(`+)([\s\S]*?)\1/g;

/**
 * 一行里所有行内代码的区间（左闭右开）。
 * 行内代码里的 `$$`、`#标签` 都不是语法，公式排版与标签排版都要跳过它们。
 */
export function inlineCodeRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const re = new RegExp(INLINE_CODE_RE.source, 'g');
	let match: RegExpExecArray | null;

	while ((match = re.exec(line)) !== null) {
		ranges.push([match.index, match.index + match[0].length]);
		if (match.index === re.lastIndex) re.lastIndex++;
	}

	return ranges;
}

/** 缩进代码块的缩进：一个 Tab，或 4 个以上空格 */
const INDENTED_CODE_RE = /^(?:\t[ \t]*| {4,})\S/;

/**
 * 这一行是不是"缩进代码块"的**开头**。
 *
 * 用缩进写代码时，`#fff`（颜色）、`#TODO`（注释）看着就像标签，排版挪了就把代码弄坏了。
 * Markdown 的缩进代码块**不能打断段落**，所以它前面要么是空行、要么就是文档开头；
 * 而列表项里的缩进内容、聊天记录的正文都紧跟在上一行后面 —— 靠这一点把两者分开，
 * 因此聊天记录（哪怕正文缩进设置成 4 个空格）不会被误判成代码。
 */
function isIndentedCodeStart(lines: string[], index: number): boolean {
	const line = lines[index] ?? '';
	if (!INDENTED_CODE_RE.test(line)) return false;

	const previous = lines[index - 1];
	// 开头就是缩进：Markdown 当代码块
	if (previous === undefined) return true;
	// 前面那行不是空行 → 这是上一段 / 列表项的续行，不是代码块
	if (previous.trim() !== '') return false;

	// 空行之上是列表项、引用或本身缩进的内容 → 这段缩进属于那个容器，不是代码
	for (let i = index - 2; i >= 0; i--) {
		const above = lines[i] ?? '';
		if (above.trim() === '') continue;
		return !/^[ \t]/.test(above) && !LIST_MARKER_RE.test(above) && !above.trimStart().startsWith('>');
	}
	return true;
}

/** GFM 表格的分隔行：`| --- | :--: |`（单元格里只有 `-` 与可选的 `:`） */
const TABLE_DELIMITER_RE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** 表格行（GFM）：行首一个 `|` */
const TABLE_ROW_RE = /^[ \t]*\|/;

/**
 * 标记 GFM 表格占用的行（表头行、分隔行、数据行）。
 *
 * 表格里的空格是对齐用的（`| 日期  | 规划  |`），排版规则一碰就把每列的留白压成一个空格，
 * 表也就没法看了；`|` 本身是单元格分隔符，不是正文里的排版符号，同样不该按符号规则处理。
 *
 * 判定按 GFM：一张表必须有**分隔行**（`| --- | --- |`），它上面一行是表头，下面连续的、
 * 以 `|` 开头的行是数据行。单看一行有几个 `|` 分不出表格与正文 ——
 * `|：单独一个 | 左右要加空格` 也以 `|` 开头，但那是在讲符号本身。
 */
export function markTableLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (!line.includes('|') || !TABLE_DELIMITER_RE.test(line)) continue;

		flags[i] = true;
		if (i > 0 && TABLE_ROW_RE.test(lines[i - 1] ?? '')) flags[i - 1] = true;
		for (let j = i + 1; j < lines.length; j++) {
			const row = lines[j] ?? '';
			if (!TABLE_ROW_RE.test(row)) break;
			flags[j] = true;
		}
	}

	return flags;
}

/**
 * 标记整篇笔记里属于缩进代码块的行。
 *
 * 代码块里的后续行只看自己判断不出来（上一行是缩进行，看着就像"续行"），
 * 所以从头扫一遍：非缩进行出现之前，缩进行都算代码。
 * 空行不结束代码块（代码里本来就可以有空行），与 Markdown 的规则一致。
 */
export function markIndentedCodeLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	let inCode = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		if (line.trim() === '') continue;

		if (INDENTED_CODE_RE.test(line) && (inCode || isIndentedCodeStart(lines, i))) {
			flags[i] = true;
			inCode = true;
			continue;
		}
		inCode = false;
	}

	return flags;
}
