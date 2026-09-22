/**
 * 智能公式：把正文里"一看就是数学符号"的写法自动包上 `$…$`。
 *
 * 笔记里的真实写法（都要认）：
 * ```
 * 矩阵 A / 矩阵A        → 矩阵 $A$
 * 向量组 a 中           → 向量组 $a$ 中
 * n维 / n 阶 / n 次     → $n$ 维 / $n$ 阶 / $n$ 次
 * V(F) / a(b) / T(x)    → $V(F)$ / $a(b)$ / $T(x)$
 * x = 0 / x = Tz        → $x = 0$ / $x = Tz$（整段算式一起包，不能只包字母）
 * Ax = λx               → $Ax = \lambda x$（含字母连写与希腊字母）
 * a, b ∈ F              → $a, b \in F$（逗号分隔的整段）
 * 特征值 λ              → 特征值 $\lambda$
 * ```
 *
 * 判定顺序（保守优先，"不确定就不动"）：
 * 0. 先扫一遍**已经写好的公式**（行内 `$…$`、`$$…$$`，代码块与行内代码里的不算），
 *    把里面出现过的字母收成一张**变量表**：你在笔记里把 `z` 写成 `$z$`，就等于声明
 *    "z 是变量"，正文后面再单写 `z` 时照旧包上，不用再靠语境词猜一遍。
 *    `$e^{At}$` 这种复合公式里的字母（e / A / t）一样算数。
 * 1. 再划保护区：frontmatter、围栏 / 缩进代码块（整行跳过），行内代码、双链与链接、URL、
 *    HTML、`%%注释%%`、`#标签`，以及已经写好的行内公式 `$…$` 与 `$$…$$`
 *    —— 跨行区块中间的行整行跳过，首行 `$$` 之前、末行 `$$` 之后的正文照常识别。
 * 2. 剩下的正文切成 atom，再取**算式段**：只由字母 / 数字 / 希腊字母 / 运算符 / 括号逗号 / 空格
 *    组成的最大连续片段（中文与全角标点天然把它切开）。
 * 3. 算式段要过关才包：
 *    - 首尾削掉悬空的运算符、逗号与空格，括号必须配平；
 *    - 至少有一个字母；每个字母只能是"单个字母"或"两个字母的连写"
 *      （`Ax` `Tz` 是变量乘积 ✓，`Jordan` `latex` `anki` 是单词 ✗，`is` `to` 这类虚词另有一张表 ✗）；
 *    - 字母与数字之间不能紧贴（`A4` `x2` 是型号 / 编号，不是变量）；
 *    - 二元运算符**两侧都要留一格**（数学符号 1：「运算符号和状态符号前后都要加空格」）——
 *      `x = 0`、`x - 1`、`a, b ∈ F` ✓；`x=0`、`a+b+c`、`5/10mm`、`A-7`、`cd /d`、`x -1` ✗。
 *      紧贴的一律不认：那可能是作者故意写的编号（`A-7`）、连字符（`F-22`）、
 *      命令（`cd /d`），也可能是他在正文里省空格 —— 排版不猜，只认写成规范形态的算式；
 *      正负号这类**修饰符号**（数学符号 3：前后没有空格）本来就不对称，不在此列：`x = -1` ✓；
 *    - 不能紧贴 `_ ^ \ . / :` 这类连接符（`Q_inv` `x^2` `a_ij` `main.ts` `C:\` 交给公式排版与命名约定）；
 *    - **必须紧挨中文或中文标点**（英文句子里的 `the value x is` 因此不会中招）；
 *    - `C 语言` `D 盘` `A 股` 这类"字母 + 专有名词后缀"跳过；
 *    - 有"数学的样子"：变量表里的同名变量、本行前面确认过的变量、运算符 / 括号、
 *      左边的数学语境词、右边的量词，至少占一样。
 * 4. 包的时候顺手把希腊字母与常用数学符号换成 LaTeX 命令（`λ` → `\lambda`、`∈` → `\in`），
 *    命令后面紧跟字母时补一个空格，免得连成 `\lambdax` 这种未定义命令。
 *
 * 幂等：包好的 `$…$` 下一轮属于保护区，不会被再包一层；而变量表来自"已经写好的公式"、
 * 新包出来的公式下一轮又成了变量来源，所以整篇要迭代到不动点（见 wrapPlainMath），
 * 否则"排版两次"会比"排版一次"多包几个字母。
 */
