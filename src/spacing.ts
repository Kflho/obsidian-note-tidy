/**
 * 排版格式：空格排版（纯函数，除参数外不依赖任何 Obsidian API，可脱离 Obsidian 验证幂等性）。
 *
 * 与「公式排版」（latex-layout.ts，属于**代码格式**）的分工：
 * - 公式排版管 `$…$` **里面**的 LaTeX 代码怎么写；
 * - 这里管 `$…$` **外面**，以及正文里 中文 / 英文 / 数字 / 标点 / 符号 之间的空格。
 *
 * 八条规则（与设置面板「排版格式」一一对应）：
 * 1. **中文 ↔ 英文**：空一个字宽（文字格式 1）。行内代码、双链、链接、标签与英文等价
 *    ——「代码块和英文、数字等价，需要留空格」（标记命名 10）；GPT4、3D、v1.2.2、100kg
 *    这类**含字母的连写**也整体算一个英文单词，免得型号被从数字那一侧拆开。
 * 2. **中文 ↔ 数字**：不留空格（数字 2：中文和数字之间都不空一个字宽），
 *    已有空格一并删掉，`第 3 章` → `第3章`；只针对**纯数字**（3、3.14、2024）。
 * 3. **英文 ↔ 数字**：默认保持原样（数字 3 说"一般要空"，但 GPT4 / 3D / v1.2 这类
 *    专有名词一拆就错，见文字格式 4「专有名词空格以原有形式为准」）。
 * 4. **行内公式 ↔ 文字**：空一格（`设$x$为` → `设 $x$ 为`）。
 *    `$` 内侧永远不空 —— 那是 latex 符号格式 1 的特例，也是 Obsidian 能否认出公式的前提。
 * 5. **全角标点**：两侧不留空格（文字格式 1「与标点间不用空」）。
 *    两个例外：引号 `“”‘’` 两侧、书名号 `《》〈〉` 内侧 —— 那里可能是
 *    《新 吊带袜天使》《a子计划》这类故意留空的专有名词（文字格式 4），
 *    所以**书名号与引号内部一个字符都不动**。
 * 6. **半角标点** `, . ! ? :`：标点前不留空格、标点后空一格（英文符号 1）。
 *    小数点 / 版本号（`1.2.2`、`12:30`）、省略号（`...`）不适用。
 * 7. **括号 `()`**：内侧不留空格（英文符号 3）。
 * 8. **数字 ↔ 单位**：空一格（数学符号 2），默认关闭，单位须落在词表里。
 *
 * 不管的地方（不碰就是最安全的排版）：
 * - frontmatter、围栏代码块、缩进代码块、`$$…$$` 公式块（含中间那些行，整块跳过）；
 * - 书名号与引号内部（《新 吊带袜天使》《a子计划》：专有名词原样保留）；
 * - 行内代码、双链 `[[…]]`、markdown 链接、URL、HTML 标签、`%%注释%%`、`#标签`
 *   的内部（当成一个"英文单词"整体看，只决定它与左右邻居之间的空格）；
 * - 中文与中文之间的空格（可能是《新 吊带袜天使》这类故意留的，标点概论 3 也要求别乱删）；
 * - 数学运算符（`ctrl+c` 不能加空格，数学符号 1 自己也写了"非数学语境就不加"）。
 *
 * 幂等：每条规则的结果都是"恰好一个空格"或"没有空格"，输出再跑一次不会变。
 */
import { markProtectedLines, markIndentedCodeLines, inlineCodeRanges } from './line-scan';

/** 只决定"空一格"还是"不动"的规则 */
export type SpacingMode = 'space' | 'keep';

/** 中文与数字之间：可以选"不留空格"（按文档）、"空一格"或"不动" */
export type SpacingCjkDigitMode = 'none' | 'space' | 'keep';

/** 空格排版的八项规则 */
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
};

/** data.json 里被手工改成非法值时收敛回合法取值 */
export function resolveSpacingMode(value: unknown, fallback: SpacingMode): SpacingMode {
	return value === 'space' || value === 'keep' ? value : fallback;
}

