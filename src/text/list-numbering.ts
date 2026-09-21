import { markIndentedCodeLines, markProtectedLines, markTableLines } from './line-scan';

/**
 * 列表序号整理（纯函数，不依赖 Obsidian API）。
 *
 * **保证每个列表的首项编号是 1**：不满足就整段从 1 起逐项 +1（`3. 4. 5.` → `1. 2. 3.`）。
 *
 * ## 为什么"首项已经是 1 就不动"
 *
 * 作者写的编号未必是随手打的：`1. 1. 1.`（全写 1，靠 Markdown 渲染时自动递增）和
 * `1. 5. 9.`（按自己的节奏留空）都是常见写法，block-sort.ts 的编号整理也特意保留这两种形态。
 * 所以这里只做"首项不是 1"这一种修复 —— 既是"保证首项是 1"的字面要求，
 * 又不会去动那些故意写歪的编号。
 *
 * 编号位数照规范 `数字 1`（需要用到几位就占几位）：不加前导零，第 10 项就写 `10.`。
 *
 * ## 列表的边界
 *
 * 判定按 CommonMark 的直觉来：
 * - 紧跟列表项之后的行（懒续行）、缩进更深的行都属于当前列表项，不切断列表；
 * - **空行本身不断列表**（松列表就是空行隔开的），但空行之后出现的普通段落会切断；
 * - 缩进回退到列表那一层时，更深的子列表结束；回到同一层则继续同一个列表；
 * - frontmatter、围栏 / 缩进代码块、表格行一律当边界（保护区，见 line-scan.ts）。
 *
 * 于是"段落隔开的两个列表"各自从 1 开始，"子列表"也各自从 1 开始 ——
 * 子列表不再跟着父列表的编号往下数。
 */

/** 行的结构：缩进 + 引用标记（都原样保留）与正文 */
interface LineParts {
	indent: string;
	quote: string;
	body: string;
	/** 缩进宽度：tab 算 4，用来比较嵌套层级 */
	width: number;
}

/** 一个有序列表（可能已经结束，但还要参与改写） */
interface NumberedList {
	/** 列表身份：缩进 + 引用标记完全一致才算同一个列表 */
	key: string;
	width: number;
	/** 首项原始的编号 —— 只有它不是 1 才动手 */
	firstNumber: number;
	items: ListItem[];
}

interface ListItem {
	line: number;
	number: number;
	/** 编号后的分隔符：`.` 或 `)`，原样保留 */
	style: string;
	/** 编号之后的一切（空白 + 内容），原样保留 */
	rest: string;
}

/** 有序列表项：`1. 内容` / `12) 内容`，编号后必须有空白 */
const ITEM_RE = /^(\d{1,9})([.)])([ \t]+)([\s\S]*)$/;

/** 缩进宽度：tab 算 4（行首缩进修复会把 4 空格变成 tab，两种写法要能比较） */
function indentWidth(indent: string): number {
	let width = 0;
	for (const char of indent) width += char === '\t' ? 4 : 1;
	return width;
}

/** 拆出「缩进 + 引用标记」与正文 */
function readLine(line: string): LineParts {
	const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
	let index = indent.length;
	let quote = '';

	// 多级引用：`> > 1. 内容` 里的引用标记原样保留
	while (line.charAt(index) === '>') {
		quote += '>';
		index++;
		while (line.charAt(index) === ' ' || line.charAt(index) === '\t') {
			quote += line.charAt(index);
			index++;
		}
	}

	return { indent, quote, body: line.substring(index), width: indentWidth(indent) };
}

/** 这一行是不是有序列表项；不是则返回 null */
function readItem(parts: LineParts): { number: number; style: string; rest: string } | null {
	const match = ITEM_RE.exec(parts.body);
	if (!match) return null;
	return {
		number: Number.parseInt(match[1] ?? '', 10),
		style: match[2] ?? '.',
		// 编号后面的一切原样留着：`1.    内容` 里的多个空格由标记排版去收，这里不越权
		rest: (match[3] ?? '') + (match[4] ?? ''),
	};
}

/**
 * 结束"已经不属于当前位置"的列表。
 *
 * @param open 当前还开着的列表（按出现顺序）
 * @param width 这一行的缩进宽度
 * @param sameLevelToo 是否连同一层的列表也结束（空行之后的普通段落会结束同级列表；
 *   紧跟列表项的懒续行不会）
 */
function closeLists(open: NumberedList[], width: number, sameLevelToo: boolean): void {
	for (let i = open.length - 1; i >= 0; i--) {
		const list = open[i];
		if (!list) continue;
		if (list.width > width || (sameLevelToo && list.width === width)) open.splice(i, 1);
	}
}

/**
 * 整理列表序号。
 *
 * @param content 笔记原文
 * @returns 处理后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function fixListNumbers(content: string): string {
	if (content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);
	const tableLines = markTableLines(lines);

	const lists: NumberedList[] = [];   // 出现过的所有列表
	const open: NumberedList[] = [];    // 还没结束的那些
	/** 上一个内容行之后是否出现过空行 —— 决定同级列表要不要被段落切断 */
	let sawBlank = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';

		// 保护区：整段跳过，也顺手切断列表（不跨代码块/表格数编号）
		if (protectedLines[i] || codeLines[i] || tableLines[i]) {
			open.length = 0;
			sawBlank = false;
			continue;
		}
		if (line.trim() === '') {
			sawBlank = true;
			continue;
		}

		const parts = readLine(line);
		const item = readItem(parts);

		if (!item) {
			// 普通内容行：空行之后的段落（或缩进回退）结束列表；紧跟着列表项的懒续行不算
			closeLists(open, parts.width, sawBlank);
			sawBlank = false;
			continue;
		}

		// 列表项：更深的子列表到此结束，同层/更浅的继续
		closeLists(open, parts.width, false);

		const key = `${parts.indent}\u0000${parts.quote}`;
		let list = open.find(entry => entry.key === key);
		if (!list) {
			list = { key, width: parts.width, firstNumber: item.number, items: [] };
			open.push(list);
			lists.push(list);
		}
		list.items.push({ line: i, number: item.number, style: item.style, rest: item.rest });
		sawBlank = false;
	}

	// 首项不是 1 的列表：整段从 1 起逐项 +1（首项已经是 1 的一律不动）
	const rewritten = new Map<number, string>();
	for (const list of lists) {
		if (list.firstNumber === 1) continue;
		for (let n = 0; n < list.items.length; n++) {
			const item = list.items[n];
			if (!item) continue;
			const original = lines[item.line] ?? '';
			const parts = readLine(original);
			const next = `${parts.indent}${parts.quote}${n + 1}${item.style}${item.rest}`;
			if (next !== original) rewritten.set(item.line, next);
		}
	}

	if (rewritten.size === 0) return content;
	const out = lines.slice();
	for (const [index, text] of rewritten) out[index] = text;
	return out.join('\n');
}
