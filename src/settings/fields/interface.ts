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
	desc: '右键菜单、复制快捷键与状态栏。',
	groups: [
		{
			heading: '右键菜单项',
			fields: [
				{
					key: 'imageMenuCopyItem',
					name: '「复制图片」',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuQuickSizeItem',
					name: '「快速设置图片大小」',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuQuickFixItem',
					name: '「快速修复聊天记录」',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuTypesetItem',
					name: '「排版选中内容」',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'imageMenuManageItem',
					name: '「管理右键菜单」',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'fileMenuImageSubmenu',
					name: '「图片功能」二级栏',
					desc: '',
					control: { type: 'toggle' },
				},
				{
					key: 'fileMenuTextSubmenu',
					name: '「文本排版」二级栏',
					desc: '',
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
					name: '「Ctrl+C」优先复制图片',
					desc: '默认关；开启后选中图片按 Ctrl+C 复制文件，而不是复制文字。',
					control: { type: 'toggle' },
				},
				{
					key: 'showSelectionImageCount',
					name: '显示选中内容的图片数量',
					desc: '默认关；勾选后在状态栏报出选中的张数。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
