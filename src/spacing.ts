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
 * 9. **符号自己的空格规则**（symbols.ts）：**空格只用来分隔不同语言的内容** ——
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
import { markProtectedLines, markIndentedCodeLines, markTableLines } from './line-scan';
import { collectMaskedRanges, isSpaceChar, mathRanges, readInlineMath } from './inline-scan';
import {
	CLOSE_QUOTE_RULE,
	OPEN_QUOTE_RULE,
	PACKAGE_RULE,
	STANDALONE_PIPE_RULE,
	SYMBOL_RULES as SYMBOL_TABLE,
	isMathGlue,
	isSymbolChar,
} from './symbols';
import type { SymbolPad, SymbolRule } from './symbols';

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
		|| options.symbolPad;
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

/**
 * 包裹符号的两个半边：内侧不留空格。
 *
 * 包裹符号是"表示里面的内容"的，**本身不算内容** —— 所以它和被它圈住的东西之间不留空格：
 * `（ 内容 ）` → `（内容）`、`《 书名 》` → `《书名》`、`“ 引文 ”` → `“引文”`。
 * 里面的符号（`（+）`、`（→）`、`（|）`）紧贴包裹符号的那一侧因此也不会被自己的规则
 * 加出一格来 —— 那一格正是"符号左右要加空格"遇上"包裹符号不算内容"时的结果。
 */
const FP_WRAPPER_OPEN = new Set<string>([...'（【「『〔〖｛［《〈“‘']);
const FP_WRAPPER_CLOSE = new Set<string>([...'）】」』〕〗｝］》〉”’']);

/** 半角标点：标点前不留空格、标点后空一格 */
const HALF_PUNCT = new Set<string>([...',.!?:']);

/** 半角 → 全角（`.` 不在内：省略号、版本号、缩写都靠它） */
const HALF_TO_FULL_PUNCT: Record<string, string> = {
	',': '，', ':': '：', ';': '；', '!': '！', '?': '？',
};

/**
 * 全角 → 半角：英文语境里这些要写成半角（`什么语境用什么标点`）。
 *
 * 只收不会跟中文混用的几个：`（）` 不收 —— 中文行里 `（utils/）`、`（schur 稳定）` 这种
 * 半中半英的括号很常见，两头分别判定会把括号改得不配对；
 * `：` 也不收 —— `data：` 这类"英文术语 + 中文解释"的小标题到处都是。
 */
const FULL_TO_HALF_PUNCT: Record<string, string> = {
	'，': ',', '。': '.', '、': ',', '；': ';', '！': '!', '？': '?',
};

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
	/** 落在以英文为主的句子里：全角标点两侧的空格是英文词距，不能当"中文与标点之间"删掉 */
	en?: boolean;
	/** 这个 piece 是一个"符号"（symbols.ts 的符号表）：它对自己的左右各有要求 */
	rule?: SymbolRule;
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

/** 中文标点里能断句的几个：用来把一行切成"句"，判断每句的语言 */
const SENTENCE_END = new Set<string>([...'。！？；']);

/**
 * 逐个 piece 标出它所在句子的语言：`zh` 以中文为主、`en` 以英文为主、`null` 拿不准。
 *
 * 中文句子里的半角标点要换全角、英文句子里的全角标点要换半角（什么语境用什么标点），
 * 可只看左邻一个字符不够：`建立子系统后没有 $M_{ij}$, 且 …` 里逗号左边是公式、右边才是中文。
 * 判定口径（公式、行内代码、链接、标签里的字母不算数 —— 那是数学或代码，不代表语言）：
 * - `en`：**整句一个中文字都没有**，且至少两个英文单词 —— 全库实测下来只有这样才敢反向换标点：
 *   中文笔记里"参数 gain=50、shift=0"、"（DARE/Kalman，schur 稳定）"这类半中半英的行太多，
 *   按比例判定会把顿号、逗号误换成半角；
 * - `zh`：有中文，且英文单词数不超过中文字数（用**词数**而不是字母数：
 *   `用 create_controlled_system，calculate_lqr 两个函数` 里英文字母一大把，但那是两个标识符，整句仍是中文）；
 * - 其余（半中半英、拿不准）都不动。
 * 句子按 `。！？；` 断开，piece 与原文一一对应（tokenize 不丢字符），所以用下标即可。
 */
