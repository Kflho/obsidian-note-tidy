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
				key: 'imageMenuManageItem',
				name: '「管理右键菜单」菜单项',
				desc: '在图片、笔记与文件夹的右键菜单中加入「管理右键菜单…（Note Tidy）」，用于查看菜单中的项目并控制显示',
				control: { type: 'toggle' },
			},
			{
				key: 'fileMenuImageSubmenu',
				name: '「图片功能」二级栏',
				desc: '在文件或文件夹的右键菜单中加入「图片功能」：转换外部图片、重命名乱码图片、按预设重命名、整理图片位置、设置图片大小',
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