export function resolveCjkDigitMode(value: unknown): SpacingCjkDigitMode {
	if (value === 'none' || value === 'space' || value === 'keep') return value;
	return DEFAULT_SPACING_OPTIONS.cjkDigit;
}

/** 八条规则是否全都处于"不动"状态 —— 是则整篇跳过，不做任何扫描 */
export function isSpacingActive(options: SpacingOptions): boolean {
	return options.cjkLatin !== 'keep'
		|| options.cjkDigit !== 'keep'
		|| options.latinDigit !== 'keep'
		|| options.mathText !== 'keep'
		|| options.fullPunct
		|| options.halfPunct
		|| options.bracketInner
		|| options.digitUnit;
}

// ------------------------------------------------------------------ 字符分类

/** 汉字、假名、谚文、全角字母数字：与任何字符之间都不需要空格 */
const CJK_RE = /[\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/;

/** 拉丁字母（含西欧重音字母）：与中文之间空一格 */
const LATIN_RE = /[A-Za-z\u00c0-\u024f]/;

/** 半角数字 */
const DIGIT_RE = /[0-9]/;

/**
 * 全角标点：中日文标点 + 全角形式的 ASCII 标点。
 * 这些符号本身就是一个字宽，前后再留空格就散了。
 */
const FULL_PUNCT = new Set<string>([
	...'、。〃〈〉《》「」『』【】〔〕〖〗〘〙〚〛〜…‥—–·•“”‘’′″・',
	...'！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝～￥',
]);

/** 全角括号：内侧不留空格（`（ 内容 ）` → `（内容）`） */
const FP_BRACKET_OPEN = new Set<string>([...'（【「『〔〖｛［']);

/** 书名号：前不留空格，**内侧保留** —— 《新 吊带袜天使》里的空格是专有名词的一部分 */
const FP_ANGLE_OPEN = new Set<string>([...'《〈']);

/** 引号：两侧都不动（引号里可能是英文短语或带空格的专有名词） */
const FP_QUOTE = new Set<string>([...'“”‘’']);

/** 半角标点：标点前不留空格、标点后空一格 */
const HALF_PUNCT = new Set<string>([...',.!?:']);

/** 单位词表（数字与单位之间空一格时用）；`%` 故意不收 —— `50%` 是通行写法 */
const UNITS = new Set<string>([
	// 长度 / 面积 / 体积
	'km', 'cm', 'mm', 'um', 'μm', 'nm', 'm', 'ml', 'mL', 'L',
	// 时间 / 频率
	'ms', 'us', 'μs', 'ns', 'min', 'h', 'Hz', 'kHz', 'MHz', 'GHz', 'rpm',
	// 质量
	'kg', 'mg', 'ug', 'μg', 'g',
	// 电 / 磁 / 热 / 力
	'W', 'kW', 'MW', 'V', 'mV', 'kV', 'A', 'mA', 'Ω', 'ohm', 'Pa', 'kPa', 'MPa', 'GPa',
	'N', 'J', 'kJ', 'MJ', 'cal', 'kcal', 'mol',
	// 数据 / 显示
	'KB', 'MB', 'GB', 'TB', 'bit', 'Byte', 'px', 'pt', 'dpi', 'ppi', 'fps',
]);

/** 一个字符就表示单位的：摄氏度、华氏度 */
const UNIT_CHARS = new Set<string>([...'℃℉']);

// ------------------------------------------------------------------ token

/** 全角标点的三种待遇 */
type FpClass =
	/** 括号：前不留空格，内侧也不留 */
	| 'bracketOpen'
	/** 书名号：前不留空格，内侧保留 */
	| 'angleOpen'
	/** 引号：两侧都不动 */
	| 'quote'
	/** 其余（顿号、句号、逗号、冒号、右括号…）：两侧都不留 */
	| 'other';

type PieceKind =
	/** 中文 / 假名 / 全角字母数字 */
	| 'cjk'
	/** 拉丁字母 */
	| 'latin'
	/** 半角数字 */
	| 'digit'
	/** 行内代码、双链、链接、URL、标签、注释：整体看待，与英文等价 */
	| 'word'
	/** 行内公式 `$…$` */
	| 'math'
	/** 全角标点 */
	| 'fpunct'
	/** 半角标点 `, . ! ? :` */
	| 'hpunct'
	/** ASCII 左括号 `(` */
	| 'open'
	/** ASCII 右括号 `)` */
	| 'close'
	/** 单独成单位的字符（`℃`），供"数字 ↔ 单位"规则使用 */
	| 'unit'
	/** 空白 */
	| 'space'
	/** 其它（`*` `=` `+` `-` `/` `|` `{` `}` `%` `#` …）：不参与任何规则 */
	| 'other';

interface Piece {
	kind: PieceKind;
	text: string;
	fp?: FpClass;
	/** 处在书名号 / 引号内部：专有名词与引文原样保留，任何规则都不适用 */
	title?: boolean;
	/** 属于"含字母的连写"（GPT4 / 3D / 100kg）：按英文单词处理，不按纯数字的贴紧规则 */
	inWord?: boolean;
}

/**
 * 书名号与引号：里面是专有名词或引文，原样保留。
 *
 * 《新 吊带袜天使》《a子计划》是文档里点名要保留原形的专有名词（文字格式 4），
 * 按常规规则 `a子计划` 会被拆成 `a 子计划`，所以这几种括号内部整体不参与排版。
 */
const TITLE_PAIRS: Record<string, string> = {
	'《': '》', '〈': '〉', '“': '”', '‘': '’',
};

/** 给书名号 / 引号内部的 piece 打标记（含嵌套写法，内层括号一律当内容） */
function markTitlePieces(pieces: Piece[]): void {
	let closer: string | null = null;

	for (const piece of pieces) {
		if (closer === null) {
			if (piece.kind !== 'fpunct') continue;
			const next = TITLE_PAIRS[piece.text];
			if (next) closer = next;
			continue;
		}
		if (piece.kind === 'fpunct' && piece.text === closer) {
			closer = null;
			continue;
		}
		if (piece.kind !== 'space') piece.title = true;
	}
}

/** 连写 token 的内部连接符：`v1.2.2`、`file_name`、`A-B`、`a/b` */
const WORD_SEPARATOR_RE = /^[._\-/]$/;

/**
 * 标记"含字母的连写"里的数字（GPT4、3D、v1.2.2、100kg）。
 *
 * 这种连写整体是一个英文单词，与中文之间按规则 1 空一格 —— 否则
 * `用GPT4写` 会变成 `用 GPT4写`：数字那一侧按规则 2 贴紧，型号就被拆开了。
 * **纯数字**（3、3.14、2024、1.2.2）不在此列，仍按"中文和数字之间不空"处理。
 */
function markAlphanumericWords(pieces: Piece[]): void {
	let group: Piece[] = [];
	let hasLatin = false;

	const flush = (): void => {
		if (hasLatin) {
			for (const piece of group) {
				if (piece.kind === 'digit') piece.inWord = true;
			}
		}
		group = [];
		hasLatin = false;
	};

	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece) continue;

		if (piece.kind === 'space') {
			// `100 kg`、`GPT 4`：数字与英文之间本来就该有的那一个空格不算分组结束。
			// 否则"数字 ↔ 单位"补上的空格会让数字在下一轮重新落回"纯数字"，
			// 中文那一侧的空格又被规则 2 删掉 —— 那样就不幂等了。
			const next = pieces[i + 1];
			const joins = piece.text === ' '
				&& group.length > 0
				&& next !== undefined
				&& (next.kind === 'latin' || next.kind === 'digit');
			if (joins) continue;
			flush();
			continue;
		}

		const joins = piece.kind === 'latin'
			|| piece.kind === 'digit'
			|| (piece.kind === 'other' && WORD_SEPARATOR_RE.test(piece.text));
		if (!joins) {
			flush();
			continue;
		}
		group.push(piece);
		if (piece.kind === 'latin') hasLatin = true;
	}
	flush();
}