function sentenceLanguages(pieces: Piece[]): Array<'zh' | 'en' | null> {
	const flags: Array<'zh' | 'en' | null> = new Array<'zh' | 'en' | null>(pieces.length).fill(null);
	let from = 0;
	let cjk = 0;
	let words = 0;

	const flush = (to: number): void => {
		const language = cjk === 0 && words >= 2 ? 'en'
			: cjk > 0 && words <= cjk ? 'zh'
				: null;
		for (let i = from; i < to; i++) flags[i] = language;
		from = to;
		cjk = 0;
		words = 0;
	};

	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i] as Piece;
		if (piece.kind === 'cjk') cjk += piece.text.length;
		else if (piece.kind === 'latin') words++;
		if (piece.kind === 'fpunct' && SENTENCE_END.has(piece.text)) flush(i + 1);
	}
	flush(pieces.length);

	return flags;
}

/** 往后跳过空白，看下一个 piece 是不是中文 */
function nextIsCjk(pieces: Piece[], from: number): boolean {
	for (let i = from; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece) return false;
		if (piece.kind === 'space') continue;
		return piece.kind === 'cjk';
	}
	return false;
}

/** 这个 piece 算不算"符号"：符号表里的、广义符号字符、或全角标点 */
function isSymbolPiece(piece: Piece): boolean {
	if (piece.rule !== undefined) return true;
	if (piece.kind === 'fpunct') return true;
	return piece.kind === 'other' && isSymbolChar(piece.text);
}

/**
 * 前后（跳过空格）紧贴着别的符号的标点不换全角。
 *
 * 笔记里到处是**在讲符号本身**的写法：`1. , /. /! /? /:：后面有空格`（罗列标点）、
 * `|：单独一个 | 左右要加空格`、`如, ：`（符号：解释）。这些标点是"被提到的符号"，
 * 换成全角就把要讲的东西抹掉了。原来只认紧贴 `/` 的标点（nearSlash），
 * 现在按整个符号表认：`/`、`|`、`：`、`→`、`&`、`^`、`=`… 都算。
 */
function nearSymbol(pieces: Piece[], index: number): boolean {
	const before = pieces[index - 1];
	if (before && isSymbolPiece(before)) return true;
	for (let i = index + 1; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece) return false;
		if (piece.kind === 'space') continue;
		return isSymbolPiece(piece);
	}
	return false;
}

/**
 * 半角标点换成全角（标点符号·概论 1「写中文就是全中文标点」）。
 *
 * 判定用"中文语境"而不是"左边必须是中文"：左邻是中文、右邻（跳过空格）是中文、
 * 或整句以中文为主，任一成立就换 —— `$M_{ij}$, 且` 因此能换成 `$M_{ij}$，且`。
 * 不动的几种：`.`（省略号 `...`、版本号 `1.2.2`、`e.g.` 都靠它）、`()`（`V(x)` 这类函数写法保持半角）、
 * 直接跟在数字后面的标点（`1,000`、`12:30`）、反斜杠后面的标点（LaTeX 的 `\,` 空格符号）、
 * 前后紧贴别的符号的标点（`1. , /. /! /? /:` 是在罗列标点本身，`如, ：` 是在讲这个符号）、
 * 聊天记录头部 `张三: 2024/01/05`，书名号 / 引号内部（专有名词原样保留，在 `title` 标记上跳过）；
 * 公式、行内代码、链接本来就不参与。
 */
