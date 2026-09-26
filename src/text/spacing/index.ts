/**
 * 排版格式：空格排版（纯函数，除参数外不依赖任何 Obsidian API，可脱离 Obsidian 验证幂等性）。
 *
 * 与「公式排版」（latex.ts，属于**代码格式**）的分工：
 * - 公式排版管 `$…$` **里面**的 LaTeX 代码怎么写；
 * - 这里管 `$…$` **外面**，以及正文里 中文 / 英文 / 数字 / 标点 / 符号 之间的空格。
 *
 * 九条规则（与设置面板「排版格式」一一对应）：
 * 1. **中文 ↔ 英文**：空一个字宽（文字格式 1）。行内代码、双链、链接、标签与英文等价
 *    ——「代码块和英文、数字等价，需要留空格」（标记命名 10）；GPT4、3D、v1.2.2、100kg
 *    这类**含字母的连写**也整体算一个英文单词，免得型号被从数字那一侧拆开。
 * 2. **中文 ↔ 数字**：不留空格（数字 2：中文和数字之间都不空一个字宽），
 *    已有空格一并删掉，`第 3 章` → `第3章`；只针对**纯数字**（3、3.14、2024）。
 * 3. **英文 ↔ 数字**：默认保持原样（数字 3 说"一般要空"，但 GPT4 / 3D / v1.2 这类
 *    专有名词一拆就错，见文字格式 4「专有名词空格以原有形式为准」）。
 * 4. **行内公式 ↔ 文字**：空一格（`设$x$为` → `设 $x$ 为`）。
 *    `$` 内侧永远不空 —— 那是通用符号 2 里 `$` 的特例，也是 Obsidian 能否认出公式的前提。
 * 5. **全角标点**：两侧不留空格（文字格式 1「与标点间不用空」）。
 *    两个例外：引号 `“”‘’` 两侧、书名号 `《》〈〉` 内侧 —— 那里可能是
 *    《新 吊带袜天使》《a子计划》这类故意留空的专有名词（文字格式 4），
 *    所以**书名号与引号内部一个字符都不动**。
 * 6. **半角标点** `, . ! ? :`：标点前不留空格、标点后空一格（英文符号 1）。
 *    小数点 / 版本号（`1.2.2`、`12:30`）、省略号（`...`）不适用。
 * 7. **括号 `()`**：包裹符号自己不添空格（通用符号 3 的包裹符号子条目）—— 内侧不留空格，外侧也不主动加。
 * 8. **数字 ↔ 单位**：空一格（数学符号 2），默认关闭，单位须落在词表里。
 * 9. **章节 / 课次 / 附录这类标题标记与标题内容之间空一格**（文字格式 / 中文 1）：
 *    `第一章矩阵` → `第一章 矩阵`、`第1课五十音` → `第1课 五十音`、`附录A矩阵` → `附录A 矩阵`。
 *    只在一行里认出这几种标记（`第…章/节/课/讲/篇/部分`、`附录` + 序号）才补一格；
 *    标记后面本来就跟着标点（`第一章、矩阵`）、或者标记后面没有内容（整行只有 `附录A`）时不动。
 * 10. **符号自己的空格规则**（symbols.ts）：**空格只用来分隔不同语言的内容** ——
 *    `space` 一律读作"与西文内容（字母 / 数字 / 公式 / 行内代码）之间留一格"，
 *    邻居是中文、全角标点、另一个符号时都贴紧（已有的空格一并收掉）。
 *    依据是中文排版规范：clreq §6.3.3（汉字与西文字母、数字之间不多于 1/4 汉字宽的字距或空白，
 *    标点旁边连这个空隙都不加）、§1.2（汉字与标点是 1:1 方块、无缝隙并列），
 *    以及 CSS `text-autospace` 的默认值（只在中西文之间加空隙，标点要显式开 `punctuation`）。
 *    于是 `word, word` / `A & B` / `$A$ & $B$` 留一格，而 `甲&乙`、`如, ：`、`|：单独一个`、
 *    `7. 并列：&` 全部贴紧；`|x|`、`P(A|B)`、`x̂_{k|k}` 这类竖线属于数学记号，一个字符都不动。
 *
 * 不管的地方（不碰就是最安全的排版）：
 * - frontmatter、围栏代码块、缩进代码块、`$$…$$` 公式块（含中间那些行，整块跳过）、
 *   **GFM 表格**（表头 / 分隔 / 数据行整行跳过：表格里的空格是对齐用的）；
 * - 书名号与引号内部（《新 吊带袜天使》《a子计划》：专有名词原样保留）；
 * - 强调标记本身（`**粗体**`、`*斜体*`、`==高亮==`、`~~删除~~`）：它并进所包裹的内容里，
 *   规则看到的是内容 —— `**可逆矩阵**$P$` 因此会补成 `**可逆矩阵** $P$`，
 *   而空格只会加在标记**外面**（插进 `** English**` 会让粗体失效）；配不成对的
 *   星号（`2*3`、`a*b`）原样留着，不当强调处理；
 * - 行内代码、双链 `[[…]]`、markdown 链接、URL、HTML 标签、`%%注释%%`、`#标签`
 *   的内部（当成一个"英文单词"整体看，只决定它与左右邻居之间的空格）；
 * - 中文与中文之间的空格（可能是《新 吊带袜天使》这类故意留的，标点概论 3 也要求别乱删）；
 * - 数学运算符（`ctrl+c` 不能加空格，数学符号 1 自己也写了"非数学语境就不加"）。
 *
 * 幂等：每条规则的结果都是"恰好一个空格"或"没有空格"，输出再跑一次不会变。
 */
