/**
 * 行内扫描的共用判定（纯函数，不依赖 Obsidian API）。
 *
 * 「空格排版」与「智能公式」都要在同一行文字里找出"不能碰的地方"：
 * 行内代码、双链与图片、markdown 链接、URL、HTML 标签、`%%注释%%`、`#标签`，
 * 以及已经写好的行内公式 `$…$`。各写一份必然各有各的边界 bug，
 * 所以统一放这里，两个模块共用同一套实现。
 */
import { inlineCodeRanges } from './line-scan';

/**
 * 空白字符：半角空格、Tab，以及从 Word / PDF 粘进来时常见的 **NBSP（U+00A0）**。
 *
 * NBSP 看起来和空格一模一样，但规则只认 0x20 的话就完全看不见它 ——
 * `设\u00A0$A$`、`矩阵\u00A0A\u00A0中` 这类行会一直是"看着排好了、其实一个字没动"。
 */
export function isSpaceChar(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\u00a0';
}

/**
 * 一行里"整体看待"的区间（左闭右开）：里面的字符不参与排版规则，
 * 只决定这个整体与左右邻居之间的距离。这也顺带挡住了里面的 `$`、`#`、`(`。
 */
export function collectMaskedRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = inlineCodeRanges(line);

	/** 第二个元素是"前缀组"的长度：区间从 match.index + 前缀 开始，前缀本身不属于整体 */
	const patterns: Array<[RegExp, number]> = [
		[/!?\[\[[^\]\n]*\]\]/g, 0],                              // 双链与图片嵌入
		[/!?\[[^\]\n]*\]\([^()\n]*\)/g, 0],                      // markdown 链接与图片
		[/\[\^[^\]\n]*\]/g, 0],                                  // 脚注引用
		[/(?:https?|file|obsidian):\/\/[^\s<>()[\]（）【】]+/g, 0], // 裸 URL
		[/<[^<>\n]*>/g, 0],                                      // HTML 标签与自动链接
		[/%%[^%\n]*%%/g, 0],                                     // %%注释%%
		[/(?:^|[\s(（[【])#[^\s#，。、；：！？（）【】《》“”'"]+/g, 1], // #标签
	];

	for (const [pattern, prefix] of patterns) {
		for (const match of line.matchAll(pattern)) {
			if (match.index === undefined) continue;
			const start = match.index + prefix;
			const end = match.index + match[0].length;
			if (end > start) ranges.push([start, end]);
		}
	}

	// 合并重叠区间：`[[a]](b)` 可能被两条规则同时命中
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
			continue;
		}
		merged.push([range[0], range[1]]);
	}
	return merged;
}

/**
 * 一行里"未被转义、也不在行内代码里"的 `$$` 位置。
 */
export function dollarPositions(line: string): number[] {
	const positions: number[] = [];
	const codeRanges = inlineCodeRanges(line);
	let at = line.indexOf('$$');

	while (at >= 0) {
		const escaped = at > 0 && line.charAt(at - 1) === '\\';
		const inCode = codeRanges.some(([start, end]) => at < end && at + 2 > start);
		if (!escaped && !inCode) positions.push(at);
		at = line.indexOf('$$', at + 2);
	}

	return positions;
}

/**
 * 每行"可以排版"的区间（左闭右开）；`null` 表示整行跳过。
 *
 * - **同一行里成对的 `$$…$$`**（`公式如下：$$e^{At} = …$$`）不是区块：整行照常排版，
 *   公式本身由 token 层当成一段整体跳过。整行跳过的话，
 *   `1.矩阵指数$e^{At}$是…$$…$$` 里 `1.` 后面缺的空格、公式两侧缺的空格全都修不了。
 * - **跨行的 `$$ … $$` 区块**：中间那些行整行是 LaTeX 代码，必须跳过；
 *   起始行 `$$` **之前**、结束行 `$$` **之后**的正文仍要排版。
 * - **落单的 `$$`**（没配成对）：不当区块，整行按普通文字处理，免得吃掉后面整篇。
 */
export function mathRanges(lines: string[], protectedLines: boolean[]): Array<[number, number] | null> {
	const ranges: Array<[number, number] | null> = lines.map((line) => [0, (line ?? '').length]);
	let open = -1;

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		const line = lines[i] ?? '';
		const positions = dollarPositions(line);
		if (positions.length === 0) {
			if (open >= 0) ranges[i] = null;
			continue;
		}

		if (open < 0) {
			// 成对 → 行内显示公式，整行照排；奇数 → 这一行开启一个跨行区块
			if (positions.length % 2 === 0) continue;
			open = i;
			ranges[i] = [0, positions[0] as number];
			continue;
		}

		// 区块内部的行：整行是代码
		for (let k = open + 1; k < i; k++) ranges[k] = null;
		if (positions.length % 2 === 1) {
			// 收尾：`$$` 之后若还有正文，那部分照排
			ranges[i] = [(positions[0] as number) + 2, line.length];
			open = -1;
			continue;
		}
		// 收尾又在同一行开启新块：中间那段落在两个公式之间，保守起见整行不排
		ranges[i] = null;
		open = i;
	}

	// 没闭合：不算区块，把这批行恢复成整行排版
	if (open >= 0) {
		for (let k = open; k < lines.length; k++) {
			if (!protectedLines[k]) ranges[k] = [0, (lines[k] ?? '').length];
		}
	}

	return ranges;
}

/**
 * 读一段行内公式。
 *
 * 识别方式与 Obsidian、latex-layout.ts 保持一致：`$` 内侧紧贴内容才算公式，
 * `$ 5 与 $` 这种不会误判；`$$…$$` 整体当一段公式。
 *
 * @returns 公式文本与下一个位置；不是公式时返回 null
 */
export function readInlineMath(
	line: string,
	start: number,
	inCode: (at: number) => boolean
): { text: string; next: number } | null {
	if (line.charAt(start) !== '$') return null;
	if (inCode(start)) return null;

	// `$$ … $$`（同一行内成对）
	if (line.charAt(start + 1) === '$') {
		for (let i = start + 2; i < line.length - 1; i++) {
			if (line.charAt(i) !== '$' || line.charAt(i + 1) !== '$') continue;
			return { text: line.substring(start, i + 2), next: i + 2 };
		}
		return null;
	}

	if (/\s/.test(line.charAt(start + 1))) return null;

	for (let i = start + 1; i < line.length; i++) {
		if (line.charAt(i) !== '$') continue;
		if (line.charAt(i - 1) === '\\' || line.charAt(i + 1) === '$' || inCode(i)) continue;
		// 收尾 `$` 前面紧贴内容才算公式
		if (/\s/.test(line.charAt(i - 1))) return null;
		return { text: line.substring(start, i + 1), next: i + 1 };
	}
	return null;
}