function convertHalfPunct(pieces: Piece[], languages: Array<'zh' | 'en' | null>): void {
	let depth = 0;

	for (let i = 1; i < pieces.length; i++) {
		const piece = pieces[i];
		const previous = pieces[i - 1];
		if (!piece || !previous) continue;
		if (piece.kind === 'open') depth++;
		else if (piece.kind === 'close') depth = Math.max(0, depth - 1);
		if (piece.title) continue;
		// 半角括号里面是代码 / 数学记号（`(mod, k)`、`f(a, b)`），不当中文标点处理
		if (depth > 0) continue;
		// `;` 不在"半角标点间距"那张表里（文档只列了 `, . ! ? :`），所以它可能是 other
		if (piece.kind !== 'hpunct' && piece.kind !== 'other') continue;
		// `1,000`、`12:30`、`3.14`：直接跟在数字后面的是数字写法，不是中文标点
		if (previous.kind === 'digit') continue;
		// `\,`（LaTeX 空格符号）与 `x\\,`：反斜杠后面的标点是代码
		if (previous.kind === 'other' && previous.text === '\\') continue;
		const full = HALF_TO_FULL_PUNCT[piece.text];
		if (!full) continue;
		if (nearSymbol(pieces, i)) continue;
		if (previous.kind !== 'cjk' && !nextIsCjk(pieces, i + 1) && languages[i] !== 'zh') continue;
		// `张三: 2024/01/05 14:30:25`（聊天记录头部）与 `时间: 30` 这种"冒号后面是数字"的不换
		if (piece.text === ':' && nextIsDigit(pieces, i + 1)) continue;
		piece.kind = 'fpunct';
		piece.fp = 'other';
		piece.text = full;
		// 换成全角后按**新字符**的规则走（`：` 有自己的规则；`，` 不在表里 → 交给全角标点规则）。
		// 不能留旧规则、也不能清空不管：留下的旧规则会多给一格，清空则下一轮拿到的又是
		// `：` 自己的规则 —— 两条路必须得出同一个结果，否则一跑一次就变样。
		piece.rule = SYMBOL_TABLE[full];
	}
}

/** 紧邻（不跳空格）的字符是不是中文 */
function adjacentCjk(pieces: Piece[], index: number): boolean {
	const before = pieces[index - 1];
	const after = pieces[index + 1];
	return before?.kind === 'cjk' || after?.kind === 'cjk';
}

/**
 * 英文语境里的全角标点换成半角（`什么语境用什么标点`）。
 *
 * 只在**整句以英文为主**、并且标点两侧紧邻的不是中文时才换 ——
 * `This is a sentence。Then another，with parens！` → 半角；
 * 而 `中文说明。Then an English line, here.` 里的 `。` 左边是中文，保持不动。
 * `（）` 与 `：` 不在可换集合里，见 FULL_TO_HALF_PUNCT 的说明。
 */
function convertFullPunct(pieces: Piece[], languages: Array<'zh' | 'en' | null>): void {
	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece || piece.title) continue;
		if (piece.kind !== 'fpunct') continue;
		const half = FULL_TO_HALF_PUNCT[piece.text];
		// 单个 `…` 换成 `...`；成对的中文省略号 `……` 不动（换出来会变成六个点）
		const ellipsis = piece.text === '…';
		if (!half && !ellipsis) continue;
		if (languages[i] !== 'en') continue;
		if (adjacentCjk(pieces, i)) continue;
		if (ellipsis) {
			const before = pieces[i - 1];
			const after = pieces[i + 1];
			if (before?.text === '…' || after?.text === '…') continue;
			piece.kind = 'hpunct';
			piece.fp = undefined;
			piece.text = '...';
			piece.rule = SYMBOL_TABLE['...'];
			continue;
		}
		piece.kind = 'hpunct';
		piece.fp = undefined;
		piece.text = half as string;
		// 与 convertHalfPunct 对称：换成半角后按新字符的规则走（`.` `,` `!` `?` 后空一格）
		piece.rule = SYMBOL_TABLE[half as string];
	}
}