import { markProtectedLines, markIndentedCodeLines, markTableLines } from '../line-scan';
import { mathRanges } from '../inline-scan';
import { decideGap } from './gap';
import { tokenizeLine } from './tokenize';
import type { Piece } from './tokenize';

/** 只决定"空一格"还是"不动"的规则 */
export type SpacingMode = 'space' | 'keep';

/** 中文与数字之间：可以选"不留空格"（按文档）、"空一格"或"不动" */
export type SpacingCjkDigitMode = 'none' | 'space' | 'keep';

/** 空格排版的九项规则 */
export interface SpacingOptions {
	/** 中文 ↔ 英文（含行内代码 / 双链 / 链接 / 标签） */
	cjkLatin: SpacingMode;
	/** 中文 ↔ 数字 */
	cjkDigit: SpacingCjkDigitMode;
	/** 英文 ↔ 数字 */
	latinDigit: SpacingMode;
	/** 行内公式 ↔ 文字 */
	mathText: SpacingMode;
	/** 全角标点两侧不留空格 */
	fullPunct: boolean;
	/** 半角标点 `, . ! ? :` 前不留空格、后空一格 */
	halfPunct: boolean;
	/** 括号 `()` 内侧不留空格 */
	bracketInner: boolean;
	/** 数字 ↔ 单位之间空一格 */
	digitUnit: boolean;
	/** 紧跟在中文后面的半角标点换成全角（写中文就是全中文标点） */
	halfToFullPunct: boolean;
	/** 符号自己的空格规则（`,` `.` 后空一格、`| & →` 左右空一格、`^` 不空…） */
	symbolPad: boolean;
	/** 章节 / 课次 / 附录这类标题标记与它后面的标题内容之间空一格（`第一章矩阵` → `第一章 矩阵`） */
	chapterTitle: boolean;
}

/** 默认值：文字的规则全开、可能误伤的规则先关（英文↔数字、数字↔单位） */
export const DEFAULT_SPACING_OPTIONS: SpacingOptions = {
	cjkLatin: 'space',
	cjkDigit: 'none',
	latinDigit: 'keep',
	mathText: 'space',
	fullPunct: true,
	halfPunct: true,
	bracketInner: true,
	digitUnit: false,
	halfToFullPunct: true,
	symbolPad: true,
	chapterTitle: true,
};

