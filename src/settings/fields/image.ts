import type { FieldSection } from './types';

/**
 * 「图片」一页：所有跟图片文件有关的设置（收进仓库、命名、转格式、大小、一键整理）。
 *
 * 分组顺序 = 图片的**一生**：落在哪儿 → 叫什么 → 转成什么格式 → 粘进来的怎么处理 →
 * 显示多大 → 整理时顺手做什么。加一条图片设置时，先问"它属于哪一步"，再往对应的组里放，
 * 别在页面顶部堆成一长条（2026-09 用户报过"功能加多了，设置面板已经乱了"）。
 */

export const IMAGE_SECTION: FieldSection = {
	type: 'page',
	heading: '图片',
	desc: '图片的存放、命名、格式、尺寸与整理。',
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
					desc: '图片命名的格式，支持 {YYYY} {MM} {DD} {HH} {mm} {ss}。',
					control: { type: 'text', placeholder: 'Pasted image {YYYY}{MM}{DD}{HH}{mm}{ss}' },
				},
				{
					key: 'renameLinkFormat',
					name: '重命名后链接格式',
					desc: '改名后链接用完整路径还是文件名。',
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
					name: '「转换图片格式」的目标格式',
					desc: '',
					control: {
						type: 'dropdown',
						options: {
							webp: 'WEBP（推荐）',
							jpg: 'JPEG',
							png: 'PNG',
							pngquant: 'PNG（pngquant 压缩）',
						},
					},
				},
				{
					key: 'convertQuality',
					name: '转换质量',
					desc: '填 1–100，默认 75；数值越低文件越小、画质越差。',
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
					desc: '留空时按 PATH 与常见安装位置查找；找不到就保持原格式。',
					control: { type: 'text', placeholder: '留空＝自动找（或填 D:\\tools\\pngquant\\pngquant.exe）' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'pngquantQuality',
					name: 'pngquant 质量档',
					desc: '填质量范围，默认 65-80；范围越窄压缩越轻。',
					control: { type: 'text', placeholder: '65-80' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'convertImportedImages',
					name: '导入的图片转成目标格式',
					desc: '默认开；收进仓库的图片会按「目标格式」转码。',
					control: { type: 'toggle' },
				},
				{
					key: 'tidyConvertFormat',
					name: '整理时转换图片格式',
					desc: '默认开；整理时只改图片格式，文件名和链接保持原样。',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '粘贴',
			fields: [
				{
					key: 'takeOverImagePaste',
					name: '接管图片粘贴',
					desc: '默认开；一次粘多张时逐张保存，避免并发撞名丢图。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoTransferImagesOnPaste',
					name: '自动收图',
					desc: '默认开；粘贴后把外部图片复制进仓库并改成内部链接。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoFixChatLogOnPaste',
					name: '自动排版聊天记录',
					desc: '默认开；只排版这一次粘贴的内容。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoSetImageSizeOnPaste',
					name: '自动套用默认尺寸',
					desc: '默认开；只对刚粘贴的图片生效，撤销一次即可回退。',
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
					desc: '填图片宽度（像素），默认 100；留空则不加尺寸限制。',
					control: { type: 'text', placeholder: '100' },
				},
				{
					key: 'imageSizeHeight',
					name: '默认高度',
					desc: '填图片高度（像素）；留空时高度由宽度按比例算出。',
					control: { type: 'text', placeholder: '留空' },
				},
				{
					key: 'imageSizeOverwrite',
					name: '覆盖已有尺寸',
					desc: '默认开；已有的 |宽度 也会被改成「默认宽度」「默认高度」的值。',
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
					desc: '默认开；点击图标整理整个仓库的图片。',
					control: { type: 'toggle' },
				},
				{
					key: 'autoClearUnusedImages',
					name: '整理时清理没人引用的附件',
					desc: '默认开；只清理没有任何笔记引用的附件。',
					control: { type: 'toggle' },
				},
			],
		},
	],
};