/** 往后跳过空白，看是不是数字开头 */
function nextIsDigit(pieces: Piece[], from: number): boolean {
	for (let i = from; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece || piece.kind === 'space') continue;
		return piece.kind === 'digit';
	}
	return false;
}

/** 强调标记用到的符号 */
const EMPHASIS_CHARS = new Set<string>([...'*_=~']);

/**
 * 一段标记算不算强调标记：`*` `**` `***`、`_` `__` `___`、`==`、`~~`。
 * 单个 `=` 与单个 `~` 不算 —— `a=b`、`x~y` 里它们是普通符号。
 */
function emphasisMarker(text: string): string | null {
	if (/^\*{1,3}$/.test(text) || /^_{1,3}$/.test(text) || text === '==' || text === '~~') return text;
	return null;
}

/**
 * 把强调标记并进它包住的那段内容里，让排版规则只看得到"内容"。
 *
 * 标记本身不显示，却会挡住规则：`**可逆矩阵**$P$` 里公式左边其实是中文，紧邻的却是 `*`，
 * 于是"公式与文字之间空一格"落空（`**可逆矩阵**$P$` 一动不动），
 * 反过来 `$P$**粗体**` 也一样。
 *
 * 开标记并给后面那段内容、闭标记并给前面那段内容 —— 空格只会落在标记**外面**，
 * 不会插进 `**` 与文字之间（`** English**` 会让粗体标记失效，渲染成两个星号）。
 * 配不上对的标记（`a*b`、`2*3` 里的 `*`）原样留着，不参与规则。
 */
function mergeEmphasisMarkers(pieces: Piece[]): Piece[] {
	// 1. 相邻的同类标记字符合成一段：`*` + `*` → `**`
	const runs: Piece[] = [];
	for (const piece of pieces) {
		const last = runs[runs.length - 1];
		if (last && last.kind === 'other' && piece.kind === 'other'
			&& last.text === piece.text && EMPHASIS_CHARS.has(piece.text)) {
			last.text += piece.text;
			continue;
		}
		runs.push({ ...piece });
	}

	// 2. 配对：同一个标记（字符与长度都一致）左开右闭；开标记后面、闭标记前面都要紧贴内容
	const pending = new Map<string, number>();
	const pairs: Array<[number, number]> = [];
	for (let i = 0; i < runs.length; i++) {
		const piece = runs[i];
		if (!piece || piece.kind !== 'other') continue;
		const marker = emphasisMarker(piece.text);
		if (!marker) continue;

		const attachedBefore = runs[i - 1] !== undefined && (runs[i - 1] as Piece).kind !== 'space';
		const attachedAfter = runs[i + 1] !== undefined && (runs[i + 1] as Piece).kind !== 'space';
		const open = pending.get(marker);

		if (open !== undefined && attachedBefore) {
			pairs.push([open, i]);
			pending.delete(marker);
			continue;
		}
		if (attachedAfter) pending.set(marker, i);
	}

	// 3. 并进去：开标记 → 后面那段内容，闭标记 → 前面那段内容
	const content = (from: number, step: 1 | -1): Piece | null => {
		for (let i = from; i >= 0 && i < runs.length; i += step) {
			const piece = runs[i];
			if (!piece || piece.kind === 'space') continue;
			if (piece.kind === 'other' && emphasisMarker(piece.text)) continue;
			return piece;
		}
		return null;
	};

	const removed = new Set<number>();
	for (const [open, close] of pairs) {
		const first = content(open + 1, 1);
		const last = content(close - 1, -1);
		if (first) first.text = (runs[open] as Piece).text + first.text;
		if (last) last.text += (runs[close] as Piece).text;
		removed.add(open);
		removed.add(close);
	}

	return runs.filter((_, index) => !removed.has(index));
}

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

