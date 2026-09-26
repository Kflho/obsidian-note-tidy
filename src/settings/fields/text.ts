import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from '../../text/spacing';
import { resolveLeadingIndentMode } from '../../text/indent';
import type { FieldSection } from './types';

/**
 * 「排版格式」一页的设置项（使用者实际看到的格式）。
 *
 * 每一节的顺序与说明文字都对着笔记里的《排版格式》规范写，
 * 改规则时先改规范、再改这里的文案、最后改对应模块的实现（见 rule-registry.ts）。
 */

/** 头部信息全关时，「消息之间插入空行」才有意义 */
const headerIsEmpty = (settings: { chatShowUsername: boolean; chatShowDate: boolean; chatShowTime: boolean }): boolean =>
	!settings.chatShowUsername && !settings.chatShowDate && !settings.chatShowTime;

export const TEXT_SECTION: FieldSection = {
	type: 'page',
	heading: '排版格式',
	desc: '使用者实际看到的格式：空格、标点、标签、板块与聊天记录',
	groups: [
		{
			heading: '数学符号',
			fields: [
				{
					key: 'textMathWrapSymbols',
					name: '正文数学符号自动加公式',
					desc: '把正文里"一看就是数学符号"的写法包上 `$…$`：`矩阵 A` / `矩阵A` → `矩阵 $A$`；`n维` `n 阶` `n 次` → `$n$ 维` `$n$ 阶` `$n$ 次`；`V(F)` / `a(b)` / `T(x)` → `$V(F)$`；整段算式 `x = 0`、`x = Tz`、`V(x) = 0` 一起包；`λ` `Λ` 这类希腊字母换成 `$\\lambda$` `$\\Lambda$`。判定很保守：只有出现括号 / 运算符、左边的数学语境词（矩阵、向量、数域…）、右边的量词（维、阶、次、行、列…）、希腊字母，或本行已确认过的同名变量才动手 —— 英文句子、长单词（Jordan、latex）、两字母缩写（AI、QQ、pg、tv、xx）、缩写 e.g.、路径 C:\\ 、型号 A4、命名约定 Q_inv、分条标签 (a)、任务复选框 - [x]、书名号引号内部与已有公式一律不碰',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '文字间距',
			fields: [
				{
					key: 'spacingCjkLatin',
					name: '中文与英文之间',
					desc: '中文和英文单词之间空一个字宽：`用anki卡片` → `用 anki 卡片`。行内代码、双链、链接、标签与英文等价，一并留空格（`见[[备注]]` → `见 [[备注]]`）；中英文与标点之间不留空格',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽 (推荐)',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.cjkLatin),
				},
				{
					key: 'spacingCjkDigit',
					name: '中文与数字之间',
					desc: '按「中文和数字之间都不空一个字宽」：已有空格一并删掉，`第 3 章` → `第3章`。注意这与常见的盘古之白规则相反，改选「空一个字宽」即可切换',
					control: {
						type: 'dropdown',
						options: {
							none: '不留空格 (按笔记规则，推荐)',
							space: '空一个字宽',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveCjkDigitMode(value),
				},
				{
					key: 'spacingLatinDigit',
					name: '英文与数字之间',
					desc: '笔记规则是"一般要空一个字宽"，但 `GPT4`、`3D`、`v1.2.2` 这类专有名词一拆就错，故默认保持原样（专有名词空格以原有形式为准）',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原样 (推荐)',
							space: '空一个字宽',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.latinDigit),
				},
				{
					key: 'spacingMathText',
					name: '公式与文字之间',
					desc: '行内公式 $…$ 与前后文字之间空一个字宽：`设$x$为` → `设 $x$ 为`。只动 $ 外面 —— $ 内侧永远不空，那是 Obsidian 能否认出公式的前提；公式与标点之间不留空格',
					control: {
						type: 'dropdown',
						options: {
							space: '空一个字宽 (推荐)',
							keep: '保持原样',
						},
					},
					coerce: (value) => resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.mathText),
				},
				{
					key: 'spacingChapterTitle',
					name: '标题标记与标题内容之间',
					desc: '按「第一章，第一课，附录1 等标题和标题内容之间需要加空格」：`第一章矩阵` → `第一章 矩阵`、`第1课五十音` → `第1课 五十音`、`附录A矩阵` → `附录A 矩阵`。认两种标记 —— `第` + 序号 + 章 / 课 / 节 / 讲 / 篇、`附录` + 序号（`附录A` `附录1` `附录一`，序号必填）；标记后面本来就跟着标点（`第一章、矩阵`）、或标记后面没有内容（整行只有 `第一章`）时不动，已经空开的也不动',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标点与符号',
			fields: [
				{
					key: 'spacingFullPunct',
					name: '全角标点两侧不留空格',
					desc: '中文标点（，。、；：！？…）与内容之间不留空格：`中文 ，内容` → `中文，内容`。引号 “”‘’ 两侧、书名号《》内侧例外 —— 那里可能是《新 吊带袜天使》这类故意留空的专有名词',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfPunct',
					name: '半角标点前不留空格、后空一格',
					desc: '英文符号 , . ! ? : 后面空一格、前面不留空格（`word,word` → `word, word`）。小数点与版本号（1.2.2）、时间（12:30）、省略号（...）不适用',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingBracketInner',
					name: '括号前后都没有空格',
					desc: '半角括号内侧不留空格（`( x )` → `(x)`），外侧也贴紧（`中文 (说明)` → `中文(说明)`、`f (x)` → `f(x)`）—— 就是函数 `f(x)` 那种写法。英文句子里括号两侧是英文词距，外侧保留（`See the appendix (page 3).`）',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingDigitUnit',
					name: '数字与单位之间空一格',
					desc: '`100kg` → `100 kg`，单位须落在词表里（kg g m s min h L W V A N J Pa Hz px dpi ℃ …）；`%`、`3D`、`4K`、`5G` 这类不算单位，不会被拆开',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingHalfToFullPunct',
					name: '标点全半角按语境',
					desc: '中文语境用全角、英文语境用半角。中文方向：`元素: 内容` → `元素：内容`，`没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且` —— 左边是中文、右边是中文、或整句以中文为主（公式、代码、链接里的字母不算数）就换。英文方向很保守：只有"整句一个中文字都没有、且至少两个英文单词"才把 `，。、；！？` 换成半角 —— 中文笔记里"参数 gain=50、shift=0"这类半中半英的行太多，按比例判定会把顿号误换。`（）`、`：`、书名号引号、`.`、数字后的标点（1,000、12:30）、`\\,`、半角括号内与 `/` 之间的标点、聊天记录头部 `张三: 2024/…` 一律不动',
					control: { type: 'toggle' },
				},
				{
					key: 'spacingSymbolPad',
					name: '符号自己的空格规则',
					desc: '**空格只用来分隔不同语言的内容**（中文 ↔ 西文单词 / 数字 / 公式），不用来分隔内容与符号：`甲&乙`、`甲|乙`、`甲→乙` 贴紧（已有的空格收掉），而 `A & B`、`$A$ & $B$`、`word, word` 留一格；符号与符号之间也贴紧（`如, ：` → `如,：`、`7. 并列：&`）。`^`、`...` 前后不空（`x ^ 2` → `x^2`）；包裹符号（`（）` `《》` `“”`、成对的 `"`）内侧永远贴紧，外侧中文旁贴紧、西文旁留一格（`他说"你好"了`、`He said "hello" loudly`）；`|x|`、`P(A|B)`、`x̂_{k|k}` 这类紧贴字母数字的竖线属于数学记号，一个字符都不动；表格行、`$…$` 与代码块整块跳过。依据是 W3C《中文排版需求》：汉字与西文字母、数字之间才谈空隙（不多于四分之一汉字宽），汉字与标点是 1:1 方块、无缝隙并列',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '标签与板块',
			fields: [
				{
					key: 'tagLayout',
					name: '标签排版',
					desc: '把行内的 #标签 统一移到所在块的句尾，与正文之间空一格；整行只有标签时这一行自成一块，位置不动、也不会被并进相邻的正文行。一个段落算一块，一行列表项、一行标题各自算一块，表格按单元格算块（不会把标签挪到别的列）。frontmatter、代码块（围栏或缩进）、行内代码、%%注释%%、双链与链接里的 # 都不算标签',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'tagSort',
					name: '标签排序',
					desc: '同一处出现的多个标签按首字母排序（中文按拼音、数字按数值）；关闭后保持原有先后顺序',
					control: { type: 'toggle' },
					disabled: (settings) => !settings.tagLayout,
				},
				{
					key: 'blockSort',
					name: '内容板块排版',
					desc: '按首字母对笔记各块内容排序（中文按拼音、数字按数值）。连续的列表项之间、连续的段落之间分别排序，列表与段落不会互相穿插；标题把排序范围切成一个个小节，表格、图片、分隔线、聊天记录保持原位。适合词条、清单类笔记，会重排正文',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '行首与标记',
			fields: [
				{
					key: 'textLeadingIndentFix',
					name: '行首缩进修复',
					desc: '把行首"用空格写的缩进"改回 tab：4 个空格算一个 tab，混在 tab 之间的零散空格删掉。正文、图片前多打的 1~3 个空格一并删掉；后面跟列表子项 / 标题等块级结构时保留缩进。顺带规范块级标记的空白：注释（引用）行前的零散空格删掉、">"与正文之间补一个空格（">引用" → "> 引用"）、列表符号与标题符号后的多个空格收成一个。frontmatter 与代码块内部不动',
					control: {
						type: 'dropdown',
						options: {
							smart: '智能：列表子项保留，其余行首空格删掉 (推荐)',
							strict: '严格：行首只留 tab，空格全删',
							off: '关闭',
						},
					},
					coerce: (value) => resolveLeadingIndentMode(value),
				},
				{
					key: 'listRenumber',
					name: '整理列表序号',
					desc: '保证每个列表的首项编号是 1：首项不是 1 时整段从 1 起逐项 +1（`3. 4. 5.` → `1. 2. 3.`）。首项已经是 1 的列表一律不动，所以作者特意写的 `1. 1. 1.`（靠 Markdown 自动递增）或 `1. 5. 9.` 不受影响。空行不断列表，段落、代码块、表格会切断列表；嵌套列表各自从 1 开始；编号位数照规范不加前导零',
					control: { type: 'toggle' },
				},
				{
					key: 'headingLevelFix',
					name: '整理标题级别',
					desc: '保证子标题与父标题恰好差一级：`# 标题` 下面直接写 `#### 子标题` 会压成 `##`，同级标题保持同级，回退时回到正确的父级。所有级别一次从原始标题算出（不边改边串）；首个标题的级别保持原样 —— `##` 起头的笔记往往是接着上一层的分级，不硬掰成 `#`。frontmatter、代码块、`#标签`、引用里的标题都不动',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '聊天记录',
			fields: [
				{
					key: 'chatShowUsername',
					name: '显示用户名',
					desc: '关闭后每条消息只保留日期与时间',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'chatShowDate',
					name: '显示日期',
					desc: '日期格式为 {YYYY}/{MM}/{DD}',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'chatShowTime',
					name: '显示时间',
					desc: '时间格式为 {HH}:{mm}:{ss}。关闭后排版结果不含时间戳，可避免记录被再次识别为聊天数据',
					control: { type: 'toggle' },
					rerenderOnChange: true,
				},
				{
					key: 'chatIndent',
					name: '正文缩进',
					desc: '控制每条消息正文的缩进方式，可与头部信息区分开',
					control: {
						type: 'dropdown',
						options: {
							tab: '制表符 (tab)',
							'2': '2 个空格',
							'4': '4 个空格',
							none: '不缩进',
						},
					},
				},
				{
					key: 'chatImageOrder',
					name: '图文消息中图片的位置',
					desc: '一条消息同时含图片和文字时，图片排在文字上方还是下方。选「保持原顺序」则不调整',
					control: {
						type: 'dropdown',
						options: {
							keep: '保持原顺序',
							above: '图片在上方',
							below: '图片在下方',
						},
					},
				},
				{
					key: 'chatBlankLineBetweenMessages',
					name: '消息之间插入空行',
					desc: '仅在用户名、日期、时间全部关闭时可用；有头部信息时头部本身已起分隔作用',
					legacyDesc: (settings) => headerIsEmpty(settings)
						? '头部信息已全部关闭，开启后用空行分隔相邻消息，便于区分说话人'
						: '仅在用户名、日期、时间全部关闭时可用；有头部信息时头部本身已起分隔作用',
					control: { type: 'toggle' },
					disabled: (settings) => !headerIsEmpty(settings),
				},
			],
		},
	],
};
