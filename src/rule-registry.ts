/**
 * 规则登记表：**一条规则一条记录**，把「规范出处 ↔ 设置开关 ↔ 实现 ↔ 测试」串起来。
 *
 * ## 为什么要有这张表
 *
 * 排版规则是在笔记规范（vault 里的 `data/data note/data note.md`）里讨论出来的，
 * 代码这边靠注释里的"英文符号 1""标记命名 4"来标出处。讨论久了必然出事：
 * 规范改过一轮之后（`latex 符号格式` 这一节被并进 `通用符号` 并重新编号），
 * 注释里的出处就对不上了 —— 没人知道哪条实现对应哪条规则，也没人知道改规范要动哪里。
 *
 * 这张表把三件事固定下来，并由 test/rules.test.ts 逐条核对：
 * 1. **规范出处真的存在**（章节路径 + 条目号能在规范笔记里找到；找不到规范文件时自动跳过，CI 不受影响）；
 * 2. **开关真的存在**（`switchKeys` 里的每一项都必须是设置字段，且设置面板里有对应的项；反过来每个设置字段也都要有规则用着）；
 * 3. **实现与测试真的存在**（`impl.file` 里的符号、`tests` 里的文件都必须能找到）。
 *
 * 这样"规范改了、代码没跟上"会变成一条测试失败，而不是半年后的一次考古。
 *
 * ## 状态说明
 *
 * - `done`：有实现，行为与规范一致；
 * - `partial`：实现了，但有已知偏差（`note` 里写明差在哪）；
 * - `spec-only`：规范里有这一条，代码里没有对应实现（`note` 里写明现状）。
 *
 * `docs/规则登记表.md` 由本文件生成（`node test/run-tests.mjs --update-rules-doc`）。
 *
 * 只被测试与文档生成用到，不进 main.js —— 所以这里可以放心 import node 内置模块。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 规范出处：规范笔记里的章节路径 + 条目号 */
export interface SpecRef {
	/** 章节路径，用 ` / ` 连接各级标题，如 `格式 / 排版格式 / 标点符号 / 通用符号` */
	path: string;
	/** 该节里第几条（规范用 `1.` `2.` 编号，只认顶格的那些） */
	item: number;
}

/** 实现状态 */
export type RuleStatus = 'done' | 'partial' | 'spec-only';

export interface RuleRecord {
	/** 稳定标识 */
	id: string;
	/** 一句话说明这条规则做什么 */
	name: string;
	/** 规范出处；规范里没有对应条目时为 null */
	spec: SpecRef | null;
	status: RuleStatus;
	/** 这条规则牵动的设置开关（设置字段名）；没有开关时是空数组 */
	switchKeys: string[];
	/** 实现位置：文件 + 其中的声明名（导出与否都行） */
	impl: { file: string; symbols: string[] };
	/** 覆盖这条规则的测试文件 */
	tests: string[];
	/** 备注：已知偏差、重复实现、规范缺口…（status 不是 done 时必填） */
	note?: string;
}

export interface RuleSection {
	heading: string;
	rules: RuleRecord[];
}

/**
 * 规范笔记的位置：环境变量优先，否则按下面的候选路径找第一份存在的。
 *
 * 源码仓库（projects/js_02）与 vault 不在同一棵树里 —— 从前那个相对路径
 * `../../../data/data note/data note.md` 是"仓库就在插件目录里"时代的写法，
 * 迁移后指到了 projects 下，核对会被静默跳过。第一条候选是本机 vault 的绝对路径。
 */
export const SPEC_NOTE_PATH =
	process.env.NOTE_TIDY_SPEC ??
	[
		'D:/data/online/software/common/obsidian/data/data note/data note.md',
		'../../../data/data note/data note.md',
	].find(candidate => existsSync(resolve(candidate))) ??
	'D:/data/online/software/common/obsidian/data/data note/data note.md';

/**
 * 规范里的章节路径。
 *
 * 2026-09 规范重排过两次：`## 排版格式` 这一层被取消（各节直接挂在 `# 格式` 下）、
 * `标签` / `数字` 改名成 `标签格式` / `数字格式`、`## latex 排版格式` 并进了
 * `### 公式代码格式`、代码格式那一节重编了号；规范笔记也从 `note note.md`
 * 换成了 `data note.md`（`命名` / `格式` 两章现在都在这一篇里），
 * 原来 `命名 / 标记命名` 那一节整节删掉了（见 structure.markers 的备注）。
 * 这份路径跟着规范走 —— 规范再改，test/rules.test.ts 会立刻报"找不到这一节"。
 */
const S = {
	general: '格式 / 概论',
	code: '格式 / 代码格式',
	formulaCode: '格式 / 代码格式 / 公式代码格式',
	tag: '格式 / 标签格式',
	digit: '格式 / 数字格式',
	punctGeneral: '格式 / 标点符号 / 概论',
	commonSymbol: '格式 / 标点符号 / 通用符号',
	cnSymbol: '格式 / 标点符号 / 中文符号',
	enSymbol: '格式 / 标点符号 / 英文符号',
	mathSymbol: '格式 / 标点符号 / 数学符号',
	textGeneral: '格式 / 文字格式 / 概论',
	textChinese: '格式 / 文字格式 / 中文',
} as const;

