import type { FieldSection } from './types';

/**
 * 「菜单与交互」一页：跟笔记内容无关、只跟"界面在哪儿给你入口"有关的设置。
 *
 * 分两组：**入口**（右键菜单里放我们哪些项、藏掉别人哪些项）与**快捷键 / 状态栏**
 * （Ctrl+C 接管、选区图片张数）。以前这三节（状态栏 / 右键菜单 / 复制）平铺在设置面板顶层，
 * 夹在图片与排版中间，找起来要来回扫 —— 2026-09 收进这一页。
 */

export const INTERFACE_SECTION: FieldSection = {
	type: 'page',
	heading: '菜单与交互',
	desc: '右键菜单里显示哪些项、`Ctrl+C` 怎么走、状态栏显示什么',
	groups: [
		{
			heading: '右键菜单项',
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
			heading: '复制与状态栏',
			fields: [
				{
					key: 'takeOverCopyShortcut',
					name: '「Ctrl+C」优先复制图片',
					desc: '开启后，在笔记里按 Ctrl+C（macOS 上是 ⌘C）时，如果光标处或选中内容里有图片，复制的就是图片文件本身 —— 可以粘贴到文件夹或聊天窗口，而不是粘贴出 ![[图片]] 链接文字。选中内容里还有文字时，文字会一起复制（聊天窗口里贴出来是图文混排；这种复制不含文件，要粘文件请只选图片）。选中内容里没有图片时，与平时完全一样',
					control: { type: 'toggle' },
				},
				{
					key: 'showSelectionImageCount',
					name: '显示选中内容的图片数量',
					desc: '在编辑器里选中文字时，右下角状态栏显示其中包含的图片张数。只统计嵌入的图片（![[图.png]] 与 ![说明](图.png)）；代码块和行内代码中的链接不计入，没有选中内容或选中内容中没有图片时不显示',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