/** 把一个字符判成标点 / 括号 / 单位等单字符 piece；返回 null 表示交给后面的字母数字扫描 */
function classifyChar(char: string, line: string, at: number): { piece: Piece; next: number } | null {
	if (FULL_PUNCT.has(char)) {
		const fp: FpClass = FP_BRACKET_OPEN.has(char) ? 'bracketOpen'
			: FP_ANGLE_OPEN.has(char) ? 'angleOpen'
				: FP_QUOTE.has(char) ? 'quote'
					: 'other';
		return { piece: { kind: 'fpunct', text: char, fp, rule: SYMBOL_TABLE[char] }, next: at + 1 };
	}
	// 小数点 / 版本号 / 时间里的标点当普通字符：`1.2.2`、`12:30` 不该被拆
	if (HALF_PUNCT.has(char)) {
		const previous = line.charAt(at - 1);
		const next = line.charAt(at + 1);
		const numeric = DIGIT_RE.test(previous) && DIGIT_RE.test(next);
		// 省略号 `...`：前后都不加空格
		const ellipsis = char === '.' && (line.charAt(at + 1) === '.' || previous === '.');
		if (numeric || ellipsis) return { piece: { kind: 'other', text: char }, next: at + 1 };
		return { piece: { kind: 'hpunct', text: char, rule: SYMBOL_TABLE[char] }, next: at + 1 };
	}
	if (char === '(') return { piece: { kind: 'open', text: char }, next: at + 1 };
	if (char === ')') return { piece: { kind: 'close', text: char }, next: at + 1 };
	if (UNIT_CHARS.has(char)) return { piece: { kind: 'unit', text: char }, next: at + 1 };
	// `°C` / `°F`：度符号后面跟 C/F 才算单位
	if (char === '°' && /[CF]/.test(line.charAt(at + 1))) {
		return { piece: { kind: 'unit', text: line.substring(at, at + 2) }, next: at + 2 };
	}
	// `→` `&` `^` 这些排版符号：has 自己的左右空格规则（`|` 要看邻居，留给后面的成串扫描）
	const rule = char === '|' ? undefined : SYMBOL_TABLE[char];
	if (rule) return { piece: { kind: 'other', text: char, rule }, next: at + 1 };
	return null;
}

