import { App, PluginSettingTab, Setting } from "obsidian";
import type { SettingDefinitionItem } from "obsidian";
import ImageTransferPlugin from "./main";
import type { ChatImageOrder, ChatIndent } from "./chat-log";
import { DEFAULT_LEADING_INDENT_MODE, resolveLeadingIndentMode } from "./text-layout";
import type { LeadingIndentMode } from "./text-layout";
import { DEFAULT_SPACING_OPTIONS, resolveCjkDigitMode, resolveSpacingMode } from "./spacing";
import type { SpacingOptions } from "./spacing";

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

/**
 * 设置面板里的小标题（分组用）。
 *
 * Obsidian 的 `Setting.setHeading()` 只有一级，而这里的层级是
 * 「功能分区（代码格式 / 排版格式）→ 子分组（文字间距 / 标点与符号 …）」，
 * 所以子分组自己造一个 h4，用 classes 控制样式（见 styles.css）。
 */
function addSubHeading(containerEl: HTMLElement, text: string) {
	const wrapper = containerEl.createDiv({ cls: 'ait-settings-subheading' });
	wrapper.createEl('h4', { text });
}

export class ImageTransferSettingTab extends PluginSettingTab {
	plugin: ImageTransferPlugin;

	constructor(app: App, plugin: ImageTransferPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// display() is the standard PluginSettingTab lifecycle method.
	// getSettingDefinitions() (since Obsidian 1.13.0) does not support
	// dynamic conditional UI needed for the attachment folder input.
	/**
	 * Obsidian 1.13 以下走这里：手写 DOM。
	 * 1.13 起只要 getSettingDefinitions() 返回非空数组，Obsidian 就不再调用
	 * display()（见 obsidian.d.ts 的说明），而是按声明式定义渲染。
	 * 两边必须一一对应 —— test/settings.test.ts 会检查每个设置项都有定义。
	 */
	display(): void {
		this.renderSettings();
	}

	/** 1.13 以下的手写渲染。切换某项会改变其它项的可见 / 可用状态，所以整块重画 */
	private renderSettings(): void {
		const { containerEl } = this;

		containerEl.empty();

		// 头部信息全部关闭时，正文之间没有任何分隔，可选用空行分隔相邻消息
		const headerIsEmpty = !this.plugin.settings.chatShowUsername
			&& !this.plugin.settings.chatShowDate
			&& !this.plugin.settings.chatShowTime;

		// ========================================================
		// 图片导入
		// ========================================================
		new Setting(containerEl).setName('图片导入').setHeading();

		new Setting(containerEl)
			.setName('附件存储位置')
			.addDropdown(dropdown => dropdown
				.addOption('system', '跟随系统设置 (默认)')
				.addOption('root', '仓库的根目录')
				.addOption('current', '当前文件所在的文件夹')
				.addOption('subfolder', '当前文件所在文件夹下指定的子文件夹')
				.addOption('custom', '指定的附件文件夹')
				.setValue(this.plugin.settings.attachmentLocation)
				.onChange(async (value) => {
					this.plugin.settings.attachmentLocation = value;
					await this.plugin.saveSettings();
					// 重新渲染设置页面，以动态显示或隐藏下方的输入框
					this.renderSettings(); 
				}));

		// 只有当用户选择了需要输入文件夹名称的选项时，才显示此输入框
		if (this.plugin.settings.attachmentLocation === 'subfolder' || this.plugin.settings.attachmentLocation === 'custom') {
			new Setting(containerEl)
				.setName('附件文件夹名称')
				.addText(text => text
					.setPlaceholder('Attachments')
					.setValue(this.plugin.settings.customAttachmentFolder)
					.onChange(async (value) => {
						this.plugin.settings.customAttachmentFolder = value;
						await this.plugin.saveSettings();
					}));
		}

		new Setting(containerEl)
			.setName('图片命名预设')
			.setDesc('支持占位符: {YYYY} {MM} {DD} {HH} {mm} {ss}')
			.addText(text => text
				.setPlaceholder('Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}')
				.setValue(this.plugin.settings.imageNamePreset)
				.onChange(async (value) => {
					this.plugin.settings.imageNamePreset = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('重命名后链接格式')
			.setDesc('控制图片重命名后，笔记内链接使用完整路径还是仅文件名')
			.addDropdown(dropdown => dropdown
				.addOption('full', '完整路径')
				.addOption('filename', '仅文件名')
				.setValue(this.plugin.settings.renameLinkFormat)
				.onChange(async (value) => {
					this.plugin.settings.renameLinkFormat = value;
					await this.plugin.saveSettings();
				}));

		// ========================================================
		// 图片大小
		// ========================================================
		new Setting(containerEl).setName('图片大小').setHeading();

		new Setting(containerEl)
			.setName('默认宽度')
			.setDesc('打开设置弹窗时的默认宽度，单位为像素。宽度与高度都留空表示移除已有尺寸')
			.addText(text => text
				.setPlaceholder('100')
				.setValue(this.plugin.settings.imageSizeWidth)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeWidth = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('默认高度')
			.setDesc('可留空，此时图片按宽度等比例缩放')
			.addText(text => text
				.setPlaceholder('留空')
				.setValue(this.plugin.settings.imageSizeHeight)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeHeight = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('覆盖已有尺寸')
			.setDesc('关闭后只给还没有尺寸的图片补上，已有尺寸的图片保持不动')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.imageSizeOverwrite)
				.onChange(async (value) => {
					this.plugin.settings.imageSizeOverwrite = value;
					await this.plugin.saveSettings();
				}));

		// ========================================================
		// 代码格式（源代码、公式代码怎么写）
		// ========================================================
		new Setting(containerEl).setName('代码格式').setHeading();

		new Setting(containerEl)
			.setName('公式排版')
			.setDesc('整理数学公式：$$…$$ 区块与行内 $…$（行内只按空格规则整理、绝不换行）。原则是"代码里的空格 = 公式渲染出来的空格"：运算 / 逻辑 / 排版符号（= + - \\le \\to \\in、&、\\\\）左右各空一格；一元正负号与 \\partial \\delta \\sin 这类命令和参数之间贴紧（会吃掉命令名时写成 \\delta{x}）；逗号前不加、后加一个空格；多余的空格与换行删掉。只在 \\\\ 处换行，续行缩进 = 首行缩进 + 1 个 tab；$$ 与内容之间不留空格。间距命令与后面字母粘连（\\quadA 会被 LaTeX 当成未定义命令）会拆开：前面已有逗号等分隔就删掉多余的间距，否则写成 \\quad{A}。frontmatter、代码块、\\text{…} 里的文字都不动')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.mathLayout)
				.onChange(async (value) => {
					this.plugin.settings.mathLayout = value;
					await this.plugin.saveSettings();
				}));

		// ========================================================
		// 排版格式（使用者实际看到的格式）
		// ========================================================
		new Setting(containerEl).setName('排版格式').setHeading();

		// ---- 数学符号 ----
		addSubHeading(containerEl, '数学符号');

		new Setting(containerEl)
			.setName('正文数学符号自动加公式')
			.setDesc('把正文里"一看就是数学符号"的写法包上 `$…$`：`矩阵 A` / `矩阵A` → `矩阵 $A$`；`n维` `n 阶` `n 次` → `$n$ 维` `$n$ 阶` `$n$ 次`；`V(F)` / `a(b)` / `T(x)` → `$V(F)$`；整段算式 `x = 0`、`x = Tz`、`V(x) = 0` 一起包；`λ` `Λ` 这类希腊字母换成 `$\\lambda$` `$\\Lambda$`。判定很保守：只有出现括号 / 运算符、左边的数学语境词（矩阵、向量、数域…）、右边的量词（维、阶、次、行、列…）、希腊字母，或本行已确认过的同名变量才动手 —— 英文句子、长单词（Jordan、latex）、两字母缩写（AI、QQ、pg、tv、xx）、缩写 e.g.、路径 C:\\ 、型号 A4、命名约定 Q_inv、分条标签 (a)、任务复选框 - [x]、书名号引号内部与已有公式一律不碰')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.textMathWrapSymbols)
				.onChange(async (value) => {
					this.plugin.settings.textMathWrapSymbols = value;
					await this.plugin.saveSettings();
				}));

		// ---- 文字间距 ----
		addSubHeading(containerEl, '文字间距');

		new Setting(containerEl)
			.setName('中文与英文之间')
			.setDesc('中文和英文单词之间空一个字宽：`用anki卡片` → `用 anki 卡片`。行内代码、双链、链接、标签与英文等价，一并留空格（`见[[备注]]` → `见 [[备注]]`）；中英文与标点之间不留空格')
			.addDropdown(dropdown => dropdown
				.addOption('space', '空一个字宽 (推荐)')
				.addOption('keep', '保持原样')
				.setValue(resolveSpacingMode(this.plugin.settings.spacingCjkLatin, DEFAULT_SPACING_OPTIONS.cjkLatin))
				.onChange(async (value) => {
					this.plugin.settings.spacingCjkLatin = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.cjkLatin);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('中文与数字之间')
			.setDesc('按「中文和数字之间都不空一个字宽」：已有空格一并删掉，`第 3 章` → `第3章`。注意这与常见的盘古之白规则相反，改选「空一个字宽」即可切换')
			.addDropdown(dropdown => dropdown
				.addOption('none', '不留空格 (按笔记规则，推荐)')
				.addOption('space', '空一个字宽')
				.addOption('keep', '保持原样')
				.setValue(resolveCjkDigitMode(this.plugin.settings.spacingCjkDigit))
				.onChange(async (value) => {
					this.plugin.settings.spacingCjkDigit = resolveCjkDigitMode(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('英文与数字之间')
			.setDesc('笔记规则是"一般要空一个字宽"，但 `GPT4`、`3D`、`v1.2.2` 这类专有名词一拆就错，故默认保持原样（专有名词空格以原有形式为准）')
			.addDropdown(dropdown => dropdown
				.addOption('keep', '保持原样 (推荐)')
				.addOption('space', '空一个字宽')
				.setValue(resolveSpacingMode(this.plugin.settings.spacingLatinDigit, DEFAULT_SPACING_OPTIONS.latinDigit))
				.onChange(async (value) => {
					this.plugin.settings.spacingLatinDigit = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.latinDigit);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('公式与文字之间')
			.setDesc('行内公式 $…$ 与前后文字之间空一个字宽：`设$x$为` → `设 $x$ 为`。只动 $ 外面 —— $ 内侧永远不空，那是 Obsidian 能否认出公式的前提；公式与标点之间不留空格')
			.addDropdown(dropdown => dropdown
				.addOption('space', '空一个字宽 (推荐)')
				.addOption('keep', '保持原样')
				.setValue(resolveSpacingMode(this.plugin.settings.spacingMathText, DEFAULT_SPACING_OPTIONS.mathText))
				.onChange(async (value) => {
					this.plugin.settings.spacingMathText = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.mathText);
					await this.plugin.saveSettings();
				}));

		// ---- 标点与符号 ----
		addSubHeading(containerEl, '标点与符号');

		new Setting(containerEl)
			.setName('全角标点两侧不留空格')
			.setDesc('中文标点（，。、；：！？…）与内容之间不留空格：`中文 ，内容` → `中文，内容`。引号 “”‘’ 两侧、书名号《》内侧例外 —— 那里可能是《新 吊带袜天使》这类故意留空的专有名词')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingFullPunct)
				.onChange(async (value) => {
					this.plugin.settings.spacingFullPunct = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('半角标点前不留空格、后空一格')
			.setDesc('英文符号 , . ! ? : 后面空一格、前面不留空格（`word,word` → `word, word`）。小数点与版本号（1.2.2）、时间（12:30）、省略号（...）不适用')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingHalfPunct)
				.onChange(async (value) => {
					this.plugin.settings.spacingHalfPunct = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('括号前后都没有空格')
			.setDesc('半角括号内侧不留空格（`( x )` → `(x)`），外侧也贴紧（`中文 (说明)` → `中文(说明)`、`f (x)` → `f(x)`）—— 就是函数 `f(x)` 那种写法。英文句子里括号两侧是英文词距，外侧保留（`See the appendix (page 3).`）')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingBracketInner)
				.onChange(async (value) => {
					this.plugin.settings.spacingBracketInner = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('数字与单位之间空一格')
			.setDesc('`100kg` → `100 kg`，单位须落在词表里（kg g m s min h L W V A N J Pa Hz px dpi ℃ …）；`%`、`3D`、`4K`、`5G` 这类不算单位，不会被拆开')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingDigitUnit)
				.onChange(async (value) => {
					this.plugin.settings.spacingDigitUnit = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('标点全半角按语境')
			.setDesc('中文语境用全角、英文语境用半角。中文方向：`元素: 内容` → `元素：内容`，`没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且` —— 左边是中文、右边是中文、或整句以中文为主（公式、代码、链接里的字母不算数）就换。英文方向很保守：只有"整句一个中文字都没有、且至少两个英文单词"才把 `，。、；！？` 换成半角 —— 中文笔记里"参数 gain=50、shift=0"这类半中半英的行太多，按比例判定会把顿号误换。`（）`、`：`、书名号引号、`.`、数字后的标点（1,000、12:30）、`\\,`、半角括号内与 `/` 之间的标点、聊天记录头部 `张三: 2024/…` 一律不动')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingHalfToFullPunct)
				.onChange(async (value) => {
					this.plugin.settings.spacingHalfToFullPunct = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('符号自己的空格规则')
			.setDesc('**空格只用来分隔不同语言的内容**（中文 ↔ 西文单词 / 数字 / 公式），不用来分隔内容与符号：`甲&乙`、`甲|乙`、`甲→乙` 贴紧（已有的空格收掉），而 `A & B`、`$A$ & $B$`、`word, word` 留一格；符号与符号之间也贴紧（`如, ：` → `如,：`、`7. 并列：&`）。`^`、`...` 前后不空（`x ^ 2` → `x^2`）；包裹符号（`（）` `《》` `“”`、成对的 `"`）内侧永远贴紧，外侧中文旁贴紧、西文旁留一格（`他说"你好"了`、`He said "hello" loudly`）；`|x|`、`P(A|B)`、`x̂_{k|k}` 这类紧贴字母数字的竖线属于数学记号，一个字符都不动；表格行、`$…$` 与代码块整块跳过。依据是 W3C《中文排版需求》：汉字与西文字母、数字之间才谈空隙（不多于四分之一汉字宽），汉字与标点是 1:1 方块、无缝隙并列')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.spacingSymbolPad)
				.onChange(async (value) => {
					this.plugin.settings.spacingSymbolPad = value;
					await this.plugin.saveSettings();
				}));

		// ---- 标签与板块 ----
		addSubHeading(containerEl, '标签与板块');

		new Setting(containerEl)
			.setName('标签排版')
			.setDesc('把行内的 #标签 统一移到所在块的句尾，与正文之间空一格；整行只有标签时这一行自成一块，位置不动、也不会被并进相邻的正文行。一个段落算一块，一行列表项、一行标题各自算一块，表格按单元格算块（不会把标签挪到别的列）。frontmatter、代码块（围栏或缩进）、行内代码、%%注释%%、双链与链接里的 # 都不算标签')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.tagLayout)
				.onChange(async (value) => {
					this.plugin.settings.tagLayout = value;
					await this.plugin.saveSettings();
					// 重新渲染，刷新「标签排序」的可用状态
					this.renderSettings();
				}));

		new Setting(containerEl)
			.setName('标签排序')
			.setDesc('同一处出现的多个标签按首字母排序（中文按拼音、数字按数值）；关闭后保持原有先后顺序')
			.setDisabled(!this.plugin.settings.tagLayout)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.tagSort)
				.onChange(async (value) => {
					this.plugin.settings.tagSort = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('内容板块排版')
			.setDesc('按首字母对笔记各块内容排序（中文按拼音、数字按数值）。连续的列表项之间、连续的段落之间分别排序，列表与段落不会互相穿插；标题把排序范围切成一个个小节，表格、图片、分隔线、聊天记录保持原位。适合词条、清单类笔记，会重排正文')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.blockSort)
				.onChange(async (value) => {
					this.plugin.settings.blockSort = value;
					await this.plugin.saveSettings();
				}));

		// ---- 行首与标记 ----
		addSubHeading(containerEl, '行首与标记');

		new Setting(containerEl)
			.setName('行首缩进修复')
			.setDesc('把行首"用空格写的缩进"改回 tab：4 个空格算一个 tab，混在 tab 之间的零散空格删掉。正文、图片前多打的 1~3 个空格一并删掉；后面跟列表子项 / 标题等块级结构时保留缩进。顺带规范块级标记的空白：注释（引用）行前的零散空格删掉、">"与正文之间补一个空格（">引用" → "> 引用"）、列表符号与标题符号后的多个空格收成一个。frontmatter 与代码块内部不动')
			.addDropdown(dropdown => dropdown
				.addOption('smart', '智能：列表子项保留，其余行首空格删掉 (推荐)')
				.addOption('strict', '严格：行首只留 tab，空格全删')
				.addOption('off', '关闭')
				.setValue(this.plugin.settings.textLeadingIndentFix)
				.onChange(async (value) => {
					this.plugin.settings.textLeadingIndentFix = resolveLeadingIndentMode(value);
					await this.plugin.saveSettings();
				}));

		// ---- 聊天记录 ----
		addSubHeading(containerEl, '聊天记录');

		new Setting(containerEl)
			.setName('显示用户名')
			.setDesc('关闭后每条消息只保留日期与时间')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowUsername)
				.onChange(async (value) => {
					this.plugin.settings.chatShowUsername = value;
					await this.plugin.saveSettings();
					// 重新渲染，刷新「消息之间插入空行」的可用状态
					this.renderSettings();
				}));

		new Setting(containerEl)
			.setName('显示日期')
			.setDesc('日期格式为 {YYYY}/{MM}/{DD}')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowDate)
				.onChange(async (value) => {
					this.plugin.settings.chatShowDate = value;
					await this.plugin.saveSettings();
					this.renderSettings();
				}));

		new Setting(containerEl)
			.setName('显示时间')
			.setDesc('时间格式为 {HH}:{mm}:{ss}。关闭后排版结果不含时间戳，可避免记录被再次识别为聊天数据')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatShowTime)
				.onChange(async (value) => {
					this.plugin.settings.chatShowTime = value;
					await this.plugin.saveSettings();
					this.renderSettings();
				}));

		new Setting(containerEl)
			.setName('正文缩进')
			.setDesc('控制每条消息正文的缩进方式，可与头部信息区分开')
			.addDropdown(dropdown => dropdown
				.addOption('tab', '制表符 (tab)')
				.addOption('2', '2 个空格')
				.addOption('4', '4 个空格')
				.addOption('none', '不缩进')
				.setValue(this.plugin.settings.chatIndent)
				.onChange(async (value) => {
					this.plugin.settings.chatIndent = value as ChatIndent;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('图文消息中图片的位置')
			.setDesc('一条消息同时含图片和文字时，图片排在文字上方还是下方。选「保持原顺序」则不调整')
			.addDropdown(dropdown => dropdown
				.addOption('keep', '保持原顺序')
				.addOption('above', '图片在上方')
				.addOption('below', '图片在下方')
				.setValue(this.plugin.settings.chatImageOrder)
				.onChange(async (value) => {
					this.plugin.settings.chatImageOrder = value as ChatImageOrder;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('消息之间插入空行')
			.setDesc(headerIsEmpty
				? '头部信息已全部关闭，开启后用空行分隔相邻消息，便于区分说话人'
				: '仅在用户名、日期、时间全部关闭时可用；有头部信息时头部本身已起分隔作用')
			.setDisabled(!headerIsEmpty)
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.chatBlankLineBetweenMessages)
				.onChange(async (value) => {
					this.plugin.settings.chatBlankLineBetweenMessages = value;
					await this.plugin.saveSettings();
				}));
	}

	/**
	 * Obsidian 1.13+ 的声明式设置：面板由这份定义渲染，并据此建立设置搜索索引。
	 * 定义里的 key 就是 settings 的字段名，读写走下面的 getControlValue /
	 * setControlValue（默认实现读 this.plugin.settings，这里补上旧数据的收敛）。
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const headerIsEmpty = () => !this.plugin.settings.chatShowUsername
			&& !this.plugin.settings.chatShowDate
			&& !this.plugin.settings.chatShowTime;

		return [
			{
				type: 'group',
				heading: '图片导入',
				items: [
					{
						name: '附件存储位置',
						control: {
							type: 'dropdown',
							key: 'attachmentLocation',
							defaultValue: DEFAULT_SETTINGS.attachmentLocation,
							options: {
								system: '跟随系统设置 (默认)',
								root: '仓库的根目录',
								current: '当前文件所在的文件夹',
								subfolder: '当前文件所在文件夹下指定的子文件夹',
								custom: '指定的附件文件夹',
							},
						},
					},
					{
						name: '附件文件夹名称',
						visible: () => this.plugin.settings.attachmentLocation === 'subfolder'
							|| this.plugin.settings.attachmentLocation === 'custom',
						control: {
							type: 'text',
							key: 'customAttachmentFolder',
							placeholder: 'Attachments',
							defaultValue: DEFAULT_SETTINGS.customAttachmentFolder,
						},
					},
					{
						name: '图片命名预设',
						desc: '支持占位符: {YYYY} {MM} {DD} {HH} {mm} {ss}',
						control: {
							type: 'text',
							key: 'imageNamePreset',
							placeholder: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}',
							defaultValue: DEFAULT_SETTINGS.imageNamePreset,
						},
					},
					{
						name: '重命名后链接格式',
						desc: '控制图片重命名后，笔记内链接使用完整路径还是仅文件名',
						control: {
							type: 'dropdown',
							key: 'renameLinkFormat',
							defaultValue: DEFAULT_SETTINGS.renameLinkFormat,
							options: {
								full: '完整路径',
								filename: '仅文件名',
							},
						},
					},
				],
			},
			{
				type: 'group',
				heading: '图片大小',
				items: [
					{
						name: '默认宽度',
						desc: '打开设置弹窗时的默认宽度，单位为像素。宽度与高度都留空表示移除已有尺寸',
						control: {
							type: 'text',
							key: 'imageSizeWidth',
							placeholder: '100',
							defaultValue: DEFAULT_SETTINGS.imageSizeWidth,
						},
					},
					{
						name: '默认高度',
						desc: '可留空，此时图片按宽度等比例缩放',
						control: {
							type: 'text',
							key: 'imageSizeHeight',
							placeholder: '留空',
							defaultValue: DEFAULT_SETTINGS.imageSizeHeight,
						},
					},
					{
						name: '覆盖已有尺寸',
						desc: '关闭后只给还没有尺寸的图片补上，已有尺寸的图片保持不动',
						control: {
							type: 'toggle',
							key: 'imageSizeOverwrite',
							defaultValue: DEFAULT_SETTINGS.imageSizeOverwrite,
						},
					},
				],
			},
			{
				type: 'group',
				heading: '代码格式',
				items: [
					{
						name: '公式排版',
						desc: '整理数学公式：$$…$$ 区块与行内 $…$（行内只按空格规则整理、绝不换行）。原则是"代码里的空格 = 公式渲染出来的空格"：运算 / 逻辑 / 排版符号（= + - \\le \\to \\in、&、\\\\）左右各空一格；一元正负号与 \\partial \\delta \\sin 这类命令和参数之间贴紧（会吃掉命令名时写成 \\delta{x}）；逗号前不加、后加一个空格；多余的空格与换行删掉。只在 \\\\ 处换行，续行缩进 = 首行缩进 + 1 个 tab；$$ 与内容之间不留空格。间距命令与后面字母粘连（\\quadA 会被 LaTeX 当成未定义命令）会拆开：前面已有逗号等分隔就删掉多余的间距，否则写成 \\quad{A}。frontmatter、代码块、\\text{…} 里的文字都不动',
						control: {
							type: 'toggle',
							key: 'mathLayout',
							defaultValue: DEFAULT_SETTINGS.mathLayout,
						},
					},
				],
			},
			{
				type: 'page',
				name: '排版格式',
				desc: '使用者实际看到的格式：空格、标点、标签、板块与聊天记录',
				items: [
					{
						type: 'group',
						heading: '数学符号',
						items: [
							{
								name: '正文数学符号自动加公式',
								desc: '把正文里"一看就是数学符号"的写法包上 `$…$`：`矩阵 A` / `矩阵A` → `矩阵 $A$`；`n维` `n 阶` `n 次` → `$n$ 维` `$n$ 阶` `$n$ 次`；`V(F)` / `a(b)` / `T(x)` → `$V(F)$`；整段算式 `x = 0`、`x = Tz`、`V(x) = 0` 一起包；`λ` `Λ` 这类希腊字母换成 `$\\lambda$` `$\\Lambda$`。判定很保守：只有出现括号 / 运算符、左边的数学语境词（矩阵、向量、数域…）、右边的量词（维、阶、次、行、列…）、希腊字母，或本行已确认过的同名变量才动手 —— 英文句子、长单词（Jordan、latex）、两字母缩写（AI、QQ、pg、tv、xx）、缩写 e.g.、路径 C:\\ 、型号 A4、命名约定 Q_inv、分条标签 (a)、任务复选框 - [x]、书名号引号内部与已有公式一律不碰',
								control: {
									type: 'toggle',
									key: 'textMathWrapSymbols',
									defaultValue: DEFAULT_SETTINGS.textMathWrapSymbols,
								},
							},
						],
					},
					{
						type: 'group',
						heading: '文字间距',
						items: [
							{
								name: '中文与英文之间',
								desc: '中文和英文单词之间空一个字宽：`用anki卡片` → `用 anki 卡片`。行内代码、双链、链接、标签与英文等价，一并留空格（`见[[备注]]` → `见 [[备注]]`）；中英文与标点之间不留空格',
								control: {
									type: 'dropdown',
									key: 'spacingCjkLatin',
									defaultValue: DEFAULT_SPACING_OPTIONS.cjkLatin,
									options: {
										space: '空一个字宽 (推荐)',
										keep: '保持原样',
									},
								},
							},
							{
								name: '中文与数字之间',
								desc: '按「中文和数字之间都不空一个字宽」：已有空格一并删掉，`第 3 章` → `第3章`。注意这与常见的盘古之白规则相反，改选「空一个字宽」即可切换',
								control: {
									type: 'dropdown',
									key: 'spacingCjkDigit',
									defaultValue: DEFAULT_SPACING_OPTIONS.cjkDigit,
									options: {
										none: '不留空格 (按笔记规则，推荐)',
										space: '空一个字宽',
										keep: '保持原样',
									},
								},
							},
							{
								name: '英文与数字之间',
								desc: '笔记规则是"一般要空一个字宽"，但 `GPT4`、`3D`、`v1.2.2` 这类专有名词一拆就错，故默认保持原样（专有名词空格以原有形式为准）',
								control: {
									type: 'dropdown',
									key: 'spacingLatinDigit',
									defaultValue: DEFAULT_SPACING_OPTIONS.latinDigit,
									options: {
										keep: '保持原样 (推荐)',
										space: '空一个字宽',
									},
								},
							},
							{
								name: '公式与文字之间',
								desc: '行内公式 $…$ 与前后文字之间空一个字宽：`设$x$为` → `设 $x$ 为`。只动 $ 外面 —— $ 内侧永远不空，那是 Obsidian 能否认出公式的前提；公式与标点之间不留空格',
								control: {
									type: 'dropdown',
									key: 'spacingMathText',
									defaultValue: DEFAULT_SPACING_OPTIONS.mathText,
									options: {
										space: '空一个字宽 (推荐)',
										keep: '保持原样',
									},
								},
							},
						],
					},
					{
						type: 'group',
						heading: '标点与符号',
						items: [
							{
								name: '全角标点两侧不留空格',
								desc: '中文标点（，。、；：！？…）与内容之间不留空格：`中文 ，内容` → `中文，内容`。引号 “”‘’ 两侧、书名号《》内侧例外 —— 那里可能是《新 吊带袜天使》这类故意留空的专有名词',
								control: {
									type: 'toggle',
									key: 'spacingFullPunct',
									defaultValue: DEFAULT_SETTINGS.spacingFullPunct,
								},
							},
							{
								name: '半角标点前不留空格、后空一格',
								desc: '英文符号 , . ! ? : 后面空一格、前面不留空格（`word,word` → `word, word`）。小数点与版本号（1.2.2）、时间（12:30）、省略号（...）不适用',
								control: {
									type: 'toggle',
									key: 'spacingHalfPunct',
									defaultValue: DEFAULT_SETTINGS.spacingHalfPunct,
								},
							},
							{
								name: '括号前后都没有空格',
								desc: '半角括号内侧不留空格（`( x )` → `(x)`），外侧也贴紧（`中文 (说明)` → `中文(说明)`、`f (x)` → `f(x)`）—— 就是函数 `f(x)` 那种写法。英文句子里括号两侧是英文词距，外侧保留（`See the appendix (page 3).`）',
								control: {
									type: 'toggle',
									key: 'spacingBracketInner',
									defaultValue: DEFAULT_SETTINGS.spacingBracketInner,
								},
							},
							{
								name: '数字与单位之间空一格',
								desc: '`100kg` → `100 kg`，单位须落在词表里（kg g m s min h L W V A N J Pa Hz px dpi ℃ …）；`%`、`3D`、`4K`、`5G` 这类不算单位，不会被拆开',
								control: {
									type: 'toggle',
									key: 'spacingDigitUnit',
									defaultValue: DEFAULT_SETTINGS.spacingDigitUnit,
								},
							},
							{
								name: '标点全半角按语境',
								desc: '中文语境用全角、英文语境用半角。中文方向：`元素: 内容` → `元素：内容`，`没有 $M_{ij}$, 且` → `没有 $M_{ij}$，且` —— 左边是中文、右边是中文、或整句以中文为主（公式、代码、链接里的字母不算数）就换。英文方向很保守：只有"整句一个中文字都没有、且至少两个英文单词"才把 `，。、；！？` 换成半角 —— 中文笔记里"参数 gain=50、shift=0"这类半中半英的行太多，按比例判定会把顿号误换。`（）`、`：`、书名号引号、`.`、数字后的标点（1,000、12:30）、`\\,`、半角括号内与 `/` 之间的标点、聊天记录头部 `张三: 2024/…` 一律不动',
								control: {
									type: 'toggle',
									key: 'spacingHalfToFullPunct',
									defaultValue: DEFAULT_SETTINGS.spacingHalfToFullPunct,
								},
							},
							{
								name: '符号自己的空格规则',
								desc: '**空格只用来分隔不同语言的内容**（中文 ↔ 西文单词 / 数字 / 公式），不用来分隔内容与符号：`甲&乙`、`甲|乙`、`甲→乙` 贴紧（已有的空格收掉），而 `A & B`、`$A$ & $B$`、`word, word` 留一格；符号与符号之间也贴紧（`如, ：` → `如,：`、`7. 并列：&`）。`^`、`...` 前后不空（`x ^ 2` → `x^2`）；包裹符号（`（）` `《》` `“”`、成对的 `"`）内侧永远贴紧，外侧中文旁贴紧、西文旁留一格（`他说"你好"了`、`He said "hello" loudly`）；`|x|`、`P(A|B)`、`x̂_{k|k}` 这类紧贴字母数字的竖线属于数学记号，一个字符都不动；表格行、`$…$` 与代码块整块跳过。依据是 W3C《中文排版需求》：汉字与西文字母、数字之间才谈空隙（不多于四分之一汉字宽），汉字与标点是 1:1 方块、无缝隙并列',
								control: {
									type: 'toggle',
									key: 'spacingSymbolPad',
									defaultValue: DEFAULT_SETTINGS.spacingSymbolPad,
								},
							},
						],
					},
					{
						type: 'group',
						heading: '标签与板块',
						items: [
							{
								name: '标签排版',
								desc: '把行内的 #标签 统一移到所在块的句尾，与正文之间空一格；整行只有标签时这一行自成一块，位置不动、也不会被并进相邻的正文行。一个段落算一块，一行列表项、一行标题各自算一块，表格按单元格算块（不会把标签挪到别的列）。frontmatter、代码块（围栏或缩进）、行内代码、%%注释%%、双链与链接里的 # 都不算标签',
								control: {
									type: 'toggle',
									key: 'tagLayout',
									defaultValue: DEFAULT_SETTINGS.tagLayout,
								},
							},
							{
								name: '标签排序',
								desc: '同一处出现的多个标签按首字母排序（中文按拼音、数字按数值）；关闭后保持原有先后顺序',
								control: {
									type: 'toggle',
									key: 'tagSort',
									defaultValue: DEFAULT_SETTINGS.tagSort,
									disabled: () => !this.plugin.settings.tagLayout,
								},
							},
							{
								name: '内容板块排版',
								desc: '按首字母对笔记各块内容排序（中文按拼音、数字按数值）。连续的列表项之间、连续的段落之间分别排序，列表与段落不会互相穿插；标题把排序范围切成一个个小节，表格、图片、分隔线、聊天记录保持原位。适合词条、清单类笔记，会重排正文',
								control: {
									type: 'toggle',
									key: 'blockSort',
									defaultValue: DEFAULT_SETTINGS.blockSort,
								},
							},
						],
					},
					{
						type: 'group',
						heading: '行首与标记',
						items: [
							{
								name: '行首缩进修复',
								desc: '把行首"用空格写的缩进"改回 tab：4 个空格算一个 tab，混在 tab 之间的零散空格删掉。正文、图片前多打的 1~3 个空格一并删掉；后面跟列表子项 / 标题等块级结构时保留缩进。顺带规范块级标记的空白：注释（引用）行前的零散空格删掉、">"与正文之间补一个空格（">引用" → "> 引用"）、列表符号与标题符号后的多个空格收成一个。frontmatter 与代码块内部不动',
								control: {
									type: 'dropdown',
									key: 'textLeadingIndentFix',
									defaultValue: DEFAULT_LEADING_INDENT_MODE,
									options: {
										smart: '智能：列表子项保留，其余行首空格删掉 (推荐)',
										strict: '严格：行首只留 tab，空格全删',
										off: '关闭',
									},
								},
							},
						],
					},
					{
						type: 'group',
						heading: '聊天记录',
						items: [
							{
								name: '显示用户名',
								desc: '关闭后每条消息只保留日期与时间',
								control: {
									type: 'toggle',
									key: 'chatShowUsername',
									defaultValue: DEFAULT_SETTINGS.chatShowUsername,
								},
							},
							{
								name: '显示日期',
								desc: '日期格式为 {YYYY}/{MM}/{DD}',
								control: {
									type: 'toggle',
									key: 'chatShowDate',
									defaultValue: DEFAULT_SETTINGS.chatShowDate,
								},
							},
							{
								name: '显示时间',
								desc: '时间格式为 {HH}:{mm}:{ss}。关闭后排版结果不含时间戳，可避免记录被再次识别为聊天数据',
								control: {
									type: 'toggle',
									key: 'chatShowTime',
									defaultValue: DEFAULT_SETTINGS.chatShowTime,
								},
							},
							{
								name: '正文缩进',
								desc: '控制每条消息正文的缩进方式，可与头部信息区分开',
								control: {
									type: 'dropdown',
									key: 'chatIndent',
									defaultValue: DEFAULT_SETTINGS.chatIndent,
									options: {
										tab: '制表符 (tab)',
										'2': '2 个空格',
										'4': '4 个空格',
										none: '不缩进',
									},
								},
							},
							{
								name: '图文消息中图片的位置',
								desc: '一条消息同时含图片和文字时，图片排在文字上方还是下方。选「保持原顺序」则不调整',
								control: {
									type: 'dropdown',
									key: 'chatImageOrder',
									defaultValue: DEFAULT_SETTINGS.chatImageOrder,
									options: {
										keep: '保持原顺序',
										above: '图片在上方',
										below: '图片在下方',
									},
								},
							},
							{
								name: '消息之间插入空行',
								desc: '仅在用户名、日期、时间全部关闭时可用；有头部信息时头部本身已起分隔作用',
								control: {
									type: 'toggle',
									key: 'chatBlankLineBetweenMessages',
									defaultValue: DEFAULT_SETTINGS.chatBlankLineBetweenMessages,
									disabled: () => !headerIsEmpty(),
								},
							},
						],
					},
				],
			},
		];
	}

	/**
	 * 读取控件当前值。
	 * data.json 里可能存着旧版本没有的字段或手工改坏的值，
	 * 这里按 getSpacingOptions() 的同一套收敛规则返回，免得下拉框显示成空白。
	 */
	getControlValue(key: string): unknown {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		switch (key) {
			case 'spacingCjkLatin':
				return resolveSpacingMode(this.plugin.settings.spacingCjkLatin, DEFAULT_SPACING_OPTIONS.cjkLatin);
			case 'spacingCjkDigit':
				return resolveCjkDigitMode(this.plugin.settings.spacingCjkDigit);
			case 'spacingLatinDigit':
				return resolveSpacingMode(this.plugin.settings.spacingLatinDigit, DEFAULT_SPACING_OPTIONS.latinDigit);
			case 'spacingMathText':
				return resolveSpacingMode(this.plugin.settings.spacingMathText, DEFAULT_SPACING_OPTIONS.mathText);
			case 'textLeadingIndentFix':
				return resolveLeadingIndentMode(this.plugin.settings.textLeadingIndentFix);
			default:
				return settings[key];
		}
	}

	/** 写入控件值：先收敛，再存盘，最后让其它设置项的 visible / disabled 重新求值 */
	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		switch (key) {
			case 'spacingCjkLatin':
				settings[key] = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.cjkLatin);
				break;
			case 'spacingCjkDigit':
				settings[key] = resolveCjkDigitMode(value);
				break;
			case 'spacingLatinDigit':
				settings[key] = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.latinDigit);
				break;
			case 'spacingMathText':
				settings[key] = resolveSpacingMode(value, DEFAULT_SPACING_OPTIONS.mathText);
				break;
			case 'textLeadingIndentFix':
				settings[key] = resolveLeadingIndentMode(value);
				break;
			default:
				settings[key] = value;
		}
		await this.plugin.saveSettings();
		const tab = this as unknown as { refreshDomState?: () => void };
		tab.refreshDomState?.();
	}
}
