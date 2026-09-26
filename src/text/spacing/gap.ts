/**
 * 空格的词间判定：两个相邻 piece 之间留什么空格（原 spacing.ts 的「间距规则」一节）。
 *
 * 判 gap 用到的字符集合（包裹符号半边、单位词表）与内容判定（西文内容）也放在这里。
 */
import { isSymbolChar } from '../symbols';
import type { SymbolPad } from '../symbols';
import { appendixLabelPiece, chapterGap, chapterMarkerAt } from '../chapter-title';
import type { Piece } from './tokenize';
import type { SpacingCjkDigitMode, SpacingMode, SpacingOptions } from './index';

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

/** 西文内容：字母 / 数字 / 公式 / 行内代码（`scope: 'latin'` 的符号认这个当"西文语境"） */
export function isLatinContent(piece: Piece | null): boolean {
	return piece !== null && (isForeign(piece) || isRawDigit(piece) || piece.kind === 'math');
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

// -------------------------------------------------------------- 章节标题标记

/**
 * 「第一章，第一课，附录1 等标题和标题内容之间需要加空格」（文字格式 / 中文 1）。
 *
 * 判定本身在 chapter-title.ts：分词器按 `chapterMarkers` 把 `第一章矩阵` 切成
 * `第一章` + `矩阵` 两个 piece，这里负责决定这个切点上补不补那一格：
 *
 * - 标记**内部**的切点（`第`|`1`|`章`）返回 null：数字是序号的一部分，
 *   那儿该不该空由"中文 ↔ 数字"那条说了算（切分不能顺手改掉别的规则的口径）；
 * - 标记与内容之间（`第一章`|`矩阵`）补一格；
 * - 已经空开的不动（`第一章 矩阵`）—— 那两格属于"中文与中文之间的空格不动"，
 *   也免得把 `第一章  矩阵` 收成一格。
 */
function chapterTitleGap(line: string, previous: Piece, next: Piece, gap: string): string | null {
	if (gap !== '' || previous.end === undefined || next.start === undefined) return null;
	if (next.start !== previous.end) return null;

	const marker = chapterMarkerAt(line, next.start);
	return marker ? chapterGap(line, marker.from, marker.boundary) : null;
}

/**
 * `附录` 与紧跟其后的序号：标题标记是**一个整体**（`附录A`），中间不该有空格。
 *
 * 标记后面还有内容时才贴（`附录 A 矩阵` → `附录A 矩阵`）——
 * `附录 A` 单独一行时那是个普通的词距，不该被收掉（那也不是"标题 + 内容"）。
 */
function appendixGlue(line: string, previous: Piece, next: Piece, gap: string): boolean {
	if (gap !== '' && gap !== ' ') return false;
	if (!appendixLabelPiece(previous.text + next.text)) return false;
	return next.end !== undefined && next.end < line.length;
}

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
 * @param line 这一行的完整文本（章节标题标记要看标记前后的内容，只在行文本上判定）
 * @param previous 上一个非空 piece；行首为 null
 * @param next 当前 piece
 * @param gap 原文里两者之间的空白
 * @returns 新的空白；null 表示保持原样
 */
export function decideGap(
	line: string,
	previous: Piece | null,
	next: Piece,
	gap: string,
	options: SpacingOptions
): string | null {
	if (!previous) return null;

	// 书名号 / 引号内部：专有名词与引文原样保留，《a子计划》不能被拆成《a 子计划》
	if (previous.title && next.title) return null;

	// 符号自己的规则优先：`如, ：` 的那一格不能被子句的"全角标点前不留空格"吃掉
	if (options.symbolPad) {
		const pad = symbolGap(previous, next);
		if (pad !== null) return pad;
	}

	// 括号：包裹符号自己不添空格（通用符号 3 的包裹符号子条目「内外均没有空格」）—— 内侧的填充删掉，
	// 外侧也不主动加，就是 `f(x)` 那种函数写法（`中文 (说明)` → `中文(说明)`）。
	// 英文句子里括号两侧是**英文自带的词距**，不算包裹符号的空格，保留（与全角标点同一条规矩）
	if (options.bracketInner) {
		if (previous.kind === 'open' || next.kind === 'close') return '';
		const english = previous.en === true || next.en === true;
		if (!english && (next.kind === 'open' || previous.kind === 'close')) return '';
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

	// 章节 / 课次 / 附录这类标题标记与标题内容之间空一格（文字格式 / 中文 1）。
	// 只认**紧贴**的标记与内容（`第一章矩阵`、`第1课五十音`、`附录A矩阵`）：
	// 已经空开的一律不动，`第 3 章` 里序号两侧那两格仍归"中文与数字之间不留空格"管
	if (options.chapterTitle) {
		// 标题标记自己是"一个整体"：`附录` 与它的序号（`附录A`）贴紧
		if (appendixGlue(line, previous, next, gap)) return '';
		const pad = chapterTitleGap(line, previous, next, gap);
		if (pad !== null) return pad;
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
