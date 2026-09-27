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
	/**
	 * 导入的图片顺手交给 Image Converter 转格式（用它当前选中的转换预设）。
	 *
	 * Image Converter 只在"剪贴板里带图片文件"的粘贴上自动转换，看不到我们导入的
	 * `file:///D:\…` 文本路径 —— 不交接的话图片进了库却一直是 png/jpg。
	 * 它没装 / 转换失败时按原格式导入，不影响图片进库（见 `image/image-converter-bridge.ts`）。
	 */
	handOffImportedImages: boolean;
	/**
	 * 「转换全库图片格式」这条命令的目标格式：
	 * `preset` = 跟随 Image Converter 当前选中的预设；`webp` / `jpg` / `png` = 直接点名
	 * （质量、缩放仍照预设，动图与已是目标格式的图片一律跳过）。
	 */
	vaultConvertFormat: string;
	/**
	 * 「合并重复图片」跑完是否顺手执行一次 Clear Unused Images
	 * （`oz-clear-unused-images`）的「清理未使用图片」命令。
	 * 没装那个插件时这一步自动跳过，不影响合并。
	 */
	autoClearUnusedImages: boolean;
	/** 在左侧栏放一个「整理图片」图标（点一下 = 合并重复副本 + 清理没人引用的附件） */
	tidyImagesRibbonIcon: boolean;
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
	/** 相邻消息之间是否留空行（总开关，与头部信息开不开无关）：关（默认）时源文里消息之间的空行也一并去掉 */
	chatBlankLineBetweenMessages: boolean;
	/** 相邻消息的时间戳与粘贴顺序不一致时，是否按时间先后输出 */
	chatSortByTime: boolean;
	/** 是否去掉消息正文里的 `@昵称` 提及 */
	chatStripMentions: boolean;
	/** 粘贴的内容被识别为聊天记录时，自动执行「快速修复聊天记录」（转换外部图片 + 修复排版） */
	autoFixChatLogOnPaste: boolean;
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
	/** 章节 / 课次 / 附录这类标题标记与标题内容之间空一格（`第一章矩阵` → `第一章 矩阵`） */
	spacingChapterTitle: boolean;
	// ---- 状态栏 ----
	/** 状态栏显示当前选中内容里的图片张数 */
	showSelectionImageCount: boolean;
	// ---- 右键菜单 ----
	/** 在笔记右键菜单（图片菜单 + 笔记正文菜单）里显示「复制图片（Note Tidy）」 */
	imageMenuCopyItem: boolean;
	/** 在笔记右键菜单里显示「快速设置图片大小（Note Tidy）」 */
	imageMenuQuickSizeItem: boolean;
	/** 在笔记右键菜单里显示「快速修复聊天记录（Note Tidy）」 */
	imageMenuQuickFixItem: boolean;
	/** 在笔记右键菜单里显示「排版选中内容（Note Tidy）」 */
	imageMenuTypesetItem: boolean;
	/** 在图片菜单里显示「管理右键菜单…（Note Tidy）」 */
	imageMenuManageItem: boolean;
	/** 在文件 / 文件夹的右键菜单里显示「图片功能」二级栏 */
	fileMenuImageSubmenu: boolean;
	/** 在文件 / 文件夹的右键菜单里显示「文本排版」二级栏 */
	fileMenuTextSubmenu: boolean;
	/** 三个右键菜单里要隐藏的项（每行 `作用域：标题`，作用域 = 图片 / 笔记 / 文件夹） */
	menuHiddenItems: string;
	// ---- 复制 ----
	/** 接管 Ctrl+C：光标处 / 选中内容里有图片时复制图片文件，而不是链接文字 */
	takeOverCopyShortcut: boolean;
}

export const DEFAULT_SETTINGS: ImageTransferSettings = {
	attachmentLocation: 'system',
	customAttachmentFolder: 'Attachments',
	imageNamePreset: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}',
	renameLinkFormat: 'full',
	// 导入的图片交给 Image Converter 转格式（默认开）：它本来就负责把粘进来的图转成 webp，
	// 而我们导入的外部路径图片它看不见 —— 不交接就会攒一堆 png。没装它时这一项不起作用。
	handOffImportedImages: true,
	// 「转换全库图片格式」默认转 webp：仓库里绝大多数图片都该是 webp（省空间、Obsidian 原生支持）
	vaultConvertFormat: 'webp',
	// 合并完顺手让 Clear Unused Images 收一遍"没人引用的附件"：两者互补（我们合并重复、它清理孤儿）
	autoClearUnusedImages: true,
	// 左侧栏图标：一键整理（想替代 Clear Unused Images 那个按钮的就靠它）
	tidyImagesRibbonIcon: true,
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
	// 粘贴顺序有时与聊天窗口里的先后不一致（一次选多条时后一条先落地），
	// 时间戳就在手边，默认按时间摆正 —— 只在相邻消息之间做，见 text/chat-log.ts
	chatSortByTime: true,
	// 去掉 @ 提及会删正文，默认关：要用的自己打开（设置 → 聊天记录排版）
	chatStripMentions: false,
	// 粘贴聊天记录就顺手修好：默认开启（判定很窄 —— 要有两条"用户名 + 时间戳"的消息头部才算），
	// 不想让它自动改笔记的在设置里关掉即可，手动那条命令 / 菜单项不受影响
	autoFixChatLogOnPaste: true,
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
	spacingChapterTitle: DEFAULT_SPACING_OPTIONS.chapterTitle,
	// 状态栏那一格只在选中内容里真的有图片时才出现，默认不开（右下角越干净越好）
	showSelectionImageCount: false,
	// 右键菜单：默认插六项（图片功能 / 文本排版 两个二级栏 + 复制图片 / 快速设置大小 /
	// 快速修复聊天记录 / 管理入口），不接管菜单，原生项都在
	imageMenuCopyItem: true,
	imageMenuQuickSizeItem: true,
	imageMenuQuickFixItem: true,
	imageMenuTypesetItem: true,
	imageMenuManageItem: true,
	fileMenuImageSubmenu: true,
	fileMenuTextSubmenu: true,
	menuHiddenItems: '',
	// 接管 Ctrl+C 会改掉一个用惯了的快捷键，默认不开
	takeOverCopyShortcut: false,
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
		chapterTitle: settings.spacingChapterTitle !== false,
	};
}
