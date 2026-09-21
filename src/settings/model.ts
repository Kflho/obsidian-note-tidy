import type { ChatImageOrder, ChatIndent } from '../text/chat-log';
import { DEFAULT_LEADING_INDENT_MODE } from '../text/indent';
import type { LeadingIndentMode } from '../text/indent';
import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from '../text/spacing';
import type { SpacingOptions } from '../text/spacing';

/**
 * 插件设置的**数据模型**：字段定义、默认值、以及"设置 → 各功能选项"的转换。
 *
 * 面板怎么渲染不在这里（见 fields/ 与 tab.ts）；这里只回答"有哪些设置、默认是多少"。
 */

export interface ImageTransferSettings {
	attachmentLocation: string;
	customAttachmentFolder: string;
	imageNamePreset: string;
	renameLinkFormat: string;
	// ---- 图片大小 ----
	/** 设置图片大小的默认宽度（像素），空字符串表示不指定 */
	imageSizeWidth: string;
	/** 设置图片大小的默认高度（像素），空字符串表示按比例缩放 */
	imageSizeHeight: string;
	/** 设置图片大小时是否覆盖已有尺寸 */
	imageSizeOverwrite: boolean;
	// ---- 聊天记录排版 ----
	/** 是否在排版结果中保留用户名 */
	chatShowUsername: boolean;
	/** 是否在排版结果中保留日期 (YYYY/MM/DD) */
	chatShowDate: boolean;
	/** 是否在排版结果中保留时间 (HH:mm:ss) */
	chatShowTime: boolean;
	/** 正文缩进方式 */
	chatIndent: ChatIndent;
	/** 图文消息中图片相对文字的位置 */
	chatImageOrder: ChatImageOrder;
	/** 头部信息全部关闭时，是否在相邻消息之间插入空行 */
	chatBlankLineBetweenMessages: boolean;
	// ---- 通用排版修复 ----
	/** 行首缩进修复力度：把"用空格写的缩进"改回 Tab，顺带规范引用/列表/标题标记的空白 */
	textLeadingIndentFix: LeadingIndentMode;
	/** 整理列表序号：保证每个列表的首项编号是 1 */
	listRenumber: boolean;
	/** 整理标题级别：子标题与父标题恰好差一级 */
	headingLevelFix: boolean;
	// ---- 标签与板块排版 ----
	/** 标签排版：把行内标签移到所在块的句尾，与正文空一格 */
	tagLayout: boolean;
	/** 标签排序：同一处出现的多个标签按首字母排序 */
	tagSort: boolean;
	/** 内容板块排版：按首字母对笔记各块内容排序 */
	blockSort: boolean;
	// ---- 代码格式：公式排版 ----
	/** 公式排版：整理 $$…$$ 里的 LaTeX 代码（空格、换行、缩进） */
	mathLayout: boolean;
	// ---- 排版格式：智能公式 ----
	/** 智能公式：把正文里的数学符号包成 `$…$` */
	textMathWrapSymbols: boolean;
	// ---- 排版格式：空格排版 ----
	/** 中文 ↔ 英文之间空一个字宽 */
	spacingCjkLatin: string;
	/** 中文 ↔ 数字之间：不留空格 / 空一个字宽 / 保持原样 */
	spacingCjkDigit: string;
	/** 英文 ↔ 数字之间空一个字宽 */
	spacingLatinDigit: string;
	/** 行内公式 ↔ 文字之间空一个字宽 */
	spacingMathText: string;
	/** 全角标点两侧不留空格 */
	spacingFullPunct: boolean;
	/** 半角标点 `, . ! ? :` 前不留空格、后空一格 */
	spacingHalfPunct: boolean;
	/** 括号 `()` 内侧不留空格 */
	spacingBracketInner: boolean;
	/** 数字 ↔ 单位之间空一格 */
	spacingDigitUnit: boolean;
	/** 紧跟在中文后面的半角标点换成全角 */
	spacingHalfToFullPunct: boolean;
	/** 符号自己的空格规则（逐符号：`,` `.` 后空一格、`| & →` 左右空一格、`^` 不空…） */
	spacingSymbolPad: boolean;
}