export const RULE_SECTIONS: RuleSection[] = [
	{
		heading: '图片功能',
		rules: [
			{
				id: 'image.transfer',
				name: '外部绝对路径图片导入仓库，链接换成内部双链',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder'],
				impl: { file: 'src/image/transfer.ts', symbols: ['transferExternalImages'] },
				tests: [],
				note: '依赖 Obsidian 的 vault / fileManager API，没有单测；附件夹定位另有 image.attachment-folder 一条',
			},
			{
				id: 'image.attachment-folder',
				name: '附件文件夹定位与按需创建',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder'],
				impl: {
					file: 'src/image/attachment-folder.ts',
					symbols: ['resolveAttachmentFolder', 'getTargetAttachmentFolder', 'ensureFolder', 'parentPathOf'],
				},
				tests: [],
				note: '「只算路径」与「真的要写才创建」分成两步，避免给没有图片的笔记凭空建空文件夹',
			},
			{
				id: 'image.garbled',
				name: '乱码图片改名（特殊字符 / URL 编码残留 / 纯数字点号）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/image/rename.ts', symbols: ['isGarbledImageName', 'renameGarbledImages'] },
				tests: [],
				note: '三条判据见 isGarbledImageName 的注释；改名走 Obsidian 原生 renameFile，所以没有纯函数单测',
			},
			{
				id: 'image.rename-preset',
				name: '按预设改名（含强制模式与「已符合格式就保留原名」）',
				spec: null,
				status: 'done',
				switchKeys: ['imageNamePreset'],
				impl: {
					file: 'src/image/rename.ts',
					symbols: ['renameImagesToPreset', 'countImages'],
				},
				tests: [],
				note: '预设 → 正则的转换在 image/naming.ts 的 matchesNamePreset',
			},
			{
				id: 'image.unique-name',
				name: '文件名在仓库里唯一（四层检查，重名往后推一秒）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/naming.ts',
					symbols: ['generateUniqueTargetPath', 'buildVaultBasenameMap'],
				},
				tests: [],
				note: '裸文件名链接一旦撞名，笔记可能显示成另一张图，所以这条是图片功能的硬约束',
			},
			{
				id: 'image.same-name',
				name: '同名图片歧义时不猜（宁可跳过，也不改错文件）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/links.ts',
					symbols: ['resolveImageLink', 'buildBasenameIndex', 'linkBasename'],
				},
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.link-format',
				name: '链接写法：完整路径还是仅文件名（同名时强制完整路径）',
				spec: null,
				status: 'done',
				switchKeys: ['renameLinkFormat'],
				impl: {
					file: 'src/image/links.ts',
					symbols: ['chooseLinkTarget', 'isImagePath', 'buildCopyName'],
				},
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.link-normalize',
				name: '改名后统一修正全库链接格式（保留 `#片段`）',
				spec: null,
				status: 'done',
				switchKeys: ['renameLinkFormat'],
				impl: { file: 'src/image/rename.ts', symbols: ['fixImageLinkFormats'] },
				tests: [],
			},
			{
				id: 'image.organize',
				name: '整理图片位置：把别处的图片复制进本笔记的附件夹',
				spec: null,
				status: 'done',
				switchKeys: ['attachmentLocation', 'customAttachmentFolder', 'renameLinkFormat'],
				impl: { file: 'src/image/organize.ts', symbols: ['organizeNoteImages'] },
				tests: ['test/image-organizer.test.ts'],
			},
			{
				id: 'image.size',
				name: '图片大小批改（宽 / 高 / 是否覆盖已有尺寸）',
				spec: null,
				status: 'done',
				switchKeys: ['imageSizeWidth', 'imageSizeHeight', 'imageSizeOverwrite'],
				impl: {
					file: 'src/image/size.ts',
					symbols: ['applyImageSize', 'validateImageSize', 'toSizeString'],
				},
				tests: ['test/image-size.test.ts'],
			},
			{
				id: 'image.external-path',
				name: '弹性路径解析：URL 编码、Markdown 转义、大小写不一致都能找到文件',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/external-path.ts',
					symbols: ['flexibleProbing', 'resolvePhysicalPath'],
				},
				tests: [],
				note: '直接读磁盘，测试需要真实文件系统，故只有手动验证',
			},
			{
				id: 'image.extension-sets',
				name: '两套扩展名表：受管位图（会改名）与图片链接判定（更宽）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/constants.ts',
					symbols: ['MANAGED_IMAGE_EXTENSIONS', 'MANAGED_IMAGE_EXT_RE', 'wikiEmbedRe', 'externalImageRe'],
				},
				tests: [],
				note: '刻意不合并：合并会让改名功能开始碰 .svg，或让 avif 链接解析不出来（见文件头注释）',
			},
			{
				id: 'image.selection-count',
				name: '状态栏显示当前选中内容里的图片张数',
				spec: null,
				status: 'done',
				switchKeys: ['showSelectionImageCount'],
				impl: {
					file: 'src/ui/selection-count.ts',
					symbols: ['formatSelectionImageCount', 'SelectionImageCount'],
				},
				tests: ['test/selection-count.test.ts'],
				note: '不是排版规则，是状态栏那一格的显示。"什么算一张图片"在 image.link-scan 那一条（与本条共用同一份扫描）；选区变化靠 CodeMirror 扩展（src/ui/selection-status.ts）：Obsidian 公开事件里只有 editor-change，拖选不触发',
			},
			{
				id: 'image.link-scan',
				name: '图片嵌入扫描：`![[图.png]]` 与 `![说明](图.png)`，代码块与行内代码里的不算',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/scan.ts',
					symbols: ['collectImageRefs', 'countImageRefs', 'findImageRefAt', 'pickImageRefs'],
				},
				tests: ['test/image-scan.test.ts'],
				note: '状态栏计数与"复制图片"共用这一份扫描（前者要张数，后者要目标与位置）。只数嵌入，普通链接不算；"算不算图片"沿用 image/links 的 isImagePath。围栏代码块走 text/line-scan 的 markFenceLines —— 拿到的是片段，开头的 `---` 多半是分隔线，不能按 frontmatter 判',
			},
			{
				id: 'image.copy-resolve',
				name: '复制图片：把引用解析成磁盘文件（同名不猜 + 去重）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/copy.ts',
					symbols: ['resolveImageFiles', 'absolutePathOf', 'basePathOf', 'isExternalTarget', 'baseNameOf', 'vaultPathFromResourceUrl'],
				},
				tests: ['test/image-copy.test.ts'],
				note: '解析规则沿用图片功能的老两条：同名歧义宁可跳过（links.ts 的 resolveImageLink）、同一张图只放一份（否则粘到文件夹里会多出「图 2.png」）。外部绝对路径（`D:\\图.png`）交给 external-path 去磁盘上找；`/开头` 是"仓库根目录"而不是磁盘根，不当外部路径处理。阅读模式里只有 `<img>`，拿 `internal-embed` 的 src，拿不到就把 `app://local/…` 的资源 URL 按适配器 basePath 还原成仓库路径',
			},
			{
				id: 'image.copy-to-clipboard',
				name: '复制图片到系统剪贴板：文件夹里能粘出文件，聊天窗口里能贴出图片',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/clipboard.ts',
					symbols: ['copyImageFiles', 'clipboardCommandFor', 'buildPowerShellScript', 'buildFileScript', 'buildRichScript', 'encodePowerShellCommand', 'buildAppleScript', 'COMMAND_LINE_LIMIT', 'RichClipboardContent'],
				},
				tests: ['test/image-clipboard.test.ts'],
				note: 'Electron / 网页剪贴板只能写位图（CF_DIB），资源管理器不认（Image Toolkit 的复制图片就是这个毛病，粘进文件夹什么都没有），所以写**文件拖放列表**（CF_HDROP）得请系统工具代劳：Windows 用 powershell.exe（纯图片走 WinForms 的 `DataObject`，图文混排走 Win32 原生接口，见 `buildRichScript`），macOS 用 osascript 的 POSIX file。**纯图片那条路不写文本格式**：CF_UNICODETEXT 与 CF_HDROP 同时存在时有些程序会粘两遍（Windows Terminal 修过这个 bug）。**图文混排那条路反过来**：只写 HTML + 纯文本，**不放文件列表也不放位图**（有文件 QQ 就只贴图片、有位图微信就不解析 HTML），见 `image.copy-rich`。路径一律 base64 进脚本、整段脚本再走 -EncodedCommand（UTF-16LE），命令行上不出现任何用户内容。**选区里文字一多就得改路子**：Windows 一条命令行最多 32767 个字符，而 -EncodedCommand 里那串 base64 是脚本的两倍多 —— 长选区（HTML 里带着整段正文与内嵌图片）会把命令行撑爆，所以超过 `COMMAND_LINE_LIMIT` 时改成把脚本写进系统临时目录、用 -File 执行（写完即删；落盘文件带 BOM，否则 Windows PowerShell 5.1 按 ANSI 读，脚本里的中文注释变乱码）。⚠️ `.NET` 的 `DataObject` **不能**用来写 CF_HTML：`SetData` 一个 byte[] 进去，落到剪贴板上的是字符串 `"System.Byte[]"`（本机实测），而且格式顺序也不听我们的（实测 `CF_HDROP` 打头）',
			},
			{
				id: 'image.copy-shortcut',
				name: '接管 Ctrl+C：正文里选中图片时按插件的方法复制文件（可选项，默认关）',
				spec: null,
				status: 'done',
				switchKeys: ['takeOverCopyShortcut'],
				impl: {
					file: 'src/ui/copy-shortcut.ts',
					symbols: ['registerCopyShortcut', 'isCopyShortcut'],
				},
				tests: ['test/copy-shortcut.test.ts'],
				note: '正文里的 `![[图.png]]` 是**文本**，系统 Ctrl+C 复制的是那串链接 —— 粘到文件夹里得到的是一个文件名的字符串，粘到聊天窗口里也只是一行字。开了这个开关后，在编辑器里按 Ctrl+C（macOS 的 ⌘C 同样算）改走「复制图片」那条路：选中的图片优先，选区里没图就看光标下那一张；**选区里还有文字时连文字一起复制**（图文混排，见 `image.copy-rich`）。**只在编辑器里抢**（事件源要有 `.cm-editor` 祖先）：输入框、设置面板、其它插件的按钮一律放行。判定集中在 `isCopyShortcut`：带 Shift / Alt 的不抢（Ctrl+Shift+C 在 Obsidian 里另有命令）、输入法组词中不抢。抢到就 `preventDefault` + `stopPropagation`，免得 Obsidian 自己再复制一遍把文件挤掉',
			},
			{
				id: 'image.copy-rich',
				name: '图文混排复制：选区里既有文字又有图片时，聊天窗口里贴出"文字 + 图片"',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/image/rich-copy.ts',
					symbols: [
						'hasTextBesidesImages', 'fileUrlOf', 'escapeHtml', 'buildHtmlFragment', 'buildClipboardHtml',
						'buildRichContent', 'imageSourceMap', 'dataUriOf', 'mimeTypeOf', 'utf8Length',
						'MAX_EMBED_BYTES', 'MAX_EMBED_TOTAL_BYTES',
					],
				},
				tests: ['test/rich-copy.test.ts'],
				note: '选区里既有文字又有图片时，这一份只写 **HTML（CF_HTML）与纯文本**：QQ / 微信 贴出来就是"文字 + 图片"。**纯图片仍然走文件列表那条路**（文件夹里能粘出文件，行为不变）。四条规矩：① **混排里绝不能有文件列表**（2026-09 用户实测：只放 CF_HDROP 时 QQ 贴出来只有图片、没有文字 —— 它的粘贴处理是先看有没有文件，有文件就直接当图片上传，那段文字根本没机会出现）；代价是混选复制粘不到文件夹里，要图片文件就选纯图片；② **图片内嵌成 data URI**：QQ NT / 微信 是浏览器内核，从非 file 页面加载 `file:///` 子资源会被安全策略拦掉（贴出来是裂图），读不到 / 后缀不认识 / 单张超 `MAX_EMBED_BYTES` / 合计超 `MAX_EMBED_TOTAL_BYTES` 时才退回 `file:///`；③ **CF_HTML 是 UTF-8 字节流**，头里的 StartHTML / EndHTML / StartFragment / EndFragment 是**字节**偏移、补零到固定宽度（10 位），中文一个字三字节 —— 按字符数算就会错位，程序解析出来是乱码（社区里"贴出来是问号"就是这个）；④ 混排时**一份位图都不放** —— 剪贴板里只要有 CF_BITMAP，微信 / 企业微信 就不再解析 HTML，贴出来只剩一张图。写剪贴板的那一端见 `clipboard.ts` 的 `buildRichScript`',
			},
			{
				id: 'image.copy-menu',
				name: '本插件的右键菜单项：复制图片 / 快速设置图片大小 / 管理入口（只插自己的项，不接管菜单）',
				spec: null,
				status: 'done',
				switchKeys: [
					'imageMenuCopyItem', 'imageMenuQuickSizeItem', 'imageMenuManageItem',
					'fileMenuImageSubmenu', 'fileMenuTextSubmenu', 'menuHiddenItems',
				],
				impl: {
					file: 'src/ui/image-menu.ts',
					symbols: [
						'registerImageMenu', 'ownMenuEntries', 'addOwnMenuItems', 'editorImageRefs', 'copyMenuTitle',
						'lastDetectedMenuItems', 'recordDetectedMenuItems', 'MANAGE_MENU_TITLE', 'QUICK_SIZE_MENU_TITLE',
						'OWN_ITEMS', 'OWN_ITEM_SCOPES', 'OWN_ITEM_COMMANDS',
					],
				},
				tests: ['test/image-menu.test.ts'],
				note: '**不接管菜单**：Obsidian 没有"往原生菜单追加一项"的接口，社区里的图片插件基本都自己弹一份（`preventDefault` 掉原生的），代价是原生项与其它插件的项全没了 —— 这里只往里插自己的项。两个加法：笔记正文走官方的 `editor-menu`（只追加）；图片 / 文件夹菜单靠 menu-injector 在菜单显示时插，显示之后把我们自己的项**重排到最前面**（`moveOwnItemsFirst`，同一个任务里做完、浏览器还没绘制，用户看不到跳动）。菜单项一律带"（Note Tidy）"：原生菜单里本来就有"复制图片"，且那个是位图版。**本插件自己的项只认自己的开关，绝不走"按标题隐藏"那条路** —— 否则标题一旦进了隐藏名单，"管理右键菜单"就再也点不开、「图片功能」二级栏也会被摘掉（2026-09 踩过这个坑）。`OWN_ITEMS` / `OWN_ITEM_SCOPES` / `OWN_ITEM_COMMANDS` 是这五项的单一数据源（图标与说明 / 出现在哪几层 / 对应哪条命令，二级栏是容器所以命令为 null），管理面板与 `test/commands.test.ts` 都按它核',
			},
			{
				id: 'image.menu-injector',
				name: '菜单观察与插项：接 Menu.prototype + 实例两层，三个菜单各自记录与过滤',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/ui/menu-injector.ts',
					symbols: ['installMenuInjector', 'observeMenuInstance', 'moveOwnItemsFirst', 'removeHiddenItems', 'seenMenuItemTitles', 'probeMenuItemTitle'],
				},
				tests: ['test/image-menu.test.ts'],
				note: '**两层**：`installMenuInjector` 接 `Menu.prototype`（对"和插件同一个 Menu 类"的菜单有效 —— 图片菜单就是这条路），`observeMenuInstance` 接 Obsidian 通过 `editor-menu` / `file-menu` **交到我们手上的那个实例**（编辑器菜单、文件菜单不一定走插件的 Menu 类，光靠原型读不到它加了什么 —— 2026-09 笔记菜单一直空着就是这个原因）。两层都做四件事：记录菜单项、把我们自己的项插进去并**排到最前**（`moveOwnItemsFirst`：`addItem` 只能往后加，顺序只能在显示之后于 DOM 上重排）、按 `menuHiddenItems` 过滤、以及**显示后按标题把隐藏项摘掉**（`removeHiddenItems`）—— 最后这条是必需的：新增链接 / 新增外部链接 / 文本格式 / 段落设置这些项**在我们拿到菜单之前**就加好了，`addItem` 那一刻根本拦不住（2026-09 用户报"关不掉"）。原型那层：右键按下时"上膛" → 上膛期间**每份菜单各记一份清单** → `show*` 时**只认"真要显示的那份"**（不能认"第一份"：编辑器菜单的二级菜单 —— 正文 / 1~6 级标题 / 引用 / 任务列表 / 表格 / 脚注 / 标注 —— 可能比主菜单先建，2026-09 的 bug）；二级菜单是之后才弹的，所以作用域会"粘"30 秒（`STICKY_SCOPE_MS`），那一层也按同一份名单过滤。检测结果按用户看到的顺序给（DOM 顺序优先），并且**被隐藏名单拦下 / 摘掉的项要补回检测结果**（`seenMenuItemTitles`：原型那层在 `addItem` 与摘项时各记一笔，实例那层补读 DOM 时并回来 —— 不补的话"关掉一项，它就从这个菜单的清单里消失"，管理面板上再也找不到那个开关，2026-09 用户报的文件夹菜单「删除」）。⚠️ 两层都失效时的表现很好认：右键看不到本插件的项、管理面板里也检测不到任何项',
			},
			{
				id: 'image.menu-hidden',
				name: '隐藏名单：`作用域：标题` 的解析与生成（不写作用域按图片算）',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/ui/menu-hidden.ts',
					symbols: ['MENU_SCOPES', 'MENU_SCOPE_LABELS', 'parseHiddenItems', 'serializeHiddenItems', 'isHiddenItem', 'withHiddenItem', 'menuItemsForPanel'],
				},
				tests: ['test/menu-hidden.test.ts'],
				note: '三个菜单各一份名单，存成一段文本（`menuHiddenItems`）：每行「作用域：标题」，作用域写 图片 / 笔记 / 文件夹（英文 key 也认）；**不写作用域的按图片算** —— 最早的版本只支持图片菜单、写的就是裸标题，这样老数据不用迁移。只按标题原文匹配，所以本插件自己那些带动态数字的项不进这份名单。面板列的是 `menuItemsForPanel`（检测到的 + 名单里的）：**名单里那些这次检测不到的也必须列出来** —— 隐藏是靠"把项从菜单里摘掉"实现的，摘掉就检测不到，只列检测结果的话用户关掉一项就再也找不到那个开关（2026-09 的 bug）',
			},
			{
				id: 'image.menu-manage',
				name: '右键菜单管理面板：看三个菜单里检测到的项、开关哪些显示',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/ui/menu-manage-modal.ts', symbols: ['MenuManageModal'] },
				tests: ['test/menu-hidden.test.ts'],
				note: '清单来自"最近一次右键"（image-menu.ts 与 menu-injector 在上膛期间看到的项，含原生项与其它插件加的项），按 图片 / 笔记 / 文件夹 三节列出 —— 并且**每节列的是"检测到的 + 隐藏名单里的"**（`menuItemsForPanel`）：关掉的项在菜单里已经被摘掉，只列检测结果的话它就消失了，用户再也打不开（2026-09 用户报"右键文件夹没有删除这个选项了，管理面板里也找不到"—— 名单其实一直存在设置里，是面板没把它列出来）。所以面板里关掉的项一直是关着开关列在那儿的，随时能再打开；底部另有「全部恢复显示」按钮（清空名单），用来收拾旧版本攒下的记录。**开关一律"开着 = 显示"**：早先做成"勾上 = 隐藏"，用户把"开启管理菜单"理解成勾上，就把自己的入口关掉了（2026-09 的 bug）。本插件自己的三项由各自的开关管、不进隐藏名单。面板只做"开关 + 写回设置"，菜单逻辑不在这里；入口是图片菜单里的"管理右键菜单…（Note Tidy）"与命令面板的同名命令（那条命令没有菜单入口，在 test/commands.test.ts 的 PANEL_COMMANDS 里登记）',
			},
		],
	},
	{
		heading: '排版格式 · 标点与符号',
		rules: [
			{
				id: 'punct.half-width',
				name: '半角标点 `, . ! ? :` 前不留空格、后空一格',
				spec: { path: S.enSymbol, item: 1 },
				status: 'done',
				switchKeys: ['spacingHalfPunct'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.quote',
				name: '包裹符号：引号自己不添空格（内侧贴紧，外侧按「分隔语言」办）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['OPEN_QUOTE_RULE', 'CLOSE_QUOTE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '与 punct.bracket 同一条语义：**包裹符号自己不添空格** —— 内侧贴紧（`" 引文 "` → `"引文"`、`" + "` → `"+"`），外侧不主动加也不删语言自带的词距（中文旁贴紧 `他说 "你好" 了` → `他说"你好"了`；西文旁留一格 `He said "hello" loudly`，那是英文词距）。落单的引号（`2" 的管子`）不成对，一个字符都不动',
			},
			{
				id: 'punct.ellipsis',
				name: '`...` 前后不留空格',
				spec: { path: S.enSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/tokenize.ts', symbols: ['markEllipsisRuns'] },
				tests: ['test/spacing.test.ts'],
				note: '2026-09 规范重排后「英文符号」只剩两条（原来第 3 条的位置），这条跟着挪到第 2 条',
			},
			{
				id: 'punct.en-modifier',
				name: '英文里修饰符号与所修饰的词看作整体（`he is the "man"` 周围保留词距）',
				spec: { path: S.enSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['OPEN_QUOTE_RULE', 'CLOSE_QUOTE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '实现机制是 SymbolRule.scope = latin：修饰符号的 `space` 只对**西文内容**生效 —— 所以英文旁按词距留一格（`he is the "man"` 原样；漏了就补，`the"man"` → `the "man"`），中文旁贴紧（`他说 "你好" 了` → `他说"你好"了`）。中文侧写的是「内外均没有空格」（通用符号 3 的包裹符号子条目），英文侧写的是这条 —— 两句话说的是同一件事的两面',
			},
			{
				id: 'punct.bracket',
				name: '包裹符号：括号自己不添空格（内侧贴紧，外侧按「分隔语言」办）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingBracketInner'],
				impl: {
					file: 'src/text/spacing/gap.ts',
					symbols: ['decideGap'],
				},
				tests: ['test/spacing.test.ts'],
				note: '「内外均没有空格」的意思是**包裹符号自己不添空格**，不是"把外侧已有的空格也删掉"：内侧的填充空格删掉（`( x )` → `(x)`），外侧不主动加、也不删**语言自带**的词距 —— 西文旁那一格是英文词距（`appendix (page 3)`），中文旁本来就没有（`中文 (说明)` → `中文(说明)`、`he said 你好(nihao)`）。`||` 这种包裹符号另见 punct.package',
			},
			{
				id: 'punct.package',
				name: '包裹符号 `||` 前后不加空格（`范数 ||x||` 的外侧留白不删）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['PACKAGE_RULE'] },
				tests: ['test/spacing.test.ts'],
				note: '连续两个及以上的 `|` 整体当包裹符号，按 通用符号 3 的包裹符号子条目贴紧；外侧给 `keep`：紧贴内容那一侧本来就贴着，而"范数 ||x|| 的写法"这种外侧留白属于文字间距规则，包裹符号不该去删它',
			},
			{
				id: 'punct.full-width',
				name: '全角标点两侧不留空格（引号与书名号内部除外）',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingFullPunct'],
				impl: { file: 'src/text/spacing/tokenize.ts', symbols: ['classifyChar'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.language-switch',
				name: '标点全半角按语境切换（中文句用全角、英文句用半角）',
				spec: { path: S.punctGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingHalfToFullPunct'],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['convertHalfPunct', 'convertFullPunct', 'sentenceLanguages'],
				},
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'punct.symbol-adjacent',
				name: '符号与符号之间没有空格（`,：`、`(+)`、`"+"`）',
				spec: { path: S.punctGeneral, item: 4 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'symbol.cjk-adjacent',
				name: '中文与符号之间不加空格（`瑞克&莫蒂`）',
				spec: { path: S.cnSymbol, item: 1 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
				note: '实现方式是 SymbolRule.scope = latin：`space` 只对西文内容生效，中文旁与符号旁一律贴紧',
			},
			{
				id: 'symbol.ampersand',
				name: '`&` 与前后内容之间留一格（正文里只与西文内容留）',
				spec: { path: S.commonSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/symbols.ts', symbols: ['SYMBOL_RULES'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'symbol.dollar-inside',
				name: '`$` 内侧永远不空（Obsidian 能否认出公式的前提）',
				spec: { path: S.commonSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingMathText'],
				impl: {
					file: 'src/text/inline-scan.ts',
					symbols: ['readInlineMath'],
				},
				tests: ['test/spacing.test.ts', 'test/latex-layout.test.ts'],
				note: '识别规则只有一份（inline-scan 的 readInlineMath），公式排版 latex.ts 判断行内公式收尾也用它 —— 2026-09 收敛后不再各写一份',
			},
			{
				id: 'symbol.modifier',
				name: '修饰符号不加空格（`^`、单独一个 `|`）',
				spec: { path: S.commonSymbol, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/symbols.ts',
					symbols: ['SYMBOL_RULES', 'STANDALONE_PIPE_RULE'],
				},
				tests: ['test/spacing.test.ts'],
				note: '包裹符号（`()`、`||`、引号）归在「通用符号 3」的包裹符号子条目下，见 punct.bracket、punct.quote 与 punct.package',
			},
			{
				id: 'symbol.relation',
				name: '运算 / 关系符号与前后内容之间加空格（`→`）',
				spec: { path: S.commonSymbol, item: 4 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['RELATION_COMMANDS', 'RELATION_CHARS', 'separator'],
				},
				tests: ['test/spacing.test.ts', 'test/latex-layout.test.ts'],
			},
			{
				id: 'symbol.spacing-command',
				name: '空格符号看作空格，与前后相连（`x\\, dr`）',
				spec: { path: S.commonSymbol, item: 5 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['SPACING_COMMANDS', 'SINGLE_SPACING_COMMANDS', 'isSpacingOnly', 'splitGluedSpacing'],
				},
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'symbol.no-rule',
				name: '符号表里没有的符号一律不动（`~`、`-` 连字符）',
				spec: { path: S.commonSymbol, item: 6 },
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
				note: '规范第 6、7 条要求 `~`、`-` 两边不加空格，实现方式是**故意不进符号表**（见 symbols.ts 表后的说明）：既不添空格，也不删作者写的空格 —— `甲 ~ 乙` 与 `甲~乙` 都原样保留（`约 ~5 个` 里少掉的那一格来自"中文 ↔ 数字"规则，与 `~` 无关）。排版不替作者补他没写的东西，也不删他写的东西',
			},
		],
	},
	{
		heading: '排版格式 · 文字与数字',
		rules: [
			{
				id: 'text.cjk-latin',
				name: '中文 ↔ 英文之间空一个字宽',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingCjkLatin'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
				note: '行内代码、双链、链接、标签与英文等价（标记命名 10）',
			},
			{
				id: 'text.cjk-digit',
				name: '中文 ↔ 数字之间不留空格（`第 3 章` → `第3章`）',
				spec: { path: S.digit, item: 2 },
				status: 'done',
				switchKeys: ['spacingCjkDigit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.latin-digit',
				name: '英文 ↔ 数字之间：默认保持原样（专有名词优先）',
				spec: { path: S.digit, item: 3 },
				status: 'done',
				switchKeys: ['spacingLatinDigit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.math-gap',
				name: '行内公式 ↔ 文字之间空一格（只动 `$` 外面）',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingMathText'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.digit-unit',
				name: '数字 ↔ 单位之间空一格（单位须在词表里）',
				spec: { path: S.mathSymbol, item: 2 },
				status: 'done',
				switchKeys: ['spacingDigitUnit'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['UNITS', 'decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
			{
				id: 'text.proper-noun',
				name: '专有名词的空格以原有形式为准（《新 吊带袜天使》）',
				spec: { path: S.textGeneral, item: 4 },
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['markTitlePieces'],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts'],
				note: '中文与中文之间的空格不动；书名号与引号内部的字符一个都不动（math-wrap.ts 的 protectTitles 同理）',
			},
			{
				id: 'text.english-word',
				name: '带其他符号的英文词按单词整体处理（`GPT4`、`v1.2.2`）',
				spec: { path: S.textGeneral, item: 1 },
				status: 'done',
				switchKeys: ['spacingCjkLatin'],
				impl: {
					file: 'src/text/spacing/tokenize.ts',
					symbols: ['markAlphanumericWords', 'markAbbreviationPieces'],
				},
				tests: ['test/spacing.test.ts'],
				note: '原来对着 `文字格式 / 英文` 第 1 条；2026-09 规范把「英文」那一节整节删了（内容并在 `文字格式 / 概论` 第 1 条：「中英文和数字、符号等混用作专有名词，视为一个整体」），出处跟着挪过去',
			},
			{
				id: 'text.chapter-title',
				name: '章节 / 课次 / 附录这类标题标记与标题内容之间空一格（`第一章矩阵` → `第一章 矩阵`）',
				spec: { path: S.textChinese, item: 1 },
				status: 'done',
				switchKeys: ['spacingChapterTitle'],
				impl: {
					file: 'src/text/chapter-title.ts',
					symbols: ['chapterMarkers', 'chapterGap', 'appendixLabelPiece'],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts'],
				note: '认两种标记：`第` + 序号 + 章 / 课 / 节 / 讲 / 篇、`附录` + 序号（`附录A` `附录1` `附录一`；**序号必填** —— `附录矩阵的证明` 这种不写序号的标题认不出来，因为「附录里的内容」这类普通句子与它没有区别）。判定只有 chapter-title.ts 一份：分词器按 chapterMarkers 把标记与内容切成两块（中文本来连成一段切不开）再由空格判定补那一格；智能公式（math-wrap.ts）也得先用它把那一格补上，否则 `附录A矩阵` 里的 `A` 会先被包成 `$A$`，标记不再相连、这条规则就再也认不出来。标记后面是标点（`第一章、矩阵`）或连接词（`第一章的用法`）、或标记后面没有内容（整行只有 `第一章`）时不补',
			},
			{
				id: 'text.use-space-sparingly',
				name: '不要滥用空格：空格只用来分隔不同语言的内容',
				spec: { path: S.punctGeneral, item: 3 },
				status: 'done',
				switchKeys: ['spacingSymbolPad'],
				impl: { file: 'src/text/spacing/gap.ts', symbols: ['decideGap'] },
				tests: ['test/spacing.test.ts'],
			},
		],
	},
	{
		heading: '排版格式 · 结构与顺序',
		rules: [
			{
				id: 'structure.tag-placement',
				name: '标签归位：写到内容最后，与正文空一格',
				spec: { path: S.tag, item: 1 },
				status: 'done',
				switchKeys: ['tagLayout'],
				impl: { file: 'src/text/tags.ts', symbols: ['formatTags', 'layoutBlock', 'stripTags'] },
				tests: ['test/tags.test.ts'],
			},
			{
				id: 'structure.tag-sort',
				name: '同一处的多个标签按首字母排序',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: ['tagSort'],
				impl: { file: 'src/text/tags.ts', symbols: ['orderTags'] },
				tests: ['test/tags.test.ts'],
			},
			{
				id: 'structure.block-sort',
				name: '内容板块按首字母排序（只在同类相邻块之间）',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: ['blockSort'],
				impl: { file: 'src/text/block-sort.ts', symbols: ['sortContentBlocks'] },
				tests: ['test/block-sort.test.ts'],
			},
			{
				id: 'structure.collate',
				name: '首字母比较：中文按拼音、数字按数值、大小写与全半角不敏感',
				spec: { path: S.general, item: 4 },
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/collate.ts', symbols: ['compareByFirstLetter'] },
				tests: ['test/tags.test.ts', 'test/block-sort.test.ts'],
			},
			{
				id: 'structure.indent',
				name: '行首缩进归一：4 个空格算一个 tab，零散空格删掉',
				spec: { path: S.commonSymbol, item: 1 },
				status: 'done',
				switchKeys: ['textLeadingIndentFix'],
				impl: { file: 'src/text/indent.ts', symbols: ['fixLeadingIndent', 'resolveLeadingIndentMode'] },
				tests: ['test/text-layout.test.ts'],
				note: '规范「通用符号 1」只定了 tab 的宽度（一个 tab 4 个字宽），"哪些空格删、列表子项保留、标记空白"是实现约定（另见 structure.markers）。`off` 同时是整块文本排版的总开关',
			},
			{
				id: 'structure.markers',
				name: '块级标记空白：引用 `>` 后补空格、列表与标题符号后的多个空格收成一个',
				spec: null,
				status: 'done',
				switchKeys: ['textLeadingIndentFix'],
				impl: { file: 'src/text/markers.ts', symbols: ['fixBlockMarkers'] },
				tests: ['test/markdown-markers.test.ts'],
				note: '原来对着 `命名 / 标记命名` 第 15 条；2026-09 规范重排后那一节整节删掉了（规范里现在只剩 `格式 / markdown 格式` 的"列表支持缩进"一条），这条改成实现约定：引用 `>` 后补一格、列表与标题符号后的多个空格收成一个',
			},
			{
				id: 'structure.list-number',
				name: '列表序号整理：保证每个列表的首项编号是 1',
				spec: null,
				status: 'done',
				switchKeys: ['listRenumber'],
				impl: { file: 'src/text/list-numbering.ts', symbols: ['fixListNumbers'] },
				tests: ['test/list-numbering.test.ts'],
				note: '规范里没有"序号从 1 开始"这一条；相关的是 数字格式 第 1 条（需要用几位数字就占几位）—— 实现照此不加前导零。首项已经是 1 的列表一律不动（`1. 1. 1.`、`1. 5. 9.` 都是作者故意写的形态，block-sort.ts 的编号整理也保留这两种）',
			},
			{
				id: 'structure.heading-level',
				name: '标题级别整理：子标题与父标题恰好差一级',
				spec: null,
				status: 'done',
				switchKeys: ['headingLevelFix'],
				impl: { file: 'src/text/heading-levels.ts', symbols: ['fixHeadingLevels'] },
				tests: ['test/heading-levels.test.ts'],
				note: '规范里没有"父子标题差一级"这一条；相关的是 模板 / 内容模板应用 / 标题分级 第 1 条（引用其他笔记的标题内容时要额外写一个相同的标题防止分级错误）—— 所以首个标题的级别保持原样，只压缩父子之间的跳级。新级别全部从原始级别一次算出，多个标题同时改时不会互相串',
			},
			{
				id: 'structure.chat-log',
				name: '聊天记录排版：头部信息与正文缩进、图文顺序、消息间空行',
				spec: null,
				status: 'done',
				switchKeys: [
					'chatShowUsername', 'chatShowDate', 'chatShowTime',
					'chatIndent', 'chatImageOrder', 'chatBlankLineBetweenMessages',
				],
				impl: { file: 'src/text/chat-log.ts', symbols: ['formatChatLog', 'resolveIndent'] },
				tests: ['test/chat-log.test.ts'],
				note: '规范里没有对应条目；必须严格幂等（重复执行不能再产生空行或空格变化）',
			},
		],
	},
	{
		heading: '代码格式 · 公式',
		rules: [
			{
				id: 'math.latex-only',
				name: '公式和符号都用 latex 语法打（正文数学符号自动包 `$…$`）',
				spec: { path: S.code, item: 4 },
				status: 'done',
				switchKeys: ['textMathWrapSymbols'],
				impl: {
					file: 'src/text/math-wrap.ts',
					symbols: ['wrapPlainMath', 'mathStretches', 'isMathLike', 'isMathContext', 'hasTightOperator', 'isPrefixOperator', 'renderStretch'],
				},
				tests: ['test/text-math.test.ts', 'test/text-pipeline.test.ts'],
				note: '规范只写了"用 latex 语法打"；判定规则（数学语境词、量词、变量表、专有名词与缩写排除、运算符必须留空格）是实现补充，见模块头注释。运算符一条按数学符号 1「运算符号和状态符号前后都要加空格（如果不是数学语境就不加，比如快捷键 ctrl+c）」：**只认写成规范形态的算式** —— 二元运算符两侧各留一格才包（`x = 0`、`x - 1`、`a + b`），紧贴的一律不认（`x=0`、`a+b+c`、`5/10mm`、`A-7`、`F-22`、`cd /d`、`x -1`），因为那可能是作者故意写的编号 / 连字符 / 命令，或他就是在正文里省了空格 —— 排版不猜。正负号是修饰符号（数学符号 3：前后没有空格），`x = -1`、`f(-1)` 不在此列（与公式排版的 math.unary 同一个判断）',
			},
			{
				id: 'math.space-equals-render',
				name: '代码里的空格 = 公式渲染出来的空格（只在 `\\\\` 处换行）',
				spec: { path: S.code, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['tokenize', 'separator', 'renderTokens'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.brace',
				name: '拼接会吃掉命令名时补花括号（`\\delta x` → `\\delta{x}`）',
				spec: { path: S.code, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['needsBrace'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.indent',
				name: '公式代码不额外缩进；续行缩进 = 首行缩进 + 1 个 tab',
				spec: { path: S.formulaCode, item: 1 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: {
					file: 'src/text/latex.ts',
					symbols: ['leadingWhitespace', 'formatDisplayBlocks'],
				},
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.big-operator',
				name: '大型运算符（`\\begin{}` / `\\end{}`）连环境名当一个整体，前后不加空格',
				spec: { path: S.formulaCode, item: 2 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['tokenize', 'separator'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.unary',
				name: '正负号等修饰符号前后没有空格（一元 / 二元按上下文判断）',
				spec: { path: S.mathSymbol, item: 3 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['isUnary', 'SIGN_CHARS'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.relation-gap',
				name: '公式里运算符号 / 关系符号前后加空格，列举逗号后加空格',
				spec: { path: S.mathSymbol, item: 1 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['separator', 'RELATION_COMMANDS'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.math-mode-text',
				name: '公式里裸写的中文包进 `\\text{…}`',
				spec: { path: S.code, item: 4 },
				status: 'done',
				switchKeys: ['mathLayout'],
				impl: { file: 'src/text/latex.ts', symbols: ['wrapMathText', 'FULL_WIDTH_RE'] },
				tests: ['test/latex-layout.test.ts'],
			},
			{
				id: 'math.derivative-space',
				name: '微分算子前加薄空格（`f(x)\\, dr`）',
				spec: { path: S.mathSymbol, item: 3 },
				status: 'spec-only',
				switchKeys: [],
				impl: { file: 'src/text/latex.ts', symbols: ['SINGLE_SPACING_COMMANDS'] },
				tests: ['test/latex-layout.test.ts'],
				note: '代码只保留作者自己写好的 `\\,`（当普通间距命令处理），**不自动补**：微分算子是写法问题，排版不该替作者补他没写的内容（2026-09 明确决定，别再"补全"）。规范重排后「数学符号」只剩三条，这条从原来的第 5 条挪到第 3 条',
			},
		],
	},
	{
		heading: '横切机制',
		rules: [
			{
				id: 'cross.protect-lines',
				name: '整行保护区：frontmatter、围栏 / 缩进代码块、GFM 表格',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/line-scan.ts',
					symbols: ['markProtectedLines', 'markIndentedCodeLines', 'markTableLines', 'inlineCodeRanges'],
				},
				tests: ['test/spacing.test.ts', 'test/tags.test.ts', 'test/block-sort.test.ts', 'test/latex-layout.test.ts'],
				note: '规范里没写，但改坏代码块是排版类功能最大的风险。表格行是"对齐用空格"的家：空格排版与列表序号整行跳过；公式排版按**单元格**处理 —— 一对 `$` 跨过单元格分隔符 `|` 就不认（作者少打一个 `$` 时，配出来的"公式"会把填充空格压掉、整行对齐散掉），同一个单元格里的 `$…$` 照常排版',
			},
			{
				id: 'cross.protect-inline',
				name: '行内保护区：行内代码、双链与链接、链接与地址（URL / 邮箱 / 裸域名 / 主机端口）、HTML 标签与实体、注释、标签',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/inline-scan.ts',
					symbols: [
						'collectMaskedRanges', 'isSpaceChar',
						'SLASH_SCHEME_RE', 'OPAQUE_SCHEME_RE', 'EMAIL_RE', 'HOST_RE', 'HOST_PORT_RE', 'HTML_ENTITY_RE',
					],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts'],
				note: '链接与地址整段当一个"英文单词"，里面一个字符都不动。以前只认 `http(s)://` `file://` `obsidian://` 三种写法，于是**磁力链接**（`magnet:?xt=urn:btih:…`，没有 `//`）被当成正文排版：`magnet:? xt=urn: btih:`、`&` 两边各补一格、百分号里的 `10bit` 被"数字 ↔ 单位"拆成 `10 bit` —— 2026-09 全库实测报的 bug。同一条毛病一起收进来：`ed2k://|file|…`（scheme 不在白名单）、`data:` / `mailto:` / `tel:`（没有 `//`）、裸域名 `www.example.com/x?y=1`、`localhost:8080`、文件名 `main.ts`（旧版会排成 `main. ts`）、HTML 实体 `&nbsp;`（分号被换成 `；`）',
			},
			{
				id: 'cross.math-recognition',
				name: '`$$…$$` 区块与行内 `$…$` 的识别与配对',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: {
					file: 'src/text/inline-scan.ts',
					symbols: ['readInlineMath', 'dollarPositions', 'dollarMarks', 'mathRanges', 'mathOpaqueLines'],
				},
				tests: ['test/spacing.test.ts', 'test/text-math.test.ts', 'test/tags.test.ts'],
				note: '识别与配对**只有这一份实现**（2026-09 收敛）：行内 `$…$` 用 readInlineMath、`$$` 位置用 dollarPositions、按行配对用 mathRanges，行级消费者（标签排版、板块排序）问"这行能不能碰"就用 mathOpaqueLines。以前散着 6 份（还有 line-scan.markMathLines 与 latex.ts 的 collectMarks / findInlineMathEnd），其中两套配对算法对"一行内成对 `$$…$$`"给出不同答案 —— 标签排版当整行保护区、空格排版当整行可排版，于是含公式行上的标签不归位。现在两种问法同源：跨行区块的行与起止行整行跳过，一行内成对的行照常排版',
			},
			{
				id: 'cross.pipeline',
				name: '流水线顺序与不动点迭代：每步幂等，只在真正变化时写盘',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/text/pipeline.ts', symbols: ['formatNoteText'] },
				tests: ['test/text-pipeline.test.ts'],
				note: '顺序理由写在 pipeline.ts 头部；整条链迭代到不动点（最多 5 轮），因为后面的步骤会改前面的步骤看过的文本',
			},
			{
				id: 'cross.batch',
				name: '批量外壳：互斥锁 + 通知屏蔽 + 状态栏进度，单篇失败不拖垮整批',
				spec: null,
				status: 'done',
				switchKeys: [],
				impl: { file: 'src/batch.ts', symbols: ['BatchRunner'] },
				tests: ['test/commands.test.ts'],
			},
		],
	},
];

/** 平面化：所有规则（测试与文档都按这个顺序） */
export const ALL_RULES: RuleRecord[] = RULE_SECTIONS.flatMap(section => section.rules);

/** 生成 `docs/规则登记表.md` 的内容（纯函数，测试与生成器共用一份） */
export function renderRuleRegistryDoc(): string {
	const lines: string[] = [
		'# 规则登记表',
		'',
		'> 本文件由 `src/rule-registry.ts` 生成，**请勿手改**。',
		'>',
		'> 重新生成：`node test/run-tests.mjs --update-rules-doc`（`npm test` 会核对它与表是否一致）。',
		'>',
		'> 规范出处指 vault 里的 `data/data note/data note.md`；改规范或改实现时，先改 `src/rule-registry.ts`，再重新生成这份文档。',
		'',
		'状态：`done` 有实现且与规范一致 · `partial` 实现了但有已知偏差 · `spec-only` 规范里有、代码里没有。',
		'',
	];

	for (const section of RULE_SECTIONS) {
		lines.push(`## ${section.heading}`, '');
		lines.push('| ID | 规则 | 规范出处 | 状态 | 开关 | 实现 | 测试 |');
		lines.push('| --- | --- | --- | --- | --- | --- | --- |');
		for (const rule of section.rules) {
			const spec = rule.spec ? `${rule.spec.path} · 第 ${rule.spec.item} 条` : '—';
			const impl = `\`${rule.impl.file}\`<br>${rule.impl.symbols.map(symbol => `\`${symbol}\``).join(' ')}`;
			const tests = rule.tests.length > 0 ? rule.tests.map(test => `\`${test}\``).join('<br>') : '—';
			lines.push(`| \`${rule.id}\` | ${rule.name} | ${spec} | ${rule.status} | ${rule.switchKeys.length > 0 ? rule.switchKeys.map(key => `\`${key}\``).join(' ') : '—'} | ${impl} | ${tests} |`);
		}
		lines.push('');

		const noted = section.rules.filter(rule => rule.note);
		if (noted.length > 0) {
			lines.push('备注：', '');
			for (const rule of noted) {
				lines.push(`- \`${rule.id}\`：${rule.note}`);
			}
			lines.push('');
		}
	}

	return lines.join('\n');
}
