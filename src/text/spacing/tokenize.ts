/**
 * 空格排版的分词：字符分类 → 逐字符切分（tokenizeLine）→ 分词期的标点 / 符号处理。
 *
 * 对应原 spacing.ts 的「字符分类」「token」「符号」三节；分词之后的间距判定见 ./gap。
 */
import { collectMaskedRanges, isSpaceChar, readInlineMath } from '../inline-scan';
import { appendixLabelPiece, chapterMarkers } from '../chapter-title';
import {
	CLOSE_QUOTE_RULE,
	OPEN_QUOTE_RULE,
	PACKAGE_RULE,
	STANDALONE_PIPE_RULE,
	SYMBOL_RULES as SYMBOL_TABLE,
	isMathGlue,
	isSymbolChar,
} from '../symbols';
import type { SymbolRule } from '../symbols';
import { isLatinContent } from './gap';
import type { SpacingOptions } from './index';

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

export interface Piece {
	kind: PieceKind;
	text: string;
	/** 这个 piece 在**行内**的起止位置（空格排版按位置判"标记与内容是否紧贴"，见 gap.ts） */
	start?: number;
	end?: number;
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
	/** 记下这个 piece 的行内位置（`next` 就是它结束的位置，`°C` 这类两个字符的也一样） */
	const at2 = (piece: Piece, next: number): { piece: Piece; next: number } =>
		({ piece: { ...piece, start: at, end: next }, next });

	if (FULL_PUNCT.has(char)) {
		const fp: FpClass = FP_BRACKET_OPEN.has(char) ? 'bracketOpen'
			: FP_ANGLE_OPEN.has(char) ? 'angleOpen'
				: FP_QUOTE.has(char) ? 'quote'
					: 'other';
		return at2({ kind: 'fpunct', text: char, fp, rule: SYMBOL_TABLE[char] }, at + 1);
	}
	// 小数点 / 版本号 / 时间里的标点当普通字符：`1.2.2`、`12:30` 不该被拆
	if (HALF_PUNCT.has(char)) {
		const previous = line.charAt(at - 1);
		const next = line.charAt(at + 1);
		const numeric = DIGIT_RE.test(previous) && DIGIT_RE.test(next);
		// 省略号 `...`：前后都不加空格
		const ellipsis = char === '.' && (line.charAt(at + 1) === '.' || previous === '.');
		if (numeric || ellipsis) return at2({ kind: 'other', text: char }, at + 1);
		return at2({ kind: 'hpunct', text: char, rule: SYMBOL_TABLE[char] }, at + 1);
	}
	if (char === '(') return at2({ kind: 'open', text: char }, at + 1);
	if (char === ')') return at2({ kind: 'close', text: char }, at + 1);
	if (UNIT_CHARS.has(char)) return at2({ kind: 'unit', text: char }, at + 1);
	// `°C` / `°F`：度符号后面跟 C/F 才算单位
	if (char === '°' && /[CF]/.test(line.charAt(at + 1))) {
		return at2({ kind: 'unit', text: line.substring(at, at + 2) }, at + 2);
	}
	// `→` `&` `^` 这些排版符号：都有自己的左右空格规则（`|` 要看邻居，留给后面的成串扫描）
	const rule = char === '|' ? undefined : SYMBOL_TABLE[char];
	if (rule) return at2({ kind: 'other', text: char, rule }, at + 1);
	return null;
}

/**
 * 把一行切成 piece；空白单独成 piece，输出里的空格全部由规则决定。
 *
 * 切完之后还有两步"按内容再切一刀"（都要在索引敏感的处理之后做）：
 * 章节 / 课次 / 附录这类标题标记与标题内容之间切成两块（`第一章矩阵` → `第一章` | `矩阵`），
 * 让空格判定有位置可以补那一格；`附录` 与紧跟的序号并成一个 piece（`附录A` —— 序号不算独立的英文单词）。
 */
