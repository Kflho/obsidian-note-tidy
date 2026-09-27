import type { FieldSection } from './types';

/**
 * 图片相关、代码格式与状态栏的设置项（面板上部几节）。
 * 字段顺序 = 面板上的显示顺序。
 */

export const IMAGE_SECTIONS: FieldSection[] = [
	{
		type: 'group',
		heading: '图片导入',
		fields: [
			{
				key: 'attachmentLocation',
				name: '附件存储位置',
				control: {
					type: 'dropdown',
					options: {
						system: '跟随系统设置 (默认)',
						root: '仓库的根目录',
						current: '当前文件所在的文件夹',
						subfolder: '当前文件所在文件夹下指定的子文件夹',
						custom: '指定的附件文件夹',
					},
				},
				rerenderOnChange: true,
			},
			{
				key: 'customAttachmentFolder',
				name: '附件文件夹名称',
				control: { type: 'text', placeholder: 'Attachments' },
				visible: (settings) => settings.attachmentLocation === 'subfolder'
					|| settings.attachmentLocation === 'custom',
			},
			{
				key: 'imageNamePreset',
				name: '图片命名预设',
				desc: '支持占位符: {YYYY} {MM} {DD} {HH} {mm} {ss}',
				control: { type: 'text', placeholder: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}' },
			},
			{
				key: 'renameLinkFormat',
				name: '重命名后链接格式',
				desc: '控制图片重命名后，笔记内链接使用完整路径还是仅文件名',
				control: {
					type: 'dropdown',
					options: {
						full: '完整路径',
						filename: '仅文件名',
					},
				},
			},
			{
				key: 'vaultConvertFormat',
				name: '「转换图片格式」的目标格式',
				desc: '命令「把整个仓库 / 当前笔记的图片转换为指定格式」按它决定转成什么，「整理图片」开着「整理时转换图片格式」时也用这一项。转码用的是插件自带的编码器（浏览器 canvas），不依赖别的插件；动图（gif）与已经是目标格式的图片一律跳过，转换后扩展名会变（如 png → webp），链接由 Obsidian 自己更新',
				control: {
					type: 'dropdown',
					options: {
						webp: 'WEBP（推荐）',
						jpg: 'JPEG',
						png: 'PNG',
					},
				},
			},
			{
				key: 'convertQuality',
				name: '转换质量',
				desc: '1–100，默认 75。JPEG / WEBP 用它决定压缩程度（PNG 无损，忽略这一项）。调低省空间、小字更容易糊',
				control: { type: 'text', placeholder: '75' },
				coerce: (value) => {
					const num = Number(typeof value === 'string' ? value.trim() : NaN);
					if (!Number.isFinite(num)) return '75';
					return String(Math.min(100, Math.max(1, Math.round(num))));
				},
			},
			{
				key: 'convertImportedImages',
				name: '导入的图片转成目标格式',
				desc: '把收进仓库的外部图片顺手转成上面的目标格式（例如 png/jpg → webp），链接直接写成转换后的文件名。转码用插件自带的编码器，不依赖别的插件；解不开的格式（HEIC / TIFF 这类）与转完更大的图片按原格式导入，不影响图片进库',
				control: { type: 'toggle' },
			},
			{
				key: 'takeOverImagePaste',
				name: '粘贴图片由本插件接管',
				desc: '在编辑器里粘贴图片文件时，由本插件自己存进仓库（一张一张、名字不撞、顺手转成目标格式）并写好链接 —— 一次粘多张也不会漏。**若你装了 Image Converter**：建议把它的「Never process filenames」填 `*`，让它的自动粘贴 / 拖放让开（那一项只关这一件事，右键 Process image 与批量功能都还在）—— 否则这次粘贴会先被它接管，本插件只能退让，并提醒你一句。关掉本项则恢复"别人家的粘贴"',
				control: { type: 'toggle' },
			},
		],
	},
	{
		type: 'group',
		heading: '图片大小',
		fields: [
			{
				key: 'imageSizeWidth',
				name: '默认宽度',
				desc: '打开设置弹窗时的默认宽度，单位为像素。宽度与高度都留空表示移除已有尺寸',
				control: { type: 'text', placeholder: '100' },
			},
			{
				key: 'imageSizeHeight',
				name: '默认高度',
				desc: '可留空，此时图片按宽度等比例缩放',
				control: { type: 'text', placeholder: '留空' },
			},
			{
				key: 'imageSizeOverwrite',
				name: '覆盖已有尺寸',
				desc: '关闭后只给还没有尺寸的图片补上，已有尺寸的图片保持不动',
				control: { type: 'toggle' },
			},
			{
				key: 'autoSetImageSizeOnPaste',
				name: '粘贴图片时自动套用默认尺寸',
				desc: '把刚粘进笔记的图片按上面的默认宽度 / 高度加上尺寸（与「快速设置图片大小」用的是同一套参数）—— 本插件自己接管的粘贴、别的插件存下的截图，以及粘贴文本里带的图片链接都算。只改刚粘进来的那一小段，笔记其余部分一个字符都不动，撤销一次即可回退；粘贴多张图时逐张处理，不会漏。宽度留空（那是"移除尺寸"模式）或尺寸填错时这一步自动跳过；粘贴进来的图片已经带着尺寸时，照上面的「覆盖已有尺寸」开关决定动不动它',
				control: { type: 'toggle' },
			},
		],
	},
	{
		type: 'group',
		heading: '图片整理',
		fields: [
			{
				key: 'tidyConvertFormat',
				name: '整理时转换图片格式',
				desc: '执行「整理图片」时，顺手把还不是目标格式的图片转成目标格式（目标格式取上面「转换图片格式」那一项，默认 webp）。转码用插件自带的编码器，不依赖别的插件；动图（gif）、已经是目标格式的图片、转完没省下空间的图片一律保持原样',
				control: { type: 'toggle' },
			},
			{
				key: 'tidyImagesRibbonIcon',
				name: '左侧栏放一个「整理图片」图标',
				desc: '在左侧栏（ribbon）加一个图标，点一下就是「整理图片」：转换图片格式 + 合并内容相同的重复副本 + 清理没人引用的附件 —— 一键完成，不再弹确认框（合并掉的是内容一模一样的副本，且进回收站可还原；格式转换按上面「转换图片格式」的目标格式）。命令面板与右键菜单里的「整理图片」入口仍会先让你确认',
				control: { type: 'toggle' },
			},
			{
				key: 'autoClearUnusedImages',
				name: '整理时清理没人引用的附件',
				desc: '执行「整理图片」时顺手清一遍"没人引用的图片"：扫描全库笔记与 canvas 里出现过的图片文件名，一张都没被提到的图片送进回收站（可还原）。只清图片，pdf、音频等其它附件一个都不碰；命令面板里还有一条单独的「清理没人引用的图片」，那一条会先让你确认',
				control: { type: 'toggle' },
			},
		],
	},
	{
		type: 'group',
		heading: '代码格式',
		fields: [
			{
				key: 'mathLayout',
				name: '公式排版',
				desc: '整理数学公式：$$…$$ 区块与行内 $…$（行内只按空格规则整理、绝不换行）。原则是"代码里的空格 = 公式渲染出来的空格"：运算 / 逻辑 / 排版符号（= + - \\le \\to \\in、&、\\\\）左右各空一格；一元正负号与 \\partial \\delta \\sin 这类命令和参数之间贴紧（会吃掉命令名时写成 \\delta{x}）；逗号前不加、后加一个空格；多余的空格与换行删掉。只在 \\\\ 处换行，续行缩进 = 首行缩进 + 1 个 tab；$$ 与内容之间不留空格。间距命令与后面字母粘连（\\quadA 会被 LaTeX 当成未定义命令）会拆开：前面已有逗号等分隔就删掉多余的间距，否则写成 \\quad{A}。frontmatter、代码块、\\text{…} 里的文字都不动',
				control: { type: 'toggle' },
			},
		],
	},
	{
		type: 'group',
		heading: '状态栏',
		fields: [
			{
				key: 'showSelectionImageCount',
				name: '显示选中内容的图片数量',
				desc: '在编辑器里选中文字时，右下角状态栏显示其中包含的图片张数。只统计嵌入的图片（![[图.png]] 与 ![说明](图.png)）；代码块和行内代码中的链接不计入，没有选中内容或选中内容中没有图片时不显示',
				control: { type: 'toggle' },
			},
		],
	},
	{
		type: 'group',
		heading: '右键菜单',
		fields: [
			{
				key: 'imageMenuCopyItem',
				name: '「复制图片」菜单项',
				desc: '在笔记中右键图片或图片链接时，菜单中加入「复制图片（Note Tidy）」。复制的是图片文件：可粘贴到文件夹中，也可作为图片粘贴到聊天窗口或文档；选中多张图片时按选中数量复制。选中内容里还有文字时，文字会一起复制（聊天窗口里是图文混排；这种复制不含文件，要粘文件请只选图片）',
				control: { type: 'toggle' },
			},
			{
				key: 'imageMenuQuickSizeItem',
				name: '「快速设置图片大小」菜单项',
				desc: '在笔记中右键时，菜单中加入「快速设置图片大小（Note Tidy）」。使用上面的默认宽度与高度直接改写当前笔记，不再弹出设置窗口',
				control: { type: 'toggle' },
			},
			{
				key: 'imageMenuQuickFixItem',
				name: '「快速修复聊天记录」菜单项',
				desc: '在笔记中右键时，菜单中加入「快速修复聊天记录（Note Tidy）」：把本文件里引用的外部路径图片收进仓库，并把整篇排版修一遍（空格 / 缩进 / 聊天记录 / 标签 / 公式）。相当于「转换当前笔记中的外部图片」与「修复当前笔记的排版」两步一次做完',
				control: { type: 'toggle' },
			},
			{
				key: 'imageMenuTypesetItem',
				name: '「排版选中内容」菜单项',
				desc: '在笔记正文里选中一段内容后右键，菜单中加入「排版选中内容（Note Tidy）」：只把这段内容排版修一遍（并转换选区里引用的外部路径图片），笔记其余部分一个字符都不动。整篇排版需要在"一条消息的正文到哪儿结束"上做取舍，选中一段再排版就没有这个歧义——想精确控制只排哪一段时用它',
				control: { type: 'toggle' },
			},
			{
				key: 'imageMenuManageItem',
				name: '「管理右键菜单」菜单项',
				desc: '在图片、笔记与文件夹的右键菜单中加入「管理右键菜单…（Note Tidy）」，用于查看菜单中的项目并控制显示',
				control: { type: 'toggle' },
			},
			{
				key: 'fileMenuImageSubmenu',
				name: '「图片功能」二级栏',
				desc: '在文件或文件夹的右键菜单中加入「图片功能」：转换外部图片、重命名乱码图片、按预设重命名、整理图片位置、整理图片（转换格式 + 合并重复副本 + 清理没人引用的附件）、设置图片大小',
				control: { type: 'toggle' },
			},
			{
				key: 'fileMenuTextSubmenu',
				name: '「文本排版」二级栏',
				desc: '在文件或文件夹的右键菜单中加入「文本排版」：修复笔记录入时的排版问题（空格 / 缩进 / 聊天记录 / 标签 / 公式）',
				control: { type: 'toggle' },
			},
			{
				key: 'menuHiddenItems',
				name: '隐藏的菜单项',
				desc: '每行一项，格式为「菜单：项目名称」。菜单可填 图片、笔记 或 文件夹，省略时按 图片 处理。列在这里的项目不会出现在对应菜单里；这些项目仍会列在「管理右键菜单」面板中（开关是关着的），在那里打开即可恢复，清空这一栏等于全部恢复显示。本插件添加的菜单项请改用上面的开关控制',
				control: { type: 'textarea', placeholder: '每行一项，例如：\n图片：另存为图片…\n笔记：复制\n文件夹：在系统中显示', rows: 5 },
			},
		],
	},
	{
		type: 'group',
		heading: '复制',
		fields: [
			{
				key: 'takeOverCopyShortcut',
				name: '「Ctrl+C」优先复制图片',
				desc: '开启后，在笔记里按 Ctrl+C（macOS 上是 ⌘C）时，如果光标处或选中内容里有图片，复制的就是图片文件本身 —— 可以粘贴到文件夹或聊天窗口，而不是粘贴出 ![[图片]] 链接文字。选中内容里还有文字时，文字会一起复制（聊天窗口里贴出来是图文混排；这种复制不含文件，要粘文件请只选图片）。选中内容里没有图片时，与平时完全一样',
				control: { type: 'toggle' },
			},
		],
	},
];
