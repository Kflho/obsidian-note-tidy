import type { FieldSection } from './types';

/**
 * 「图片」一页：所有与图片文件有关的设置（导入、命名、格式转换、大小、一键整理）。
 *
 * 分组顺序按图片的处理流程排列：保存在哪里 → 如何命名 → 转换成什么格式 → 粘贴时如何处理 →
 * 显示多大 → 整理时同时做什么。新增图片设置时，先判断它属于哪一步，再放入对应的组，
 * 不要在页面顶部堆成一长条。
 */

export const IMAGE_SECTION: FieldSection = {
	type: 'page',
	heading: '图片',
	desc: '图片的导入、命名、格式转换、大小与整理。',
	groups: [
		{
			heading: '附件与命名',
			fields: [
				{
					key: 'attachmentLocation',
					name: '附件存储位置',
					control: {
						type: 'dropdown',
						options: {
							system: '跟随系统设置（默认）',
							root: '仓库根目录',
							current: '当前文件所在文件夹',
							subfolder: '当前文件所在文件夹下的子文件夹',
							custom: '指定的附件文件夹',
						},
					},
					rerenderOnChange: true,
				},
				{
					key: 'customAttachmentFolder',
					name: '附件文件夹名称',
					desc: '「子文件夹」与「指定的附件文件夹」使用的名称。',
					control: { type: 'text', placeholder: 'Attachments' },
					visible: (settings) => settings.attachmentLocation === 'subfolder'
						|| settings.attachmentLocation === 'custom',
				},
				{
					key: 'imageNamePreset',
					name: '图片命名预设',
					desc: '图片重命名时使用的格式，支持 {YYYY}、{MM}、{DD}、{HH}、{mm}、{ss}。',
					control: { type: 'text', placeholder: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}' },
				},
				{
					key: 'renameLinkFormat',
					name: '重命名后的链接格式',
					desc: '重命名后链接写完整路径或仅写文件名。',
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
			heading: '格式转换',
			fields: [
				{
					key: 'vaultConvertFormat',
					name: '图片格式转换的目标格式',
					desc: '两条格式转换命令与「整理图片」都使用这个格式。',
					control: {
						type: 'dropdown',
						options: {
							webp: 'WebP（推荐）',
							jpg: 'JPEG',
							png: 'PNG',
							pngquant: 'PNG（pngquant 压缩）',
						},
					},
				},
				{
					key: 'convertQuality',
					name: '转换质量',
					desc: '填 1–100，默认 75。数值越低，文件越小，图像质量越低。',
					control: { type: 'text', placeholder: '75' },
					coerce: (value) => {
						const num = Number(typeof value === 'string' ? value.trim() : NaN);
						if (!Number.isFinite(num)) return '75';
						return String(Math.min(100, Math.max(1, Math.round(num))));
					},
				},
				{
					key: 'pngquantPath',
					name: 'pngquant 可执行文件路径',
					desc: '留空时按系统 PATH 与常见安装位置查找；找不到时保留原格式。',
					control: { type: 'text', placeholder: '留空时自动查找' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'pngquantQuality',
					name: 'pngquant 质量档',
					desc: '填质量范围，默认 65-80。范围越窄，压缩越轻。',
					control: { type: 'text', placeholder: '65-80' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'convertImportedImages',
					name: '导入的图片转成目标格式',
					desc: '转换在写入仓库前完成；无法解码时保留原格式。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'tidyConvertFormat',
					name: '整理时转换图片格式',
					desc: '整理图片时转换格式，文件名与链接保持不变。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '粘贴',
			fields: [
				{
					key: 'takeOverImagePaste',
					name: '粘贴图片时逐张保存',
					desc: '粘贴图片时由本插件逐张保存并生成链接。默认开启；关闭后由 Obsidian 或其他插件处理。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoTransferImagesOnPaste',
					name: '自动导入外部图片',
					desc: '粘贴后把外部路径图片复制进仓库并改为内部链接。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoFixChatLogOnPaste',
					name: '自动排版聊天记录',
					desc: '粘贴后只排版本次粘贴的内容。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoSetImageSizeOnPaste',
					name: '自动套用默认尺寸',
					desc: '粘贴后为图片套用默认宽度与高度。只处理本次粘贴的内容，撤销一次即可回退。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '图片大小',
			fields: [
				{
					key: 'imageSizeWidth',
					name: '默认宽度',
					desc: '图片宽度（像素），默认 100；留空时不限制宽度。',
					control: { type: 'text', placeholder: '100' },
				},
				{
					key: 'imageSizeHeight',
					name: '默认高度',
					desc: '图片高度（像素）；留空时按宽度等比缩放。',
					control: { type: 'text', placeholder: '留空' },
				},
				{
					key: 'imageSizeOverwrite',
					name: '覆盖已有尺寸',
					desc: '开启后已有尺寸也会改为默认宽度与高度。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '一键整理',
			fields: [
				{
					key: 'tidyImagesRibbonIcon',
					name: '左侧栏图标',
					desc: '在左侧栏显示「整理图片」图标。默认开启。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoClearUnusedImages',
					name: '整理时清理未引用的图片',
					desc: '整理图片时清理笔记与 canvas 都没有引用的图片。默认开启。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