/** data.json 里被手工改成非法值时收敛回合法取值 */
export function resolveSpacingMode(value: unknown, fallback: SpacingMode): SpacingMode {
	return value === 'space' || value === 'keep' ? value : fallback;
}

export function resolveCjkDigitMode(value: unknown): SpacingCjkDigitMode {
	if (value === 'none' || value === 'space' || value === 'keep') return value;
	return DEFAULT_SPACING_OPTIONS.cjkDigit;
}

/** 九条规则是否全都处于"不动"状态 —— 是则整篇跳过，不做任何扫描 */
export function isSpacingActive(options: SpacingOptions): boolean {
	return options.cjkLatin !== 'keep'
		|| options.cjkDigit !== 'keep'
		|| options.latinDigit !== 'keep'
		|| options.mathText !== 'keep'
		|| options.fullPunct
		|| options.halfPunct
		|| options.bracketInner
		|| options.digitUnit
		|| options.halfToFullPunct
		|| options.symbolPad
		|| options.chapterTitle;
}

/**
 * 行首标记（列表 `-` `1.`、标题 `#`、引用 `>`，以及列表项里的任务复选框 `- [x]`）：
 * 标记与它后面那一个空格是语法，交给标记排版（markers.ts）管，空格规则不许碰 ——
 * 否则 `1. , /. …` 里的 `,` 会按"标点前不留空格"把列表标记后面那一个空格吃掉。
 *
 * 要求标记后面确实跟着空白：`1.矩阵指数` 不是标记（它的空格该由规则补上），
 * `#标签` 也不是标题。
 */
const LINE_MARKER_RE = /^(?:[-*+]|\d{1,9}[.)]|#{1,6}|>+)[ \t]+(?:\[[ xX]\][ \t]+)?/;

/** 处理一行 */
function formatLine(line: string, options: SpacingOptions): string {
	const marker = LINE_MARKER_RE.exec(line);
	const prefix = marker ? marker[0] : '';
	// 行首标记（`# `、`1. `）不参与空格判定，但要留在行文本里 ——
	// piece 的位置就是行内下标，章节标题标记的判定要按同一份文本对位置（见 chapter.ts）
	const body = prefix ? line.substring(prefix.length) : line;

	const pieces = tokenizeLine(body, options);
	let out = '';
	let previous: Piece | null = null;
	let gap = '';

	for (const piece of pieces) {
		if (piece.kind === 'space') {
			gap += piece.text;
			continue;
		}
		const decided = decideGap(body, previous, piece, gap, options);
		out += (decided === null ? gap : decided) + piece.text;
		previous = piece;
		gap = '';
	}

	// 行尾空白（Markdown 的硬换行就是两个空格）原样保留
	return prefix + out + gap;
}

/**
 * 空格排版：给整篇笔记补 / 删 中文、英文、数字、公式、标点之间的空格。
 *
 * 幂等：输出的每个位置要么恰好一个空格、要么没有空格，再跑一次不会变。
 *
 * @param content 笔记原文
 * @param options 八条规则的开关（由插件设置转换而来）
 * @returns 排版后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function fixSpacing(content: string, options: SpacingOptions): string {
	if (content === '' || !isSpacingActive(options)) return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);
	const tableLines = markTableLines(lines);
	const ranges = mathRanges(lines, protectedLines);
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// frontmatter、代码块、`$$…$$` 区块内部、表格行：整行跳过
		if (protectedLines[i] || codeLines[i] || tableLines[i]) continue;
		const range = ranges[i];
		if (!range) continue;
		// 只有空白的行统一成真正的空行：肉眼没区别，但不再留"看不见的缩进 / NBSP"
		if (line.trim() === '') {
			if (line !== '') {
				lines[i] = '';
				changed = true;
			}
			continue;
		}

		const head = line.substring(0, range[0]);
		const body = line.substring(range[0], range[1]);
		const tail = line.substring(range[1]);
		const fixed = head + formatLine(body, options) + tail;
		if (fixed !== line) {
			lines[i] = fixed;
			changed = true;
		}
	}

	return changed ? lines.join('\n') : content;
}
