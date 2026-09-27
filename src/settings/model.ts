import type { ChatImageOrder, ChatIndent } from '../text/chat-log';
import { DEFAULT_LEADING_INDENT_MODE } from '../text/indent';
import type { LeadingIndentMode } from '../text/indent';
import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from '../text/spacing';
import type { SpacingOptions } from '../text/spacing';
import { convertPlanFrom } from '../image/convert';
import type { ConvertPlan } from '../image/convert';

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
	 * 导入的图片转成目标格式（用插件自带的 canvas 编码器，见 `image/convert.ts`）。
	 *
	 * 关掉就按原格式导入（图片照进仓库，只是不动格式）。
	 */
	convertImportedImages: boolean;
	/**
	 * 图片格式转换的目标格式，四条路共用：导入的图片、粘贴进来的图片、
	 * `convert-images-current-note` / `convert-images-entire-vault` 两条命令，
	 * 以及「整理图片」（`tidyConvertFormat` 开着时）。
	 *
	 * `webp` / `jpg` / `png` = 自带 canvas 编码器；`pngquant` = 交给系统里装的 pngquant
	 * 压 PNG（见 `image/pngquant.ts`；找不到它时整步不做）。
	 */
	vaultConvertFormat: string;
	/** 转换质量 `1`–`100`（默认 `'75'`）：canvas 编码器的质量参数，png / pngquant 不用它 */
	convertQuality: string;
	/** pngquant 可执行文件路径（目标格式选 pngquant 时才用；**留空＝按系统 PATH 与常见位置找**） */
	pngquantPath: string;
	/** pngquant 的质量档（`min-max`，默认 `65-80`；与 Image Converter 那一项同名同义） */
	pngquantQuality: string;
	/**
	 * 「整理图片」时是否顺手把还不是目标格式的图片转换成目标格式
	 * （目标格式看 `vaultConvertFormat`，与那两条转换命令同一个开关）。
	 *
	 * 整理图片本来就是"把仓库里的图片收拾干净"，统一格式是这份收拾的一部分。
	 */
	tidyConvertFormat: boolean;
	/**
	 * 「合并重复图片」跑完是否顺手清理一次"没人引用的图片"
	 * （自己实现，见 `image/unused.ts`；不依赖 Clear Unused Images）。
	 */
	autoClearUnusedImages: boolean;
	/** 在左侧栏放一个「整理图片」图标（点一下 = 转换格式 + 合并重复副本 + 清理没人引用的附件） */
	tidyImagesRibbonIcon: boolean;
	// ---- 图片大小 ----
	/** 设置图片大小的默认宽度（像素），空字符串表示不指定 */
	imageSizeWidth: string;
	/** 设置图片大小的默认高度（像素），空字符串表示按比例缩放 */
	imageSizeHeight: string;
	/** 设置图片大小时是否覆盖已有尺寸 */
	imageSizeOverwrite: boolean;
	/**
	 * 粘贴进来的图片自动套用上面的默认宽度 / 高度（与「快速设置图片大小」同一套参数）。
	 *
	 * 只管**刚粘进来的那一段**：本插件自己接管的粘贴、别的插件存下的截图、
	 * 粘贴文本里带的图片链接都算；宽度留空（= 移除尺寸模式）或尺寸填错时整步不动
	 * （见 `image/size.ts` 的 `pastedImageSizeOptions`）。
	 */
	autoSetImageSizeOnPaste: boolean;
	/**
	 * 在编辑器里粘贴图片文件时**由本插件接管**：自己把图片存进附件夹（一张一张、名字不撞、
	 * 顺手转成 `vaultConvertFormat`）并写好链接，一次粘多张也不会漏。
	 *
	 * 为什么必须自己管：别的图片插件那条自动粘贴是**并发**跑的（Image Converter 的
	 * `handlePaste` 里 `files.map(async …)`）：一次粘多张时每张各算各的输出名，同一秒算出来的
	 * 名字撞在一起，后写的直接 `File already exists` 丢图（2026-09 用户报的"粘两张只剩第一张"）。
	 * 关掉这一项就恢复"别人家的粘贴"行为（观察者 + 文本修复 + 尺寸观望表；别的插件没接管时
	 * 图片就按 Obsidian 自己的方式落盘）。
	 */
	takeOverImagePaste: boolean;
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
	// 导入的图片转成目标格式（默认开）：外部路径图片收进仓库时顺手统一格式，
	// 不转的话仓库里会攒一堆 png/jpg（转码用插件自带的 canvas 编码器，不依赖别的插件）
	convertImportedImages: true,
	// 图片格式转换默认转 webp：仓库里绝大多数图片都该是 webp（省空间、Obsidian 原生支持）
	vaultConvertFormat: 'webp',
	// 质量 75：与常见的 webp 预设一致（100 省不下多少空间，太低截图上的小字会糊）
	convertQuality: '75',
	// pngquant 那两项：程序由用户装在系统里（GPL 二进制不随本插件分发），
	// 路径留空＝按 PATH 与常见安装位置自动找它
	pngquantPath: '',
	pngquantQuality: '65-80',
	// 整理时顺手统一图片格式（默认开）：整理图片就是"把仓库里的图片收拾干净"，
	// 格式统一是其中一环；目标格式沿用 vaultConvertFormat
	tidyConvertFormat: true,
	// 合并完顺手清一遍"没人引用的图片"（默认开，自己实现，见 image/unused.ts）：
	// 与合并互补 —— 合并收的是"同一张图存了两份"，它收的是"一张都没人引用"
	autoClearUnusedImages: true,
	// 左侧栏图标：一键整理（图标沿用 Clear Unused Images 那个 `image-file`，方便直接换掉它那个按钮）
	tidyImagesRibbonIcon: true,
	imageSizeWidth: '100',
	imageSizeHeight: '',
	imageSizeOverwrite: true,
	// 粘贴进来的图片顺手套上默认尺寸（默认开）：粘贴的多半是聊天截图，尺寸统一了笔记才整齐；
	// 只改刚粘的那一段，宽度留空 / 填错时整步不动，撤销一次即可回退
	autoSetImageSizeOnPaste: true,
	// 粘贴图片由本插件接管（默认开）：一次粘多张时别的插件会并发撞名丢图，我们一张一张来
	takeOverImagePaste: true,
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

/**
 * 把插件设置转换成图片转换计划（目标格式 + 质量），四条路共用：
 * 导入外部图片、粘贴进来的图片、两条转换命令、「整理图片」。
 *
 * 收敛逻辑在 `image/convert.ts` 的 `convertPlanFrom` 里（那边是转码器的家，
 * `image/` 不 import `settings/`，所以公共的那一半放在它那儿）。
 */
export function resolveConvertPlan(settings: {
	vaultConvertFormat: string;
	convertQuality: string;
	pngquantPath: string;
	pngquantQuality: string;
}): ConvertPlan | null {
	return convertPlanFrom(
		settings.vaultConvertFormat,
		settings.convertQuality,
		settings.pngquantPath,
		settings.pngquantQuality
	);
}