export function tokenizeLine(line: string, options: SpacingOptions): Piece[] {
	const ranges = collectMaskedRanges(line);
	const inCode = (at: number): boolean => ranges.some(([start, end]) => at >= start && at < end);
	const pieces: Piece[] = [];
	let index = 0;
	let rangeIndex = 0;

	while (index < line.length) {
		// 掩码区间：整体当一个"英文单词"，里面一个字符都不动
		const range = ranges[rangeIndex];
		if (range && index >= range[0] && index < range[1]) {
			pieces.push({ kind: 'word', text: line.substring(index, range[1]), start: index, end: range[1] });
			index = range[1];
			continue;
		}
		while (ranges[rangeIndex] && (ranges[rangeIndex] as [number, number])[1] <= index) rangeIndex++;

		const char = line.charAt(index);

		if (isSpaceChar(char)) {
			let end = index;
			while (end < line.length && isSpaceChar(line.charAt(end))) end++;
			pieces.push({ kind: 'space', text: line.substring(index, end), start: index, end });
			index = end;
			continue;
		}

		if (char === '$') {
			const math = readInlineMath(line, index, inCode);
			if (math) {
				pieces.push({ kind: 'math', text: math.text, start: index, end: math.next });
				index = math.next;
				continue;
			}
			pieces.push({ kind: 'other', text: char, start: index, end: index + 1 });
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
			pieces.push({ kind: 'other', text: char, start: index, end: index + 1 });
			index++;
			continue;
		}

		const same = kind === 'cjk' ? CJK_RE : kind === 'latin' ? LATIN_RE : DIGIT_RE;
		let end = index;
		while (end < line.length && same.test(line.charAt(end)) && !inCode(end)) end++;
		pieces.push({ kind, text: line.substring(index, end), start: index, end });
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
	// 句子语言：标点全半角要用（halfToFullPunct），括号外侧的"英文句里保留词距"也要用，
	// 所以一律算出来
	const languages = sentenceLanguages(pieces);
	for (let i = 0; i < pieces.length; i++) {
		if (languages[i] === 'en') (pieces[i] as Piece).en = true;
	}
	if (options.halfToFullPunct) {
		// 先逆向（英文句里的全角 → 半角），再正向（中文句里的半角 → 全角）
		convertFullPunct(pieces, languages);
		convertHalfPunct(pieces, languages);
	}
	return mergeEmphasisMarkers(
		options.chapterTitle ? splitChapterTitles(mergeAppendixLabels(pieces)) : pieces
	);
}

// -------------------------------------------------------- 章节标题标记的切分

/**
 * 把 `附录` 与紧跟其后的序号并成一个 piece（`附录A`、`附录1`、`附录一`）。
 *
 * 不并的话序号会按"中文 ↔ 英文 / 数字"拿到空格（`附录A矩阵` → `附录 A 矩阵`），
 * 而标题标记是"一个整体"（文字格式 / 中文 1 的 `附录1` 就是一例）——
 * 那一格该落在**标记与标题内容之间**，不是标记内部。序号与"附录"之间本来就空开的
 * （`附录 A 矩阵`）也收掉：合并后 decision 只看见一个 piece，等于把那一格删了。
 *
 * 只在序号后面紧跟着内容时才并（`附录A`、`附录 A` 单独出现时保持原样）。
 */
function mergeAppendixLabels(pieces: Piece[]): Piece[] {
	const out: Piece[] = [];

	for (let i = 0; i < pieces.length; i++) {
		const piece = pieces[i] as Piece;
		const next = pieces[i + 1];
		const spacing = pieces[i + 2];
		const after = pieces[i + 3];

		// `附录` 必须正好是这个 piece 的收尾（`和附录` 也算），不能是"附录X"里的一部分
		if (piece.kind !== 'cjk' || !piece.text.endsWith('附录')) {
			out.push(piece);
			continue;
		}
		const label = (next as Piece | undefined)?.text ?? '';
		const glued = next !== undefined && next.kind !== 'space' && appendixLabelPiece('附录' + label);
		// 空开一格的写法（`附录 A 矩阵`）：序号后面还有内容时才并（`附录 A` 单独出现时保持原样）
		const spaced = !glued && next !== undefined && next.kind !== 'space' && after !== undefined
			&& spacing?.kind === 'space' && after.kind === 'cjk' && appendixLabelPiece('附录' + label);

		if (glued || spaced) {
			out.push({ ...piece, text: piece.text + label, end: next.end });
			i += glued ? 1 : 2;
			continue;
		}
		out.push(piece);
	}

	return out;
}

/**
 * 在标题标记与标题内容之间切一刀：`第一章矩阵` → `第一章` | `矩阵`。
 *
 * 中文是"连成一段"切的（`第一章矩阵` 本来就是一个 cjk piece），不切的话
 * 空格判定根本拿不到"标记后面"这个位置。切点取 `chapterMarkers` 给的标记结束位置，
 * 只切 cjk piece —— `附录A矩阵` 里序号是独立的 latin piece，合并交给 mergeAppendixLabels。
 */
function splitChapterTitles(pieces: Piece[]): Piece[] {
	const out: Piece[] = [];

	for (const piece of pieces) {
		if (piece.kind !== 'cjk' || piece.start === undefined) {
			out.push(piece);
			continue;
		}
		const boundaries = chapterMarkers(piece.text)
			.map(marker => marker.boundary)
			.filter(at => at > 0 && at < piece.text.length);
		if (boundaries.length === 0) {
			out.push(piece);
			continue;
		}

		const slice = (from: number, to: number): Piece => ({
			...piece,
			text: piece.text.substring(from, to),
			start: (piece.start as number) + from,
			end: (piece.start as number) + to,
		});

		let from = 0;
		for (const at of boundaries) {
			out.push(slice(from, at));
			from = at;
		}
		out.push(slice(from, piece.text.length));
	}

	return out;
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
 * 只有"单独一个"（通用符号 4）才左右各留一格，如 `a | b`、`| ：单独一个`。
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
 * 半角引号：成对时才认，两个半边都按包裹符号处理 —— **内侧不留空格**、外侧照"分隔语言"办。
 *
 * 包裹符号是"突出里面内容"的（标点符号·概论 4），所以 `" + "` → `"+"`、
 * `" 引文 "` → `"引文"`；落单的引号（`2" 的管子`）不成对，一个字符都不动。
 *
 * 引号**里面**和 `《》` `“”` 一样按"引文原样保留"处理（打上 title 标记）：
 * 引文可能是整句英文（`"Cancel the interactions … (such as …)"`），里面的空格与括号
 * 都不该被排版规则改掉；两个半边本身照旧只管"贴紧"自己那一侧。
 */
function markQuotePieces(pieces: Piece[]): void {
	let count = 0;
	for (const piece of pieces) {
		if (piece.kind === 'other' && piece.text === '"') count++;
	}
	if (count === 0 || count % 2 !== 0) return;

	let inside = false;
	for (const piece of pieces) {
		if (piece.kind === 'other' && piece.text === '"') {
			piece.rule = inside ? CLOSE_QUOTE_RULE : OPEN_QUOTE_RULE;
			inside = !inside;
			continue;
		}
		if (inside && piece.kind !== 'space') piece.title = true;
	}
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
