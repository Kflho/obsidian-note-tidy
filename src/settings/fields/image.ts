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
	desc: '图片文件本身：落在哪儿、叫什么、转成什么格式、显示多大、整理时做什么',
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
			heading: '格式转换',
			fields: [
				{
					key: 'vaultConvertFormat',
					name: '「转换图片格式」的目标格式',
					desc: '命令「把整个仓库 / 当前笔记的图片转换为指定格式」按它决定转成什么，「整理图片」开着「整理时转换图片格式」时也用这一项。转码用的是插件自带的编码器（浏览器 canvas），不依赖别的插件；选 **PNG（pngquant）** 时改交给系统里装的 pngquant 压 PNG（有损调色板量化，专治 PNG 体积，只接 .png 源）。动图（gif）与已经是目标格式的图片一律跳过；转换后扩展名会变（如 png → webp），链接由 Obsidian 自己更新，转出来比原来大也照用',
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
					desc: '1–100，默认 75。JPEG / WEBP 用它决定压缩程度（PNG 无损、PNGQUANT 用下面那一档，都忽略它）。调低省空间、小字更容易糊；实测 70 与 75 的体积只差 2–4%，60 以下才开始明显省体积',
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
					desc: '目标格式选 **PNG（pngquant）** 时才用。**留空＝用系统里装的那份**：先在 `PATH` 里找 `pngquant`，再试几个常见安装位置（`%LOCALAPPDATA%\\Programs\\pngquant`、choco、scoop）。所以装好就能用 —— 到 pngquant.org 下 Windows 包解压、把 `pngquant.exe` 放进任意 PATH 目录即可（本机就是这么装的），`choco install pngquant` 也行。也可以用这一栏直接指路：填完整路径，或填命令名走 PATH。**本插件不捆绑、不下载它**（GPL 的外部程序）；实在找不到时这一档整步不做，图片保持原样',
					control: { type: 'text', placeholder: '留空＝自动找（或填 D:\\tools\\pngquant\\pngquant.exe）' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'pngquantQuality',
					name: 'pngquant 质量档',
					desc: '`min-max` 两档，默认 `65-80`：pngquant 用最少的颜色去够到 max，够不到 min 就**放弃压缩**（它退出码 99，我们按原图留着）。与 Image Converter 那一项同名同义',
					control: { type: 'text', placeholder: '65-80' },
					visible: (settings) => (settings.vaultConvertFormat ?? '').toLowerCase() === 'pngquant',
				},
				{
					key: 'convertImportedImages',
					name: '导入的图片转成目标格式',
					desc: '把收进仓库的外部图片顺手转成上面的目标格式（例如 png/jpg → webp），链接直接写成转换后的文件名。转码用插件自带的编码器，不依赖别的插件；解不开的格式（HEIC / TIFF 这类）按原格式导入，不影响图片进库。转完比原来大也照用转换结果 —— 判据是"这张图已经统一成目标格式了"',
					control: { type: 'toggle' },
				},
				{
					key: 'tidyConvertFormat',
					name: '整理时转换图片格式',
					desc: '执行「整理图片」时，顺手把还不是目标格式的图片转成目标格式（目标格式就是上面那一项，默认 webp）。转码用插件自带的编码器，不依赖别的插件；动图（gif）与已经是目标格式的图片保持原样，其余一律照用转换结果（比原来大也照用 —— 判据是格式统一）',
					control: { type: 'toggle' },
				},
			],
		},
		{
			heading: '粘贴',
			fields: [
				{
					key: 'takeOverImagePaste',
					name: '粘贴图片由本插件接管',
					desc: '在编辑器里粘贴图片文件时，由本插件自己存进仓库（一张一张、名字不撞、顺手转成目标格式）并写好链接 —— 一次粘多张也不会漏。**若你装了 Image Converter**：建议把它的「Never process filenames」填 `*`，让它的自动粘贴 / 拖放让开（那一项只关这一件事，右键 Process image 与批量功能都还在）—— 否则这次粘贴会先被它接管，本插件只能退让，并提醒你一句。关掉本项则恢复"别人家的粘贴"',
					control: { type: 'toggle' },
				},
				{
					key: 'autoSetImageSizeOnPaste',
					name: '粘贴图片时自动套用默认尺寸',
					desc: '把刚粘进笔记的图片按「图片大小」那一组的默认宽度 / 高度加上尺寸（与「快速设置图片大小」用的是同一套参数）—— 本插件自己接管的粘贴、别的插件存下的截图，以及粘贴文本里带的图片链接都算。只改刚粘进来的那一小段，笔记其余部分一个字符都不动，撤销一次即可回退；粘贴多张图时逐张处理，不会漏。宽度留空（那是"移除尺寸"模式）或尺寸填错时这一步自动跳过；粘贴进来的图片已经带着尺寸时，照上面「覆盖已有尺寸」开关决定动不动它',
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
			heading: '一键整理',
			fields: [
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
	],
};