import { markProtectedLines, markIndentedCodeLines, inlineCodeRanges } from './line-scan';
import { collectMaskedRanges, isSpaceChar, mathRanges, readInlineMath } from './inline-scan';

export interface TextMathOptions {
	/** 是否把正文里的数学符号包成 `$…$` */
	wrapSymbols: boolean;
}

/** 默认开启：文档里写着「公式和符号都用 latex 语法打」 */
export const DEFAULT_TEXT_MATH_OPTIONS: TextMathOptions = { wrapSymbols: true };

/** 希腊字母 → LaTeX 命令 */
const GREEK_LETTERS: Record<string, string> = {
	'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon',
	'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ι': '\\iota', 'κ': '\\kappa',
	'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi',
	'ρ': '\\rho', 'σ': '\\sigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
	'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
	'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi',
	'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
};

/** 常用数学符号 → LaTeX 命令（`√` 之类需要参数的没有对应写法，不收） */
const SYMBOL_LETTERS: Record<string, string> = {
	'×': '\\times', '÷': '\\div', '±': '\\pm', '∓': '\\mp', '·': '\\cdot', '⋅': '\\cdot',
	'∈': '\\in', '∉': '\\notin', '∋': '\\ni', '≤': '\\le', '≥': '\\ge', '≠': '\\ne',
	'≈': '\\approx', '≡': '\\equiv', '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset',
	'⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∧': '\\land', '∨': '\\lor',
	'→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow',
	'⇔': '\\Leftrightarrow', '∞': '\\infty', '∑': '\\sum', '∏': '\\prod', '∫': '\\int',
};

/** 算式段里允许的中缀运算符 */
const OPERATOR_CHARS = new Set<string>([
	...'=+-<>*/|',
	...Object.keys(SYMBOL_LETTERS),
]);

/** 算式段里允许的括号与逗号 */
const PUNCT_CHARS = new Set<string>([...'()[],;']);

