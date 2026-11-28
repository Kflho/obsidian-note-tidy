import type { FieldSection } from './types';

/**
 * 「菜单与交互」一页：与笔记内容无关、只与「入口在界面的哪个位置」有关的设置。
 *
 * 分两组：**入口**（右键菜单中显示本插件的哪些项、隐藏其他插件的哪些项）
 * 与**快捷键 / 状态栏**（Ctrl+C 接管、选中内容的图片数量）。
 */

export const INTERFACE_SECTION: FieldSection = {
	type: 'page',
	heading: '菜单与交互',
	desc: '右键菜单、复制快捷键与状态栏。',
	groups: [
		{
			heading: '右键菜单项',
			fields: [
				{
					key: 'imageMenuCopyItem',
					name: '「复制图片」',
					desc: '显示在图片菜单与笔记菜单中。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuQuickSizeItem',
					name: '「快速设置图片大小」',
					desc: '显示在图片菜单与笔记菜单中。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuQuickFixItem',
					name: '「快速修复聊天记录」',
					desc: '显示在图片菜单与笔记菜单中。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuTypesetItem',
					name: '「排版选中内容」',
					desc: '有选区时出现在笔记菜单中。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'noteMenuPasteChatItem',
					name: '「粘贴为聊天记录」',
					desc: 'Ctrl+V 粘贴纯内容，此菜单项粘贴完整格式。',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuManageItem',
					name: '「管理右键菜单」',
					desc: '显示在图片、笔记、文件三个右键菜单中。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'fileMenuImageSubmenu',
					name: '「图片功能」二级栏',
					desc: '文件与文件夹菜单中的入口。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'fileMenuTextSubmenu',
					name: '「文本排版」二级栏',
					desc: '文件与文件夹菜单中的入口。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'menuHiddenItems',
					name: '隐藏的菜单项',
					desc: '每行一条「菜单：项目名」；留空表示不隐藏任何项。',
					control: { type: 'textarea', placeholder: '每行一项，例如：\n图片：另存为图片…\n笔记：复制\n文件夹：在系统中显示', rows: 5 },
				},
			],
		},
		{
			heading: '复制与状态栏',
			fields: [
				{
					key: 'takeOverCopyShortcut',
					name: 'Ctrl+C 优先复制图片',
					desc: '选中图片时按 Ctrl+C 复制图片文件，而不是链接文字。默认关闭。',
					control: { type: 'toggle' },
				},
				{
					key: 'showSelectionImageCount',
					name: '状态栏显示选中图片数量',
					desc: '选中内容变化时更新，没有图片时留空。默认关闭。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
