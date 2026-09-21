import type { FieldSection } from './types';

/**
 * 图片相关与代码格式的设置项（面板上部三节）。
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
];