/** 汉字、假名、谚文、全角字母数字 */
const CJK_RE = /[\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/;

/** 全角标点 */
const FULL_PUNCT_RE = /[\u3001-\u303f\u2018\u2019\u201c\u201d\u2014\u2026\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/;

/** 拉丁字母（含带变音符号的），与 atom 分词用的是同一个范围 */
const LETTER_RE = /[A-Za-z\u00c0-\u024f]/;

/** 紧贴这些字符就不算数学符号：`Q_inv` `x^2` `main.ts` `C:\` `e.g.` */
const GLUE_CHARS = new Set<string>([...'._/\\:^`\'"@#$%&~']);

/** 算式段两侧能当"中文锚点"的全角标点（书名号、引号开口不算：`《introduction…》` 不是公式） */
const ANCHOR_PUNCT = new Set<string>([...'，。、；：！？…）】」』”》']);

/** 字母后面跟这些汉字是专有名词，不是变量：`C 语言` `D 盘` `A 股` */
const PROPER_NOUN_SUFFIX = new Set<string>([...'盘语言股站光型区级类版号']);

/** 两个字母的英文虚词：`A is B`、`x to y` 里的 `is` / `to` 不是变量乘积 */
const SHORT_WORDS = new Set<string>([
	'is', 'to', 'in', 'of', 'or', 'if', 'it', 'on', 'at', 'by', 'as', 'an', 'be', 'do',
	'no', 'so', 'up', 'we', 'he', 'me', 'my', 'us', 'vs', 'et', 'al', 'id', 'ok',
]);

/**
 * 数学语境词：出现在字母**左边**时才算"这是数学"。
 *
 * 这是全库实测逼出来的 —— 只按"紧挨中文"判定的话，`xx`（占位命名）、`qq`（QQ）、
 * `pg`（研究生项目）、`tv`、`完成x次`、`附录x` 全都会被包成公式。
 */
const MATH_CONTEXT_WORDS = [
	'矩阵', '向量组', '向量', '矢量', '线性空间', '子空间', '向量空间', '空间', '集合', '数集',
	'数域', '域', '函数', '方程', '方程组', '变量', '参数', '元素', '零元', '单位元', '映射',
	'变换', '特征值', '特征向量', '特征子空间', '基', '坐标', '秩', '行列式', '子式', '范数',
	'多项式', '系数', '标量', '算子', '张量', '值域', '像空间', '定义域', '解', '根', '重数',
	'维数', '序列', '级数', '导数', '偏导', '积分', '极限', '概率', '期望', '方差', '分布', '点',
];

/** 量词：出现在字母**右边**时算数学（`n维`、`n 阶`、`m 个向量`） */
const MEASURE_CHARS = new Set<string>([...'维阶次重倍行列个']);

/** LaTeX 命令名：`\lambda` `\sin` `\begin` 里的字母是命令，不是变量 */
const LATEX_COMMAND_RE = /\\[A-Za-z]+/g;

/** 参数当文字排的命令：`\text{max}` `\mathrm{d}` 花括号里的字母不是变量 */
const TEXT_COMMAND_RE =
	/\\(?:text|textrm|textnormal|textit|textbf|textsf|texttt|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|mbox|hbox)\s*\{[^{}]*\}/g;

/** 书名号与引号：里面是专有名词或引文，原样保留（`《a子计划》` 不能被拆成 `《$a$子计划》`） */
const TITLE_PAIRS: Record<string, string> = {
	'《': '》', '〈': '〉', '“': '”', '‘': '’',
};

type AtomKind = 'cjk' | 'fpunct' | 'latin' | 'digit' | 'greek' | 'op' | 'punct' | 'space' | 'other';

interface Atom {
	kind: AtomKind;
	text: string;
	start: number;
	end: number;
}

/** 行首块级标记的结束位置：标记本身与任务复选框（`- [x]`）里的字母数字不参与识别 */
function markerEnd(line: string): number {
	const match = /^[ \t]*(?:>+\s*|[-*+][ \t]+|\d{1,9}[.)][ \t]*|#{1,6}[ \t]+)/.exec(line);
	if (!match) return 0;
	const checkbox = /^\[[ xX]\][ \t]*/.exec(line.substring(match[0].length));
	return match[0].length + (checkbox ? checkbox[0].length : 0);
}

/** 把一行切成 atom；保护区（掩码区间与已有公式）整体成一个 other atom，用来切断算式段 */
function scanAtoms(line: string): Atom[] {
	const atoms: Atom[] = [];
	const ranges = collectMaskedRanges(line);
	const inCode = (at: number): boolean => ranges.some(([from, to]) => at >= from && at < to);
	const marker = markerEnd(line);
	let index = 0;
	let rangeIndex = 0;

	const push = (kind: AtomKind, from: number, to: number): void => {
		atoms.push({ kind, text: line.substring(from, to), start: from, end: to });
	};

	while (index < line.length) {
		const range = ranges[rangeIndex];
		if (range && index >= range[0] && index < range[1]) {
			push('other', index, range[1]);
			index = range[1];
			continue;
		}
		while (ranges[rangeIndex] && (ranges[rangeIndex] as [number, number])[1] <= index) rangeIndex++;

		if (index < marker) {
			push('other', index, marker);
			index = marker;
			continue;
		}

		const char = line.charAt(index);

		if (isSpaceChar(char)) {
			let end = index;
			while (end < line.length && isSpaceChar(line.charAt(end))) end++;
			push('space', index, end);
			index = end;
			continue;
		}

		if (char === '$') {
			const math = readInlineMath(line, index, inCode);
			const next = math ? math.next : index + 1;
			push('other', index, next);
			index = next;
			continue;
		}

		if (GREEK_LETTERS[char] !== undefined) {
			push('greek', index, index + 1);
			index++;
			continue;
		}
		if (CJK_RE.test(char)) {
			let end = index;
			while (end < line.length && CJK_RE.test(line.charAt(end))) end++;
			push('cjk', index, end);
			index = end;
			continue;
		}
		if (FULL_PUNCT_RE.test(char)) {
			push('fpunct', index, index + 1);
			index++;
			continue;
		}
		if (LETTER_RE.test(char)) {
			let end = index;
			while (end < line.length && LETTER_RE.test(line.charAt(end))) end++;
			push('latin', index, end);
			index = end;
			continue;
		}
		if (/[0-9]/.test(char)) {
			let end = index;
			while (end < line.length && /[0-9]/.test(line.charAt(end))) end++;
			// 小数一起算一个数：`3.14`
			if (line.charAt(end) === '.' && /[0-9]/.test(line.charAt(end + 1))) {
				end++;
				while (end < line.length && /[0-9]/.test(line.charAt(end))) end++;
			}
			push('digit', index, end);
			index = end;
			continue;
		}
		if (OPERATOR_CHARS.has(char)) {
			push('op', index, index + 1);
			index++;
			continue;
		}
		if (PUNCT_CHARS.has(char)) {
			push('punct', index, index + 1);
			index++;
			continue;
		}

		push('other', index, index + 1);
		index++;
	}

	protectTitles(atoms);
	return atoms;
}

/** 书名号 / 引号内部整体当保护区（专有名词、引文原样保留） */
function protectTitles(atoms: Atom[]): void {
	let closer: string | null = null;

	for (const atom of atoms) {
		if (closer === null) {
			if (atom.kind !== 'fpunct') continue;
			const next = TITLE_PAIRS[atom.text];
			if (next) closer = next;
			continue;
		}
		if (atom.kind === 'fpunct' && atom.text === closer) {
			closer = null;
			continue;
		}
		if (atom.kind !== 'space') atom.kind = 'other';
	}
}

const isStretchAtom = (atom: Atom): boolean =>
	atom.kind === 'space' || atom.kind === 'op' || atom.kind === 'digit'
	|| atom.kind === 'latin' || atom.kind === 'greek' || atom.kind === 'punct';

const glued = (left: Atom | undefined, right: Atom | undefined): boolean =>
	left !== undefined && right !== undefined && left.end === right.start;

/** 紧贴的字符是连接符（`Q_inv` `main.ts` `C:\`）→ 这不是公式 */
function gluedToGlue(atoms: Atom[], index: number): boolean {
	const atom = atoms[index];
	if (!atom || atom.kind !== 'other') return false;
	return GLUE_CHARS.has(atom.text);
}

/** 削掉首尾悬空的运算符 / 逗号 / 空格；括号不配平就整段放弃 */
function trimStretch(atoms: Atom[], from: number, to: number): [number, number] | null {
	let start = from;
	let end = to;

	while (start < end) {
		const atom = atoms[start] as Atom;
		const droppable = atom.kind === 'space' || atom.kind === 'op'
			|| (atom.kind === 'punct' && atom.text !== '(' && atom.text !== '[');
		if (!droppable) break;
		start++;
	}
	while (end > start) {
		const atom = atoms[end - 1] as Atom;
		const droppable = atom.kind === 'space' || atom.kind === 'op'
			|| (atom.kind === 'punct' && atom.text !== ')' && atom.text !== ']');
		if (!droppable) break;
		end--;
	}
	if (end - start < 1) return null;

	let depth = 0;
	for (let i = start; i < end; i++) {
		const atom = atoms[i] as Atom;
		if (atom.kind !== 'punct') continue;
		if (atom.text === '(' || atom.text === '[') depth++;
		else if (atom.text === ')' || atom.text === ']') depth--;
		if (depth < 0) return null;
	}
	return depth === 0 ? [start, end] : null;
}

/** 从 index 朝一个方向找最近的"非空格"atom（判断运算符是不是前缀用） */
function nearestContent(atoms: Atom[], index: number, step: number): Atom | undefined {
	for (let i = index + step; i >= 0 && i < atoms.length; i += step) {
		const atom = atoms[i];
		if (atom === undefined) return undefined;
		if (atom.kind !== 'space') return atom;
	}
	return undefined;
}

/**
 * 前缀运算符（正负号）：左边没有内容，或左边是另一个运算符 / 开括号。
 *
 * 数学符号 3：「正负号等修饰符号前后没有空格」—— `x = -1` 里的负号属于数字本身
 * （写成 `x = - 1` 反倒是错的），所以它不参与"运算符两侧要留一格"的判定，
 * 与公式排版里的 isUnary 是同一个判断。
 */
function isPrefixOperator(atoms: Atom[], index: number): boolean {
	const before = nearestContent(atoms, index, -1);
	if (before === undefined || before.kind === 'op') return true;
	return before.kind === 'punct' && (before.text === '(' || before.text === '[');
}

/**
 * 这一段里有没有**紧贴的二元运算符**：运算符两侧没各留一格。
 *
 * 数学符号 1：「加减乘除等于等运算符号和大于小于等状态符号前后都要加空格
 * （如果不是数学语境就不加，比如快捷键 `ctrl+c`）」—— 所以**留了空格才算数学语境**，
 * 紧贴的一律不认：`x=0`、`a+b+c`、`5/10mm`、`A-7`、`cd /d`、`x -1` 都可能是作者故意写的
 * 编号 / 连字符 / 命令 / 省略空格，排版不猜（只认写成规范形态的算式）。
 */
function hasTightOperator(atoms: Atom[], from: number, to: number): boolean {
	for (let i = from; i < to; i++) {
		const atom = atoms[i] as Atom;
		if (atom.kind !== 'op') continue;
		if (isPrefixOperator(atoms, i)) continue;
		const left = atoms[i - 1];
		const right = atoms[i + 1];
		if (left === undefined || right === undefined) continue;
		if (left.kind !== 'space' || right.kind !== 'space') return true;
	}
	return false;
}

/** 这一段像不像数学：有字母，字母不是单词，字母数字不粘连 */
function isMathLike(atoms: Atom[], from: number, to: number): boolean {
	let letters = 0;
	let hasOperator = false;
	let hasMultiLetter = false;

	for (let i = from; i < to; i++) {
		const atom = atoms[i] as Atom;
		if (atom.kind === 'op') hasOperator = true;
		if (atom.kind === 'greek') {
			letters++;
			continue;
		}
		if (atom.kind !== 'latin') continue;
		letters++;
		if (atom.text.length > 1) hasMultiLetter = true;

		// 英文单词 / 专有名词：三个字母以上一律不算；两个字母的虚词（`is` `to`）也不算，
		// 两个字母的连写（`Ax` `Tz`）要在算式里（有运算符）才算
		if (atom.text.length > 2) return false;
		if (atom.text.length === 2 && SHORT_WORDS.has(atom.text.toLowerCase())) return false;

		// `A4` `x2`：字母紧贴数字是型号 / 编号
		const previous = atoms[i - 1];
		const next = atoms[i + 1];
		if (glued(previous, atom) && previous?.kind === 'digit') return false;
		if (glued(atom, next) && next?.kind === 'digit') return false;
	}

	if (letters === 0) return false;
	// `x=0` `a+b+c` `A-7` `cd /d`：运算符没按规范两侧各留一格 —— 不是规范形态的算式，不猜
	if (hasTightOperator(atoms, from, to)) return false;
	// 两个字母的连写必须出现在真正的算式里：`x = Tz` ✓，`AI 组装`、`xx 原则`、`pg 01` ✗
	if (hasMultiLetter && !hasOperator) return false;
	// 段首 / 段尾紧贴连接符：`Q_inv`、`main.ts`、`C:\`
	if (gluedToGlue(atoms, from - 1) || gluedToGlue(atoms, to)) return false;
	return true;
}

function anchorBefore(atoms: Atom[], index: number): Atom | null {
	for (let i = index; i >= 0; i--) {
		const atom = atoms[i];
		if (!atom) return null;
		if (atom.kind === 'space') continue;
		if (atom.kind === 'cjk') return atom;
		if (atom.kind === 'fpunct' && ANCHOR_PUNCT.has(atom.text)) return atom;
		return null;
	}
	return null;
}

function anchorAfter(atoms: Atom[], index: number): Atom | null {
	for (let i = index; i < atoms.length; i++) {
		const atom = atoms[i];
		if (!atom) return null;
		if (atom.kind === 'space') continue;
		if (atom.kind === 'cjk') return atom;
		if (atom.kind === 'fpunct' && ANCHOR_PUNCT.has(atom.text)) return atom;
		return null;
	}
	return null;
}

/** `(a)` `(b)` 这种整段就是"括号里一个字母"的写法，是正文里的分条标签，不是公式 */
function isListLabel(atoms: Atom[], from: number, to: number): boolean {
	if (to - from !== 3) return false;
	const open = atoms[from] as Atom;
	const letter = atoms[from + 1] as Atom;
	const close = atoms[from + 2] as Atom;
	return open.kind === 'punct' && (open.text === '(' || open.text === '[')
		&& close.kind === 'punct' && (close.text === ')' || close.text === ']')
		&& letter.kind === 'latin' && letter.text.length === 1;
}

/** 紧挨中文或中文标点才算"正文里的数学符号" */
function isAnchored(atoms: Atom[], from: number, to: number): boolean {
	return anchorBefore(atoms, from - 1) !== null || anchorAfter(atoms, to) !== null;
}

/**
 * 这一段有没有"数学的样子"。
 *
 * 光挨着中文不算 —— `xx`、`qq`、`pg`、`tv`、`完成x次`、`附录x` 都挨着中文。
 * 必须有下面之一：本行已确认过的同名变量、运算符 / 括号、左边的数学语境词、右边的量词。
 */
function isMathContext(atoms: Atom[], from: number, to: number, known: Set<string>): boolean {
	// 希腊字母本身就是数学符号，正文里出现必然是公式（`特征值 λ`、`对于 Λ 来说`）
	for (let i = from; i < to; i++) {
		if ((atoms[i] as Atom).kind === 'greek') return true;
	}

	// 变量表里的字母再单写就照旧：`$z$` 写过一次（或本行前面刚确认过），后面的 `z` 就跟着包
	if (to - from === 1) {
		const atom = atoms[from] as Atom;
		if (atom.kind === 'latin' && known.has(atom.text)) return true;
	}

	for (let i = from; i < to; i++) {
		const kind = (atoms[i] as Atom).kind;
		if (kind === 'op' || kind === 'punct') return true;   // `x = 0`、`V(F)`、`a, b ∈ F`
	}

	const before = anchorBefore(atoms, from - 1);
	if (before && before.kind === 'cjk' && MATH_CONTEXT_WORDS.some(word => before.text.endsWith(word))) {
		return true;
	}
	const after = anchorAfter(atoms, to);
	if (after && after.kind === 'cjk' && MEASURE_CHARS.has(after.text.charAt(0))) return true;

	return false;
}

/** `C 语言` `D 盘` 这类：单个字母 + 专有名词后缀，且左侧不是中文锚点 */
function isProperNoun(atoms: Atom[], from: number, to: number): boolean {
	if (to - from !== 1) return false;
	const atom = atoms[from] as Atom;
	if (atom.kind !== 'latin' || atom.text.length !== 1) return false;
	const after = anchorAfter(atoms, to);
	if (!after || after.kind !== 'cjk' || !PROPER_NOUN_SUFFIX.has(after.text.charAt(0))) return false;
	return anchorBefore(atoms, from - 1) === null;
}

/**
 * 公式里出现过的字母都算变量：`$z$` → `z`，`$e^{At}$` → `e` / `A` / `t`。
 *
 * 先把 `\sin` 这类命令名、`\text{…}` 这类"参数当文字排"的内容剔掉，
 * 剩下的字母按单个收 —— `At` 是 A 与 t 的乘积，拆开；`\sin` 被剔掉，
 * 不会把 s / i / n 学成变量。希腊字母不用收：正文里的 `λ` 本身就认得出。
 */
function collectFormulaLetters(body: string, into: Set<string>): void {
	const text = body.replace(TEXT_COMMAND_RE, ' ').replace(LATEX_COMMAND_RE, ' ');

	for (const char of text) {
		if (LETTER_RE.test(char)) into.add(char);
	}
}

/** 一行里所有行内公式的正文（`$…$` 与同一行成对的 `$$…$$`，含定界符，字母不受影响） */
function inlineMathBodies(line: string): string[] {
	const codeRanges = inlineCodeRanges(line);
	const inCode = (at: number): boolean => codeRanges.some(([from, to]) => at >= from && at < to);
	const bodies: string[] = [];
	let index = 0;

	while (index < line.length) {
		if (line.charAt(index) !== '$') {
			index++;
			continue;
		}
		const math = readInlineMath(line, index, inCode);
		if (!math) {
			index++;
			continue;
		}
		bodies.push(math.text);
		index = math.next;
	}

	return bodies;
}

/**
 * 整篇笔记里"已经写好的公式"的正文：行内 `$…$`、同一行的 `$$…$$`、跨行的 `$$…$$` 区块。
 *
 * 区块判定直接复用 mathRanges（调用方已经算好传进来）：它给的是"这一行能排版的那一段"，
 * 取补集正好是公式 —— 区块内部整行是公式，起始行 `$$` 之后、收尾行 `$$` 之前是公式，
 * 普通行的公式只在行内。代码块、frontmatter、行内代码里的 `$` 不算。
 */
function formulaBodies(
	lines: string[],
	protectedLines: boolean[],
	codeLines: boolean[],
	ranges: Array<[number, number] | null>
): string[] {
	const bodies: string[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i] || codeLines[i]) continue;
		const line = lines[i] ?? '';
		if (line.trim() === '') continue;
		const range = ranges[i];
		if (range === undefined) continue;
		// 跨行公式块内部：整行都是 LaTeX 代码
		if (range === null) {
			bodies.push(line);
			continue;
		}
		if (range[0] > 0) bodies.push(line.substring(0, range[0]));   // 收尾行：`$$` 之前
		if (range[1] < line.length) bodies.push(line.substring(range[1]));   // 起始行：`$$` 之后
		if (range[0] === 0 && range[1] === line.length) bodies.push(...inlineMathBodies(line));
	}

	return bodies;
}