export const DEFAULT_SETTINGS: ImageTransferSettings = {
	attachmentLocation: 'system',
	customAttachmentFolder: 'Attachments',
	imageNamePreset: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}',
	renameLinkFormat: 'full',
	imageSizeWidth: '100',
	imageSizeHeight: '',
	imageSizeOverwrite: true,
	// 以下默认值与旧版本排版结果完全一致，升级后已有笔记不会被改动
	chatShowUsername: true,
	chatShowDate: true,
	chatShowTime: true,
	chatIndent: 'tab',
	chatImageOrder: 'keep',
	chatBlankLineBetweenMessages: false,
	// 默认「保守」：能修掉聊天记录里典型的空格混排，又不会动 Markdown 列表的嵌套缩进
	textLeadingIndentFix: DEFAULT_LEADING_INDENT_MODE,
	// 序号与标题级别是「保证式」整理：只修不齐的地方（首项编号不是 1、父子标题差不止一级），
	// 已经合规的一律不动，所以默认开启
	listRenumber: true,
	headingLevelFix: true,
	// 标签与板块排序会重排正文，默认关闭；开启后「标签排版」连带按首字母排序
	tagLayout: false,
	tagSort: true,
	blockSort: false,
	// 公式排版会重写 $$…$$ 里的代码，默认关闭
	mathLayout: false,
	// 智能公式：正文里的 `矩阵 A`、`n维`、`V(F)`、`x = 0` 自动套 `$…$`
	textMathWrapSymbols: true,
	// 空格排版：文字的规则默认生效；可能误伤专有名词的两条（英文↔数字、数字↔单位）默认关
	spacingCjkLatin: DEFAULT_SPACING_OPTIONS.cjkLatin,
	spacingCjkDigit: DEFAULT_SPACING_OPTIONS.cjkDigit,
	spacingLatinDigit: DEFAULT_SPACING_OPTIONS.latinDigit,
	spacingMathText: DEFAULT_SPACING_OPTIONS.mathText,
	spacingFullPunct: DEFAULT_SPACING_OPTIONS.fullPunct,
	spacingHalfPunct: DEFAULT_SPACING_OPTIONS.halfPunct,
	spacingBracketInner: DEFAULT_SPACING_OPTIONS.bracketInner,
	spacingDigitUnit: DEFAULT_SPACING_OPTIONS.digitUnit,
	spacingHalfToFullPunct: DEFAULT_SPACING_OPTIONS.halfToFullPunct,
	spacingSymbolPad: DEFAULT_SPACING_OPTIONS.symbolPad,
}

/**
 * 把插件设置转换成空格排版选项。
 * data.json 里可能存着旧版本没有的字段或手工改坏的值，统一在这里收敛。
 */
export function getSpacingOptions(settings: ImageTransferSettings): SpacingOptions {
	return {
		cjkLatin: resolveSpacingMode(settings.spacingCjkLatin, DEFAULT_SPACING_OPTIONS.cjkLatin),
		cjkDigit: resolveCjkDigitMode(settings.spacingCjkDigit),
		latinDigit: resolveSpacingMode(settings.spacingLatinDigit, DEFAULT_SPACING_OPTIONS.latinDigit),
		mathText: resolveSpacingMode(settings.spacingMathText, DEFAULT_SPACING_OPTIONS.mathText),
		fullPunct: settings.spacingFullPunct !== false,
		halfPunct: settings.spacingHalfPunct !== false,
		bracketInner: settings.spacingBracketInner !== false,
		digitUnit: settings.spacingDigitUnit === true,
		halfToFullPunct: settings.spacingHalfToFullPunct !== false,
		symbolPad: settings.spacingSymbolPad !== false,
	};
}