// ------------------------------------------------------------------ 掩码区间

/**
 * 一行里"整体看待"的区间（左闭右开）：里面的字符不参与空格规则，
 * 只决定这个整体与左右邻居之间的距离。这也顺带挡住了里面的 `$`、`#`、`(`。
 */
function collectMaskedRanges(line: string): Array<[number, number]> {
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
 * 读一段行内公式。
 *
 * 识别方式与 Obsidian、latex-layout.ts 保持一致：`$` 内侧紧贴内容才算公式，
 * `$ 5 与 $` 这种不会误判；`$$…$$` 整体当一段公式。
 *
 * @returns 公式文本与下一个位置；不是公式时返回 null
 */
function readMath(line: string, start: number, inCode: (at: number) => boolean): { text: string; next: number } | null {
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

/** 把一个字符判成标点 / 括号 / 单位等单字符 piece；返回 null 表示交给后面的字母数字扫描 */
function classifyChar(char: string, line: string, at: number): { piece: Piece; next: number } | null {
	if (FULL_PUNCT.has(char)) {
		const fp: FpClass = FP_BRACKET_OPEN.has(char) ? 'bracketOpen'
			: FP_ANGLE_OPEN.has(char) ? 'angleOpen'
				: FP_QUOTE.has(char) ? 'quote'
					: 'other';
		return { piece: { kind: 'fpunct', text: char, fp }, next: at + 1 };
	}
	// 小数点 / 版本号 / 时间里的标点当普通字符：`1.2.2`、`12:30` 不该被拆
	if (HALF_PUNCT.has(char)) {
		const previous = line.charAt(at - 1);
		const next = line.charAt(at + 1);
		const numeric = DIGIT_RE.test(previous) && DIGIT_RE.test(next);
		// 省略号 `...`：前后都不加空格
		const ellipsis = char === '.' && (line.charAt(at + 1) === '.' || previous === '.');
		if (numeric || ellipsis) return { piece: { kind: 'other', text: char }, next: at + 1 };
		return { piece: { kind: 'hpunct', text: char }, next: at + 1 };
	}
	if (char === '(') return { piece: { kind: 'open', text: char }, next: at + 1 };
	if (char === ')') return { piece: { kind: 'close', text: char }, next: at + 1 };
	if (UNIT_CHARS.has(char)) return { piece: { kind: 'unit', text: char }, next: at + 1 };
	// `°C` / `°F`：度符号后面跟 C/F 才算单位
	if (char === '°' && /[CF]/.test(line.charAt(at + 1))) {
		return { piece: { kind: 'unit', text: line.substring(at, at + 2) }, next: at + 2 };
	}
	return null;
}

/** 把一行切成 piece；空白单独成 piece，输出里的空格全部由规则决定 */
function tokenizeLine(line: string): Piece[] {
	const ranges = collectMaskedRanges(line);
	const inCode = (at: number): boolean => ranges.some(([start, end]) => at >= start && at < end);
	const pieces: Piece[] = [];
	let index = 0;
	let rangeIndex = 0;

	while (index < line.length) {
		// 掩码区间：整体当一个"英文单词"，里面一个字符都不动
		const range = ranges[rangeIndex];
		if (range && index >= range[0] && index < range[1]) {
			pieces.push({ kind: 'word', text: line.substring(index, range[1]) });
			index = range[1];
			continue;
		}
		while (ranges[rangeIndex] && (ranges[rangeIndex] as [number, number])[1] <= index) rangeIndex++;

		const char = line.charAt(index);

		if (char === ' ' || char === '\t') {
			let end = index;
			while (end < line.length && (line.charAt(end) === ' ' || line.charAt(end) === '\t')) end++;
			pieces.push({ kind: 'space', text: line.substring(index, end) });
			index = end;
			continue;
		}

		if (char === '$') {
			const math = readMath(line, index, inCode);
			if (math) {
				pieces.push({ kind: 'math', text: math.text });
				index = math.next;
				continue;
			}
			pieces.push({ kind: 'other', text: char });
			index++;
			continue;
		}

		const classified = classifyChar(char, line, index);
		if (classified) {
			pieces.push(classified.piece);
			index = classified.next;
			continue;
		}

		// 字母 / 数字 / 中文：连成一段，省得逐字符判规则
		const kind: PieceKind | null = CJK_RE.test(char) ? 'cjk'
			: LATIN_RE.test(char) ? 'latin'
				: DIGIT_RE.test(char) ? 'digit'
					: null;
		if (!kind) {
			pieces.push({ kind: 'other', text: char });
			index++;
			continue;
		}

		const same = kind === 'cjk' ? CJK_RE : kind === 'latin' ? LATIN_RE : DIGIT_RE;
		let end = index;
		while (end < line.length && same.test(line.charAt(end)) && !inCode(end)) end++;
		pieces.push({ kind, text: line.substring(index, end) });
		index = end;
	}

	markAlphanumericWords(pieces);
	markTitlePieces(pieces);
	return pieces;
}

// ------------------------------------------------------------------ 间距规则

const isCjk = (piece: Piece): boolean => piece.kind === 'cjk';
/** 纯数字：与中文之间贴紧（数字 2）。GPT4 这类连写里的数字不算 */
const isDigit = (piece: Piece): boolean => piece.kind === 'digit' && piece.inWord !== true;
/** 半角数字本身（不论是否属于连写） */
const isRawDigit = (piece: Piece): boolean => piece.kind === 'digit';
/** 中文语境里的"英文"：拉丁字母、含字母的连写，以及与之等价的行内代码 / 双链 / 链接 / 标签 */
const isForeign = (piece: Piece): boolean =>
	piece.kind === 'latin' || piece.kind === 'word' || (piece.kind === 'digit' && piece.inWord === true);
/** 只按拉丁字母算（判断"英文 ↔ 数字"用，连写内部也照这条走） */
const isLatin = (piece: Piece): boolean => piece.kind === 'latin' || piece.kind === 'word';
/** 会被"标点后空一格"照顾到的内容 */
const isContent = (piece: Piece): boolean =>
	isCjk(piece) || isForeign(piece) || isRawDigit(piece) || piece.kind === 'math' || piece.kind === 'close';

const isUnit = (piece: Piece): boolean =>
	piece.kind === 'unit' || (piece.kind === 'latin' && UNITS.has(piece.text));

/** 按模式给出这个位置的空格：`space` → 恰好一个，`none` → 没有，`keep` → null（原样保留） */
function applyMode(mode: SpacingMode | SpacingCjkDigitMode): string | null {
	if (mode === 'space') return ' ';
	if (mode === 'none') return '';
	return null;
}

/**
 * 两个 piece 之间该留什么空格。
 *
 * @param previous 上一个非空 piece；行首为 null
 * @param next 当前 piece
 * @param gap 原文里两者之间的空白
 * @returns 新的空白；null 表示保持原样
 */
function decideGap(previous: Piece | null, next: Piece, gap: string, options: SpacingOptions): string | null {
	if (!previous) return null;

	// 书名号 / 引号内部：专有名词与引文原样保留，《a子计划》不能被拆成《a 子计划》
	if (previous.title && next.title) return null;

	// 括号内侧：`( x )` → `(x)`
	if (options.bracketInner) {
		if (previous.kind === 'open') return '';
		if (next.kind === 'close') return '';
	}

	// 全角标点：两侧不留空格（引号两侧、书名号内侧除外）
	if (options.fullPunct) {
		if (next.kind === 'fpunct' && next.fp !== 'quote') return '';
		if (previous.kind === 'fpunct') {
			if (previous.fp === 'quote' || previous.fp === 'angleOpen') return null;
			return '';
		}
	}

	// 数字 ↔ 单位：比「英文 ↔ 数字」更具体，先判
	if (options.digitUnit && isRawDigit(previous) && isUnit(next)) return ' ';

	// 中文 ↔ 英文（含行内代码 / 双链 / 链接 / 标签，以及 GPT4 这类含字母的连写）
	if ((isCjk(previous) && isForeign(next)) || (isForeign(previous) && isCjk(next))) {
		return applyMode(options.cjkLatin);
	}

	// 中文 ↔ 数字（纯数字）
	if ((isCjk(previous) && isDigit(next)) || (isDigit(previous) && isCjk(next))) {
		return applyMode(options.cjkDigit);
	}

	// 英文 ↔ 数字
	if ((isLatin(previous) && isRawDigit(next)) || (isRawDigit(previous) && isLatin(next))) {
		return applyMode(options.latinDigit);
	}

	// 行内公式 ↔ 文字
	if ((previous.kind === 'math' && isContent(next)) || (isContent(previous) && next.kind === 'math')) {
		if (next.kind !== 'close' && previous.kind !== 'open') return applyMode(options.mathText);
	}

	// 半角标点：前不留空格、后空一格
	if (options.halfPunct) {
		if (previous.kind === 'hpunct' && isContent(next)) return ' ';
		if (next.kind === 'hpunct' && isContent(previous)) return '';
	}

	return null;
}

/** 处理一行 */
function formatLine(line: string, options: SpacingOptions): string {
	const pieces = tokenizeLine(line);
	let out = '';
	let previous: Piece | null = null;
	let gap = '';

	for (const piece of pieces) {
		if (piece.kind === 'space') {
			gap += piece.text;
			continue;
		}
		const decided = decideGap(previous, piece, gap, options);
		out += (decided === null ? gap : decided) + piece.text;
		previous = piece;
		gap = '';
	}

	// 行尾空白（Markdown 的硬换行就是两个空格）原样保留
	return out + gap;
}

/**
 * 标记 `$$ … $$` 公式块**占用的所有行**（含中间那些既没有 `$$` 也没有别的标记的行）。
 *
 * line-scan.ts 里的 markMathLines 只标记"含有 `$$` 的那几行"，
 * 那是给标签排版用的（标签只需要知道自己在不在公式里）。这里要整块跳过，
 * 所以自己配一次对：配对规则与它一致（未闭合的 `$$` 不算公式，免得吃掉后面整篇正文），
 * 但把开闭之间的行一并标上。
 */
function markDisplayMathLines(lines: string[]): boolean[] {
	const flags: boolean[] = new Array<boolean>(lines.length).fill(false);
	const protectedLines = markProtectedLines(lines);
	let open = -1;

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		const line = lines[i] ?? '';
		const codeRanges = inlineCodeRanges(line);

		let count = 0;
		let at = line.indexOf('$$');
		while (at >= 0) {
			const escaped = at > 0 && line.charAt(at - 1) === '\\';
			const inCode = codeRanges.some(([start, end]) => at < end && at + 2 > start);
			if (!escaped && !inCode) count++;
			at = line.indexOf('$$', at + 2);
		}

		if (count === 0) continue;

		if (open < 0) {
			flags[i] = true;
			if (count % 2 === 1) open = i;
			continue;
		}
		// 收尾行（偶数是"这一行既收尾又重开"）
		for (let k = open; k <= i; k++) flags[k] = true;
		open = count % 2 === 1 ? -1 : i;
	}

	// 没闭合：这一段不算公式，把标记撤掉（否则后面整篇都会被当成公式）
	if (open >= 0) {
		for (let i = open; i < lines.length; i++) {
			if (!protectedLines[i]) flags[i] = false;
		}
	}

	return flags;
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
	const mathLines = markDisplayMathLines(lines);
	let changed = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		// frontmatter、代码块、`$$…$$` 公式：整行跳过
		if (protectedLines[i] || codeLines[i] || mathLines[i]) continue;
		if (line.trim() === '') continue;

		const fixed = formatLine(line, options);
		if (fixed !== line) {
			lines[i] = fixed;
			changed = true;
		}
	}

	return changed ? lines.join('\n') : content;
}