/** 找出这一行里该包成 `$…$` 的算式段 */
function mathStretches(atoms: Atom[], known: Set<string>): Array<[number, number]> {
	const stretches: Array<[number, number]> = [];
	let index = 0;

	while (index < atoms.length) {
		if (!isStretchAtom(atoms[index] as Atom)) {
			index++;
			continue;
		}
		const from = index;
		while (index < atoms.length && isStretchAtom(atoms[index] as Atom)) index++;

		const trimmed = trimStretch(atoms, from, index);
		if (!trimmed) continue;
		if (isListLabel(atoms, trimmed[0], trimmed[1])) continue;
		if (!isMathLike(atoms, trimmed[0], trimmed[1])) continue;
		if (!isAnchored(atoms, trimmed[0], trimmed[1])) continue;
		if (!isMathContext(atoms, trimmed[0], trimmed[1], known)) continue;
		if (isProperNoun(atoms, trimmed[0], trimmed[1])) continue;

		stretches.push(trimmed);
		for (let i = trimmed[0]; i < trimmed[1]; i++) {
			const atom = atoms[i] as Atom;
			if (atom.kind === 'greek' || (atom.kind === 'latin' && atom.text.length === 1)) known.add(atom.text);
		}
	}

	return stretches;
}

/** 把一段算式渲染成 `$…$`：希腊字母与数学符号换成 LaTeX 命令，命令后面紧跟字母就补空格 */
function renderStretch(atoms: Atom[], from: number, to: number): string {
	let body = '';

	for (let i = from; i < to; i++) {
		const atom = atoms[i] as Atom;
		const command = atom.kind === 'greek' ? GREEK_LETTERS[atom.text]
			: atom.kind === 'op' ? SYMBOL_LETTERS[atom.text]
				: undefined;

		if (command === undefined) {
			body += atom.text;
			continue;
		}
		// `λx` → `\lambda x`：连写会变成未定义命令 `\lambdax`
		const next = atoms[i + 1];
		body += glued(atom, next) && next !== undefined && /^[A-Za-z0-9]/.test(next.text)
			? `${command} `
			: command;
	}

	return `$${body}$`;
}