/** 把一行切成 piece；空白单独成 piece，输出里的空格全部由规则决定 */
function tokenizeLine(line: string, options: SpacingOptions): Piece[] {
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

		if (isSpaceChar(char)) {
			let end = index;
			while (end < line.length && isSpaceChar(line.charAt(end))) end++;
			pieces.push({ kind: 'space', text: line.substring(index, end) });
			index = end;
			continue;
		}

		if (char === '$') {
			const math = readInlineMath(line, index, inCode);
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
	// 符号的成串扫描要排在换全角前面：`如, ：` 里的 `,` 得先被认成符号，才不会被换成 `，`
	markSymbolPieces(pieces);
	// 「半角标点前不留空格、后空一格」关掉时，` , . ! ? :` 退出符号表（其余符号照旧）
	if (!options.halfPunct) {
		for (const piece of pieces) {
			if (piece.rule !== undefined && HALF_PUNCT.has(piece.text)) piece.rule = undefined;
		}
	}
	if (options.halfToFullPunct) {
		const languages = sentenceLanguages(pieces);
		for (let i = 0; i < pieces.length; i++) {
			if (languages[i] === 'en') (pieces[i] as Piece).en = true;
		}
		// 先逆向（英文句里的全角 → 半角），再正向（中文句里的半角 → 全角）
		convertFullPunct(pieces, languages);
		convertHalfPunct(pieces, languages);
	}
	return mergeEmphasisMarkers(pieces);
}

// ------------------------------------------------------------------ 符号

/**
 * `...` 合成一个符号。三个点各自是 `other`，逐字符判规则会判错（`1.2.2` 里的点也是 other），
 * 合成一段再给「前后没有空格」（英文符号 3）。
 */
function markEllipsisRuns(pieces: Piece[]): void {
	let i = 0;
	while (i < pieces.length) {
		const piece = pieces[i];
		if (!piece || piece.kind !== 'other' || piece.text !== '.') {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < pieces.length) {
			const next = pieces[end + 1];
			if (next && next.kind === 'other' && next.text === '.') end++;
			else break;
		}
		const count = end - i + 1;
		if (count >= 2) {
			piece.text = '.'.repeat(count);
			piece.rule = SYMBOL_TABLE['...'];
			pieces.splice(i + 1, count - 1);
		}
		i++;
	}
}

/**
 * 竖线。连续两个及以上（`||`）整体是包裹符号，按 176 贴紧；
 * 单独一个要看它是不是数学记号的一部分 —— `|x|`、`P(A|B)`、`x̂_{k|k}`、`\left\|`
 * 这类紧贴字母 / 数字 / `_` `^` `{` `}` `\` 的竖线是数学里的一部分，一个字符都不动；
 * 只有"单独一个"（latex 符号格式 4）才左右各留一格，如 `a | b`、`| ：单独一个`。
 */
function markPipePieces(pieces: Piece[]): void {
	let i = 0;
	while (i < pieces.length) {
		const piece = pieces[i];
		if (!piece || piece.kind !== 'other' || piece.text !== '|') {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < pieces.length) {
			const next = pieces[end + 1];
			if (next && next.kind === 'other' && next.text === '|') end++;
			else break;
		}
		const count = end - i + 1;
		if (count >= 2) {
			piece.text = '|'.repeat(count);
			piece.rule = PACKAGE_RULE;
			pieces.splice(i + 1, count - 1);
			i++;
			continue;
		}

		const before = pieces[i - 1];
		const after = pieces[i + 1];
		const gluedLeft = before !== undefined && before.kind !== 'space'
			&& isMathGlue(before.text.slice(-1));
		const gluedRight = after !== undefined && after.kind !== 'space'
			&& isMathGlue(after.text.charAt(0));
		piece.rule = gluedLeft || gluedRight ? PACKAGE_RULE : STANDALONE_PIPE_RULE;
		i++;
	}
}

/** `&&` 这类连着的同一个符号合成一段，免得规则在它们中间又插一个空格 */
function markSymbolRuns(pieces: Piece[], char: string): void {
	let i = 0;
	while (i < pieces.length) {
		const piece = pieces[i];
		if (!piece || piece.text !== char) {
			i++;
			continue;
		}
		let end = i;
		while (end + 1 < pieces.length) {
			const next = pieces[end + 1];
			if (next && next.text === char) end++;
			else break;
		}
		if (end > i) {
			piece.text = char.repeat(end - i + 1);
			pieces.splice(i + 1, end - i);
		}
		i++;
	}
}

/**
 * 缩写与专有名词里的点、和号不动：`e.g.`、`i.e.`、`U.S.`、`Q&A`、`R&D`。
 *
 * 这些符号的两边都是**单个拉丁字母**，是缩写本身的一部分，不是一个独立的排版符号 ——
 * 加了空格就把 `e.g.` 拆成 `e. g.`、把 `Q&A` 拆成 `Q & A`；
 * 文字格式 4「专有名词空格以原有形式为准」说的就是这种情形。
 *
 * 缩写点还要改成 `other`（跟小数点 `3.14` 里的点一样）：不然"标点后空一格"那条
 * 老规则照样会在 `e.` 和 `g` 之间补一个空格。
 */
function markAbbreviationPieces(pieces: Piece[]): void {
	for (let i = 1; i < pieces.length - 1; i++) {
		const piece = pieces[i];
		if (!piece || piece.rule === undefined || (piece.text !== '.' && piece.text !== '&')) continue;

		const before = pieces[i - 1];
		const after = pieces[i + 1];
		if (before?.kind === 'latin' && before.text.length === 1
			&& after?.kind === 'latin' && after.text.length === 1) {
			piece.rule = undefined;
			if (piece.text === '.') piece.kind = 'other';
		}
	}
}

/**
 * 半角引号：成对时才认，两个半边都按包裹符号处理 —— **内侧不留空格**、外侧不动。
 *
 * 包裹符号是"突出里面内容"的（标点符号·概论 4），所以 `" + "` → `"+"`、
 * `" 引文 "` → `"引文"`；落单的引号（`2" 的管子`）不成对，一个字符都不动。
 */
function markQuotePieces(pieces: Piece[]): void {
	let count = 0;
	for (const piece of pieces) {
		if (piece.kind === 'other' && piece.text === '"') count++;
	}
	if (count === 0 || count % 2 !== 0) return;

	let seen = 0;
	for (const piece of pieces) {
		if (piece.kind !== 'other' || piece.text !== '"') continue;
		piece.rule = seen % 2 === 0 ? OPEN_QUOTE_RULE : CLOSE_QUOTE_RULE;
		seen++;
	}
}

/** 西文内容：字母 / 数字 / 公式 / 行内代码（`scope: 'latin'` 的符号认这个当"西文语境"） */
function isLatinContent(piece: Piece | null): boolean {
	return piece !== null && (isForeign(piece) || isRawDigit(piece) || piece.kind === 'math');
}

/** 从 index 往 step 方向找第一个非空白 piece（行首 / 行尾返回 null） */
function neighbourOf(pieces: Piece[], index: number, step: 1 | -1): Piece | null {
	for (let i = index + step; i >= 0 && i < pieces.length; i += step) {
		const piece = pieces[i];
		if (!piece) break;
		if (piece.kind === 'space') continue;
		return piece;
	}
	return null;
}

/**
 * `scope: 'latin'` 的符号（`&` `|` `→` 与引号外侧）：**两侧都是西文内容**才算法"西文语境"，
 * 这时按英文规则留一格；只要有一侧是中文或符号，整条符号就按中文/数学符号处理，两侧都贴紧。
 *
 * 这样同一个符号不会一边留一格、一边贴紧：`A & B`、`mm → voxel` 留一格，
 * 而 `甲 & 乙`、`前向 → 批量消融前向`、`rel+pred_full → 批量` 统统收成贴紧。
 * 行首 / 行尾那一侧没有邻居，不算"不是西文"（`| $A$ …` 这种行内分隔符的留白因此保住）。
 */
function markLatinContextPieces(pieces: Piece[]): void {
	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i];
		if (!piece || piece.rule?.scope !== 'latin') continue;

		const before = neighbourOf(pieces, i, -1);
		const after = neighbourOf(pieces, i, 1);
		const blocked = (side: Piece | null): boolean => side !== null && !isLatinContent(side);
		if (!blocked(before) && !blocked(after)) continue;
		piece.rule = { ...piece.rule, left: 'none', right: 'none' };
	}
}

/** 符号相关的成串扫描：`...`、`|`、`&&`、半角引号、缩写，最后定"西文语境" */
function markSymbolPieces(pieces: Piece[]): void {
	markEllipsisRuns(pieces);
	markPipePieces(pieces);
	markSymbolRuns(pieces, '&');
	markQuotePieces(pieces);
	markAbbreviationPieces(pieces);
	markLatinContextPieces(pieces);
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

/** 全角括号 / 书名号 / 引号：包裹符号，空格规则交给下面原有的分支 */
function defersToWrapper(piece: Piece): boolean {
	return piece.kind === 'fpunct' && piece.fp !== 'other';
}

/**
 * 认不出来的邻居：`other` 里没有自己规则的杂项（希腊字母 `ε`、`*`、`%`、`[`、`\` …）。
 *
 * 这些既不是中文也不是认得的符号，规则不敢替它们做主 —— 删空格会把
 * `(ε_r, ε_a)`、`test_XX_<被测函数>. m` 这类写法拆坏，所以遇到它们"不动"。
 */
function isUnknownPiece(piece: Piece): boolean {
	return piece.kind === 'other' && piece.rule === undefined && !isSymbolChar(piece.text);
}

/**
 * 取一个符号对自己某一侧的要求。
 *
 * `scope: 'latin'` 的符号已经由 `markLatinContextPieces` 定过语境（非西文语境的一律改成贴紧），
 * 所以这里的判断只是兜底。
 *
 * - `space`（要一格）：邻居在规则的作用范围里就留一格（`word, word`、`A & B`、
 *   `1.矩阵指数` → `1. 矩阵指数`）；邻居是中文或认得的符号却不在范围内 → 贴紧
 *   （`甲 & 乙` → `甲&乙`、`如, ：` → `如,：`）；邻居认不出来 → 不动；
 * - `none`（不留）：一律生效（`中文 ：内容` → `中文：内容`、`x ^ 2` → `x^2`）；
 * - 行首左边、行尾右边没有邻居，自然没有空格要判。
 */
function symbolPadOf(piece: Piece, side: 'left' | 'right', neighbour: Piece): SymbolPad | undefined {
	const rule = piece.rule;
	if (!rule) return undefined;

	const pad = side === 'left' ? rule.left : rule.right;
	if (pad !== 'space') return pad;
	if (isUnknownPiece(neighbour)) return 'keep';

	const accepts = rule.scope === 'latin' ? isLatinContent(neighbour) : isContent(neighbour);
	return accepts ? 'space' : 'none';
}

/**
 * 符号自己的空格规则。
 *
 * 两个符号相邻时贴紧 —— `如, ：` → `如,：`、`| ：单独一个` → `|：单独一个`
 * （符号的"要一格"只朝西文内容生效，所以这种位置上两边都不作主）；
 * 一边是西文内容时按规则留一格：`$A$ & $B$`、`A & B`、`word, word`。
 *
 * 遇到括号 / 书名号 / 引号这类包裹符号就让位给原有分支（`word (x)`、`如《书》等` 原样保留）。
 */
function symbolGap(previous: Piece, next: Piece): string | null {
	if (defersToWrapper(previous) || defersToWrapper(next)) return null;

	const leftPad = symbolPadOf(previous, 'right', next);
	const rightPad = symbolPadOf(next, 'left', previous);
	if (leftPad === 'none' || rightPad === 'none') return '';
	if (leftPad === 'space' || rightPad === 'space') return ' ';
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

	// 符号自己的规则优先：`如, ：` 的那一格不能被子句的"全角标点前不留空格"吃掉
	if (options.symbolPad) {
		const pad = symbolGap(previous, next);
		if (pad !== null) return pad;
	}

	// 括号内侧：`( x )` → `(x)`
	if (options.bracketInner) {
		if (previous.kind === 'open') return '';
		if (next.kind === 'close') return '';
	}

	// 全角标点：两侧不留空格（引号两侧、书名号内侧除外）
	// 英文句子里的全角标点（`see 《book》 and`）两侧是英文词距，不删
	if (options.fullPunct && previous.en !== true && next.en !== true) {
		// 包裹符号内侧不留空格：包裹符号本身不算内容，`（ 内容 ）` → `（内容）`、
		// `《 书名 》` → `《书名》`、`“ 引文 ”` → `“引文”`（里面的专有名词空格照旧保留）
		if (previous.kind === 'fpunct' && FP_WRAPPER_OPEN.has(previous.text)) return '';
		if (next.kind === 'fpunct' && FP_WRAPPER_CLOSE.has(next.text)) return '';
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

/**
 * 行首标记（列表 `-` `1.`、标题 `#`、引用 `>`，以及列表项里的任务复选框 `- [x]`）：
 * 标记与它后面那一个空格是语法，交给标记排版（markdown-markers.ts）管，空格规则不许碰 ——
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

	const pieces = tokenizeLine(prefix ? line.substring(prefix.length) : line, options);
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