/** 处理一行；`known` 是整篇共用的变量表，行内新确认的变量会加进去给后面的行用 */
function formatLine(line: string, known: Set<string>): string {
	const atoms = scanAtoms(line);
	const stretches = mathStretches(atoms, known);
	if (stretches.length === 0) return line;

	let out = '';
	let cursor = 0;
	for (const [from, to] of stretches) {
		out += line.substring(cursor, (atoms[from] as Atom).start) + renderStretch(atoms, from, to);
		cursor = (atoms[to - 1] as Atom).end;
	}
	return out + line.substring(cursor);
}

/**
 * 一轮：用**当前内容里已有的公式**建变量表，再逐行包 `$…$`。
 *
 * 变量表整篇共用：某一行里确认过的变量（无论是已有公式里的，还是本轮刚包出来的），
 * 后面的行直接照旧包，不用再猜一遍语境。
 */
function wrapOnce(content: string): string {
	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);
	const ranges = mathRanges(lines, protectedLines);
	const known = new Set<string>();
	let changed = false;

	for (const body of formulaBodies(lines, protectedLines, codeLines, ranges)) collectFormulaLetters(body, known);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		if (protectedLines[i] || codeLines[i]) continue;
		const range = ranges[i];
		if (!range) continue;
		if (line.trim() === '') continue;

		// 跨行公式块的首行 `$$` 之前、末行 `$$` 之后的正文仍要识别
		const fixed = line.substring(0, range[0])
			+ formatLine(line.substring(range[0], range[1]), known)
			+ line.substring(range[1]);
		if (fixed !== line) {
			lines[i] = fixed;
			changed = true;
		}
	}

	return changed ? lines.join('\n') : content;
}

/** 迭代上限：每一轮只会新增 `$…$`、不会删除，可包的位置有限，所以一定收敛；实际最多两三轮 */
const MAX_ROUNDS = 8;

/**
 * 智能公式：给整篇笔记里"一看就是数学符号"的写法套上 `$…$`。
 *
 * 变量表来自"已经写好的公式"（`$z$` 写过一次，正文里再单写 `z` 就跟着包），
 * 而这一轮新包出来的公式，下一轮又成了变量来源 —— 所以迭代到不动点：
 * `1. x = Tz：x 为原状态，z 为新状态` 要先包出 `$x = Tz$`，下一轮才能从中学到 `z`，
 * 让后面单写的 `z` 也跟上。不迭代的话，「排版两次」会比「排版一次」多包几个字母，
 * 整条流水线的幂等承诺就破了。
 *
 * @param content 笔记原文
 * @param options 开关
 * @returns 处理后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function wrapPlainMath(content: string, options: TextMathOptions): string {
	if (content === '' || !options.wrapSymbols) return content;

	let current = content;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const next = wrapOnce(current);
		if (next === current) break;
		current = next;
	}

	return current;
}
