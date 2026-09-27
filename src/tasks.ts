import { App, Notice, TFile } from 'obsidian';
import type { Editor } from 'obsidian';
import type { BatchContext, BatchRunner } from './batch';
import { copyImageFiles } from './image/clipboard';
import { resolveImageFiles } from './image/copy';
import { buildRichContent } from './image/rich-copy';
import type { CopySelection } from './image/rich-copy';
import type { ImageRef } from './image/scan';
import { buildBasenameIndex, collectLinkedImageFiles } from './image/links';
import { buildVaultBasenameMap } from './image/naming';
import { getTargetAttachmentFolder } from './image/attachment-folder';
import { convertVaultImage, formatLabel, selectConvertibleImages } from './image/convert';
import type { ConvertPlan } from './image/convert';
import { probePngquant } from './image/pngquant';
import { organizeNoteImages } from './image/organize';
import { countImages, fixImageLinkFormats, renameGarbledImages, renameImagesToPreset } from './image/rename';
import { applyImageSize, pastedImageSizeOptions, validateImageSize } from './image/size';
import type { ImageSizeOptions } from './image/size';
import {
	chooseKeeper,
	collectImageTargets,
	findIdenticalGroups,
	groupByFolderAndSize,
	isManagedImageExtension,
	rewriteImageReferences,
} from './image/dedupe';
import { isImageFileName, selectUnusedImages } from './image/unused';
import type { ImageEntry } from './image/dedupe';
import {
	discardImportedFiles,
	importImageBytes,
	transferExternalImages,
	transferImagesInText,
} from './image/transfer';
import { looksLikeChatLog, resolveIndent } from './text/chat-log';
import type { ChatLogOptions } from './text/chat-log';
import { dedentBy, keepEdgeNewlines, placeBlockAt, resolveRangeIndent } from './text/context-indent';
import { getSpacingOptions, resolveConvertPlan } from './settings';
import type { ImageTransferSettings } from './settings';
import { resolveLeadingIndentMode } from './text/indent';
import { formatNoteText } from './text/pipeline';
import type { TextPipelineOptions } from './text/pipeline';
import { ConfirmRenameModal } from './ui/confirm-rename-modal';
import { MenuManageModal } from './ui/menu-manage-modal';
import { lastDetectedMenuItems } from './ui/image-menu';
import { parseHiddenItems, serializeHiddenItems } from './ui/menu-hidden';
import { ImageSizeModal } from './ui/image-size-modal';
import { buildPasteText } from './ui/paste-images';
import type { StatusBarProgress } from './ui/progress';

/**
 * 任务编排（从 main.ts 抽出）。
 *
 * 命令面板、右键菜单、弹窗确认后三条路最终都落到这里，每种操作只有一份实现。
 * 每个任务都只管两件事：**这一批要做什么**、**结果怎么汇报**；
 * 互斥锁、通知屏蔽、进度、出错兜底都在 batch.ts 的壳里。
 */

/** 「粘贴图片」要存的一张图：剪贴板里的文件名 + 字节（由 `ui/paste-watch.ts` 读出来） */
export interface PasteImage {
	name: string;
	bytes: ArrayBuffer;
}

/** 菜单只需要这个接口，不关心任务怎么实现（也让菜单能单独测） */
export interface TaskActions {
	/** 转换外部绝对路径图片（逐篇，单篇失败不拖垮整批） */
	transferExternal(files: TFile[], where: string): Promise<void>;
	/** 重命名笔记里的乱码图片 */
	renameGarbled(files: TFile[], where: string): Promise<void>;
	/** 把笔记里引用的图片统一改成预设命名 */
	renameToPreset(files: TFile[], where: string, force: boolean): Promise<void>;
	/** 整理图片位置：把别处的图片复制进本笔记的附件夹 */
	organizeImages(files: TFile[], where: string): Promise<void>;
	/** 打开「图片大小」弹窗 */
	openImageSize(files: TFile[], scopeLabel: string): void;
	/** 快速设置一篇笔记的图片大小：直接用设置里的默认尺寸，不弹窗 */
	quickSetImageSize(file: TFile): Promise<void>;
	/** 快速修复聊天记录：转换本文件内的外部图片 + 修复排版（两步一次做完） */
	quickFixChatLog(file: TFile | null): Promise<void>;
	/** 只排版**选中的那段内容**（转换选区里的外部图片 + 修复排版），笔记其余部分不动 */
	typesetSelection(file: TFile, editor: Editor): Promise<void>;
	/** 粘贴自动修复：只把刚粘进来的那一段 `[start, 光标处)` 排版 */
	fixPastedRange(file: TFile, editor: Editor, start: number): Promise<boolean>;
	/** 粘贴进来的那一段里的图片按默认尺寸加上 `|宽x高`（只改这一段，不写盘） */
	sizePastedRange(editor: Editor, start: number): Promise<boolean>;
	/** 粘贴图片由我们接管：存图（一张一张、名字不撞、转成目标格式）+ 把文字与链接写进正文 */
	pasteImages(
		file: TFile,
		editor: Editor,
		from: number,
		to: number,
		images: PasteImage[],
		text: string
	): Promise<boolean>;
	/** 复制图片到系统剪贴板（可在文件夹里粘出文件，聊天窗口里贴出图片） */
	copyImages(file: TFile, refs: ImageRef[], selection?: CopySelection | null): Promise<void>;
	/** 打开「图片右键菜单」管理面板（看检测到的菜单项、开关哪些显示） */
	openMenuManager(): void;
	/** 修复排版（空格 / 缩进 / 聊天记录 / 标签 / 公式） */
	typeset(files: TFile[], where: string): Promise<void>;
	/** 把全库"不是目标格式"的图片转换成目标格式（命令面板入口） */
	convertEntireVault(): Promise<void>;
	/** 转换当前笔记里引用的图片（命令面板入口）：想先在一篇笔记上试就用它 */
	convertNoteImages(file: TFile | null): Promise<void>;
	/** 整理图片：转换图片格式 + 合并内容相同的重复副本 + 清理没人引用的附件（命令 / 右键菜单 / 左侧栏图标共用） */
	tidyImages(confirm?: boolean): Promise<void>;
	/** 清理没人引用的图片附件（先弹确认框再动手）：扫描全库笔记与 canvas 里的引用 */
	clearUnusedImagesWithConfirm(): Promise<void>;
}

/** 提示里列图片名：最多三个，其余用"…"带过（提示太长会挡住屏幕上的内容） */
function summarizeNames(names: string[]): string {
	return names.length > 3 ? `${names.slice(0, 3).join('、')}…` : names.join('、');
}

/** 转换前确认弹窗里那句警告（当前笔记 / 全库共用） */
const CONVERT_WARNING = '⚠️ 转换会重写这些图片文件并改扩展名（例如 png → webp），笔记里的链接由 Obsidian 自动更新；动图（gif）与已经是目标格式的图片不会被动。';

/** 目标格式选了 pngquant、系统里又找不到它时说的话（怎么装、怎么指路都写清楚） */
const PNGQUANT_MISSING_MESSAGE = '⚠️ 系统里没找到 pngquant —— 压 PNG 要靠它。到 pngquant.org 下 Windows 包解压，把 pngquant.exe 放进任意一个 PATH 目录（或 `choco install pngquant`），也可以在设置里直接填它的完整路径。';

/** 转换一次要用的东西：目标格式 + 质量 + 格式标签（两条转换命令与「整理图片」共用） */
interface ConversionReady {
	plan: ConvertPlan;
	label: string;
}

export class ImageTasks implements TaskActions {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => ImageTransferSettings,
		private readonly runner: BatchRunner,
		private readonly progress: StatusBarProgress,
		/** 写盘（设置面板之外改设置的地方，比如菜单管理面板，得自己存） */
		private readonly saveSettings: () => Promise<void>
	) {}

	/**
	 * 「转换格式」这一步这一次要用的东西：目标格式 + 质量（转码用插件自带的编码器，
	 * 见 `image/convert.ts`）。目标格式认不出来时返回 `null`，调用方按"这一步不做"处理。
	 */
	private readConversion(): ConversionReady | null {
		const plan = resolveConvertPlan(this.getSettings());
		return plan ? { plan, label: formatLabel(plan.format) } : null;
	}

	// ------------------------------------------------------------------ 外部图片转换

	/** 转换当前笔记里的外部图片（命令面板入口） */
	async transferCurrentNote(file: TFile | null): Promise<void> {
		await this.runner.run(
			{
				label: '📷 外部图片转换',
				files: file ? [file] : [],
				failureMessage: '❌ 处理过程中发生意外错误，请检查控制台。',
			},
			async (ctx) => {
				if (!file) return '⚠️ 无法获取当前文件，请确保您打开了一篇笔记！';
				const updated = await transferExternalImages(this.app, this.getSettings(), file);
				if (updated) {
					ctx.progress.finish('✅ 转换完成');
					return '✅ 当前笔记外部图片转换完成！';
				}
				ctx.progress.clear();
				return '没有发现需要转换的外部本地图片。';
			}
		);
	}

	/** 转换整个仓库的外部图片（命令面板入口） */
	async transferEntireVault(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const reservedPaths = new Map<string, string>();
		const reservedBasenames = buildVaultBasenameMap(this.app);

		await this.runner.run(
			{
				label: '📷 外部图片转换',
				files,
				failureMessage: '❌ 全局处理中断，请检查控制台。',
			},
			async (ctx) => {
				const settings = this.getSettings();
				let processedCount = 0;
				for (let i = 0; i < files.length; i++) {
					const f = files[i];
					if (!f) continue;
					const updated = await transferExternalImages(this.app, settings, f, reservedPaths, reservedBasenames);
					if (updated) processedCount++;
					ctx.progress.step(i + 1);
				}
				ctx.progress.finish('✅ 转换完成');
				return `🎉 全局处理完毕！共更新了 ${processedCount} 篇笔记。`;
			}
		);
	}

	/** 转换外部图片（右键菜单入口） */
	async transferExternal(files: TFile[], where: string): Promise<void> {
		const settings = this.getSettings();
		const reservedPaths = new Map<string, string>();
		const reservedBasenames = buildVaultBasenameMap(this.app);
		await this.runPerFile(
			'📷 外部图片转换',
			files,
			async (file) => (await transferExternalImages(this.app, settings, file, reservedPaths, reservedBasenames)) ? 1 : 0,
			(count) => `🎉 ${where}共更新了 ${count} 篇笔记。`
		);
	}

	// ------------------------------------------------------------------ 重命名

	/**
	 * 重命名乱码图片（命令面板与右键菜单共用）。
	 *
	 * 全库预扫描文件名 + 批次内预留，保证重命名出来的名字在仓库里唯一；
	 * 收尾统一修正链接格式（重命名由 Obsidian 原生接口改写引用，这里只做格式归一）。
	 */
	async renameGarbled(files: TFile[], where: string): Promise<void> {
		const settings = this.getSettings();
		const reservedPaths = new Map<string, string>();
		const reservedBasenames = buildVaultBasenameMap(this.app);
		await this.runPerFile(
			'🔍 乱码图片扫描',
			files,
			(file, ctx) => renameGarbledImages(this.app, settings, file, ctx.index, reservedPaths, reservedBasenames),
			(count) => `🎉 ${where}共重命名了 ${count} 张乱码图片。`,
			async () => { await fixImageLinkFormats(this.app, settings); }
		);
	}

	/**
	 * 整库重命名（命令面板入口）：先统计数量并让用户确认，再逐篇重命名。
	 * @param force 为 true 时连已符合预设格式的图片也重命名
	 */
	async renameEntireVaultToPreset(force: boolean): Promise<void> {
		try {
			const files = this.app.vault.getMarkdownFiles();
			const settings = this.getSettings();
			const totalCount = await this.countAll(files, force);

			if (totalCount === 0) {
				await fixImageLinkFormats(this.app, settings);
				new Notice('ℹ️ 仓库中没有需要重命名的图片，已检查并修正链接格式。');
				return;
			}

			new ConfirmRenameModal(this.app, totalCount, async () => {
				const reservedPaths = new Map<string, string>();
				const reservedBasenames = buildVaultBasenameMap(this.app);
				const processedFiles = new Set<string>();
				await this.runPerFile(
					force ? '📷 图片重命名（强制）' : '📷 图片重命名',
					files,
					(file, ctx) => renameImagesToPreset(
						this.app, settings, file, ctx.index,
						reservedPaths, reservedBasenames, force, undefined, processedFiles
					),
					(count) => `🎉 全局处理完毕！共重命名了 ${count} 张图片。`,
					async () => { await fixImageLinkFormats(this.app, settings); }
				);
			}).open();
		} catch (e) {
			this.progress.clear();
			console.error(e);
			new Notice('❌ 全局处理中断，请检查控制台。');
		}
	}

	/** 重命名一批笔记里的图片（右键菜单入口，先确认再执行） */
	async renameToPreset(files: TFile[], where: string, force: boolean): Promise<void> {
		const settings = this.getSettings();
		const total = await this.countAll(files, force);

		if (total === 0) {
			await fixImageLinkFormats(this.app, settings);
			new Notice(`ℹ️ ${where}没有需要重命名的图片，已检查并修正链接格式。`);
			return;
		}

		new ConfirmRenameModal(this.app, total, async () => {
			const reservedPaths = new Map<string, string>();
			const reservedBasenames = buildVaultBasenameMap(this.app);
			const processedFiles = new Set<string>();
			await this.runPerFile(
				force ? '📷 图片重命名（强制）' : '📷 图片重命名',
				files,
				(file, ctx) => renameImagesToPreset(
					this.app, settings, file, ctx.index,
					reservedPaths, reservedBasenames, force, undefined, processedFiles
				),
				(count) => `🎉 ${where}共重命名了 ${count} 张图片。`,
				async () => { await fixImageLinkFormats(this.app, settings); }
			);
		}).open();
	}

	/** 统计一批笔记里待重命名的图片数（只读，不改内容） */
	private async countAll(files: TFile[], force: boolean): Promise<number> {
		const settings = this.getSettings();
		const index = buildBasenameIndex(this.app);
		let total = 0;
		for (const file of files) {
			total += await countImages(this.app, file, index, settings, force);
		}
		return total;
	}

	// ------------------------------------------------------------------ 图片格式转换

	/**
	 * 把全库"不是目标格式"的图片转换为目标格式（命令面板入口）。
	 *
	 * 为什么要有这条：仓库里早年攒下的 png/jpg 得统一成 webp（省空间、Obsidian 原生支持），
	 * 一张一张手动转不现实。转码用插件自带的编码器（`image/convert.ts`），不依赖别的插件。
	 *
	 * 想先在一篇笔记上试，用 `convertNoteImages`（范围小、看得清效果）。
	 */
	async convertEntireVault(): Promise<void> {
		const ready = await this.prepareConversion();
		if (!ready) return;

		const targets = selectConvertibleImages(this.app.vault.getFiles(), ready.plan);
		if (targets.length === 0) {
			new Notice(`ℹ️ 全库图片都已经是 ${ready.label} 了（动图 gif 与不支持转换的格式会跳过）。`);
			return;
		}

		new ConfirmRenameModal(this.app, targets.length, async () => {
			await this.runConversion(targets, ready);
		}, {
			title: '确认转换图片格式',
			message: `发现 ${targets.length} 张图片不是 ${ready.label}，确认转换？`,
			warning: CONVERT_WARNING,
			confirmLabel: '确认转换',
		}).open();
	}

	/**
	 * 转换**当前笔记里引用的**图片（命令面板入口）：想先在一篇笔记上看看效果时用它。
	 *
	 * 只认笔记里 `![[…]]` 嵌入的图片（与重命名 / 整理图片位置同一套解析），
	 * 同名有歧义的一律跳过 —— 宁可少转一张，也不去改错文件。
	 */
	async convertNoteImages(file: TFile | null): Promise<void> {
		if (!file) {
			new Notice('⚠️ 无法获取当前文件，请确保您打开了一篇笔记！');
			return;
		}

		const ready = await this.prepareConversion();
		if (!ready) return;

		const index = buildBasenameIndex(this.app);
		const linked = await collectLinkedImageFiles(this.app, file, index);
		const targets = selectConvertibleImages(linked, ready.plan);
		if (targets.length === 0) {
			new Notice(`ℹ️ 这篇笔记里没有需要转换的图片（都已经是 ${ready.label}，动图与不支持的格式会跳过）。`);
			return;
		}

		new ConfirmRenameModal(this.app, targets.length, async () => {
			await this.runConversion(targets, ready);
		}, {
			title: '确认转换图片格式',
			message: `这篇笔记里有 ${targets.length} 张图片不是 ${ready.label}，确认转换？`,
			warning: CONVERT_WARNING,
			confirmLabel: '确认转换',
		}).open();
	}

	/**
	 * 转换前的统一准备：算一次转换计划（目标格式 + 质量），pngquant 那一档顺带确认"找得到它"。
	 *
	 * 两件事都**只提示、什么都不做**（返回 `null`）：
	 *
	 * - 目标格式认不出来（手改坏了 data.json）：宁可这一次不转，也不猜一个格式去重写用户的图片；
	 * - 目标格式是 pngquant、系统里又找不到它：转 PNG 全靠这个外部程序，找不到就先把话说清楚，
	 *   而不是让几十张图一张一张"跳过"完再报个含糊的数字。
	 */
	private async prepareConversion(): Promise<ConversionReady | null> {
		const ready = this.readConversion();
		if (!ready) {
			new Notice('⚠️ 读不出「转换图片格式」的目标格式：请到设置里选一个（webp / JPEG / PNG / pngquant）。');
			return null;
		}
		if (!(await this.pngquantReady(ready.plan))) {
			new Notice(PNGQUANT_MISSING_MESSAGE);
			return null;
		}
		return ready;
	}

	/**
	 * pngquant 那一档能不能跑：探测一次（`--version` 有回话就算找到）。
	 *
	 * 别的目标格式直接算通过 —— 只有这一档要靠外部程序。
	 */
	private async pngquantReady(plan: ConvertPlan): Promise<boolean> {
		if (plan.format !== 'PNGQUANT') return true;
		const found = await probePngquant(plan.pngquant?.path ?? '');
		if (found) return true;
		console.warn(`⚠️ 没找到 pngquant（当前设置：${plan.pngquant?.path || '留空＝按系统 PATH 找'}）`);
		return false;
	}

	/**
	 * 逐张转换并汇报（当前笔记 / 全库共用）。
	 *
	 * 顺序是 **转码 → 改名（换扩展名）→ 写回内容**，改名走 Obsidian 原生的
	 * `fileManager.renameFile`，全库链接（wikilink / Markdown / canvas）自动跟着更新。
	 * 单张出错不拖垮整批；一次只转一张（编码器是浏览器自己的 canvas，不需要抢时间）。
	 */
	private async runConversion(
		targets: TFile[],
		ready: ConversionReady
	): Promise<void> {
		const { plan, label } = ready;
		await this.runner.run(
			{
				label: `🖼️ 转换为 ${label}`,
				files: targets,
				failureMessage: '❌ 图片格式转换中断，请检查控制台。',
			},
			async (ctx) => {
				let converted = 0;
				let skipped = 0;
				let failed = 0;

				for (let i = 0; i < targets.length; i++) {
					const file = targets[i];
					if (file) {
						try {
							const name = await convertVaultImage(this.app, file, plan);
							if (name) converted++;
							else skipped++;
						} catch (e) {
							// 单张出错不拖垮整批：继续跑，最后一起汇报
							failed++;
							console.error(`❌ [ImageTransfer] 转换失败：${file.path}`, e);
						}
					}
					ctx.progress.step(i + 1);
				}

				if (converted > 0) {
					ctx.progress.finish('✅ 转换完成');
					let message = `🎉 已把 ${converted} 张图片转换为 ${label}。`;
					if (skipped > 0) message += `另有 ${skipped} 张没转（已是 ${label}、动图，或这张解不开 / 名字被占着），按原样留着。`;
					if (failed > 0) message += `⚠️ 有 ${failed} 张出错，详情见控制台。`;
					return message;
				}
				ctx.progress.clear();
				if (failed > 0) {
					return `⚠️ 没有图片转换成功，有 ${failed} 张出错，详情见控制台。`;
				}
				return `ℹ️ 没有图片需要转换（可能都已经是 ${label}，或这些图解不开 / 名字被占着）。`;
			}
		);
	}

	// ------------------------------------------------------------------ 整理图片（转换 + 合并 + 清理）

	/**
	 * 整理图片：**转换图片格式** + **合并重复副本**（内容完全相同、又在同一个文件夹里）
	 * + **清理没人引用的附件**。
	 *
	 * 三件事都是"把仓库里的图片收拾干净"，所以合成一个任务，三个入口共用：
	 * 命令面板（`tidy-images`）、文件 / 文件夹右键的「图片功能」二级栏、左侧栏的一键图标。
	 *
	 * 为什么合并限定"同一个文件夹"：同目录里的孪生文件是"同一张图粘了两次"，纯浪费；
	 * 而跨目录的同图是本插件「整理图片位置」**特意**给每篇笔记拷的副本
	 * （笔记走到哪儿都自带图片）—— 删了反而破坏设计。详见 `image/dedupe.ts`。
	 *
	 * 四步的顺序都不能动，理由逐条写在下面 ① ② ③ ④ 里。
	 *
	 * @param confirm 是否先弹确认框。命令面板与右键菜单那两条要（`true`，默认）；
	 *   左侧栏图标是"一键整理"，直接跑（`false`）
	 */
	async tidyImages(confirm = true): Promise<void> {
		const settings = this.getSettings();
		const images = this.app.vault.getFiles().filter(file => isManagedImageExtension(file.extension));
		const docs: Array<{ file: TFile; text: string }> = [];
		const counts = new Map<string, number>();

		if (images.length >= 2) {
			// 引用计数：所有笔记 + canvas 各读一遍、一次统计完 —— "留哪张"看的就是它
			const canvases = this.app.vault.getFiles().filter(file => file.extension === 'canvas');
			for (const doc of [...this.app.vault.getMarkdownFiles(), ...canvases]) {
				let text: string;
				try {
					text = await this.app.vault.read(doc);
				} catch (err) {
					console.error(`⚠️ 读取失败，跳过这篇的引用统计：${doc.path}`, err);
					continue;
				}
				docs.push({ file: doc, text });
				for (const name of collectImageTargets(text)) {
					counts.set(name, (counts.get(name) ?? 0) + 1);
				}
			}
		}

		// 先按 目录 + 字节数 粗分组（不读盘），再逐组读字节确认"内容真的相同"
		const entries: ImageEntry[] = images.map(file => ({
			path: file.path,
			name: file.name,
			folder: file.parent?.path ?? '',
			size: file.stat.size,
		}));
		const plans: Array<{ keeper: ImageEntry; drops: ImageEntry[] }> = [];
		for (const bucket of groupByFolderAndSize(entries)) {
			const identical = await findIdenticalGroups(bucket, async path => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) throw new Error(`找不到 ${path}`);
				return this.app.vault.readBinary(file);
			});
			for (const group of identical) {
				if (group.length < 2) continue;
				const keeper = chooseKeeper(group, name => counts.get(name.toLowerCase()) ?? 0);
				plans.push({ keeper, drops: group.filter(entry => entry.path !== keeper.path) });
			}
		}

		const drops = plans.flatMap(plan => plan.drops);
		// 真正要删的文件（顺手把 TFile 拿在手上：批量壳要它、删除也要它）
		const dropFiles: TFile[] = drops
			.map(entry => this.app.vault.getAbstractFileByPath(entry.path))
			.filter((file): file is TFile => file instanceof TFile);
		const megabytes = dropFiles.reduce((sum, file) => sum + file.stat.size, 0) / (1024 * 1024);

		// 格式转换那一段的准备：开关关着 / 目标格式读不出来 / pngquant 找不到 → 整步跳过，
		// 其余两步照常（整理图片不能因为一个设置或一个外部程序就什么都不做）。
		// 待转清单要先排掉"马上会被合并掉的副本"—— 那几张第 ② 步就进回收站了，
		// 再拿去读盘只会得到一次"失败"，把结果提示里的数字弄脏。
		const dropPaths = new Set(dropFiles.map(file => file.path));
		let ready = settings.tidyConvertFormat === false ? null : this.readConversion();
		let convertHint = '';
		if (!ready) {
			if (settings.tidyConvertFormat !== false) convertHint = '读不出「转换图片格式」的目标格式，跳过格式转换';
		} else if (!(await this.pngquantReady(ready.plan))) {
			ready = null;
			convertHint = '系统里没找到 pngquant，跳过格式转换（装一个，或在设置里填它的路径）';
		}
		const convertTargets = ready
			? selectConvertibleImages(images, ready.plan).filter(file => !dropPaths.has(file.path))
			: [];

		const run = async (): Promise<void> => {
			await this.runner.run(
				{
					label: '🧩 整理图片',
					// 进度总量 = 要合并的 + 要转换的（两件事都是实打实要跑的动作）
					files: [...dropFiles, ...convertTargets],
					failureMessage: '❌ 整理图片中断，请检查控制台。',
				},
				async (ctx) => {
					// ① 先把引用改写到留下的那张 —— 顺序反了就会留下断链
					let touchedNotes = 0;
					for (const doc of docs) {
						let updated = doc.text;
						for (const plan of plans) {
							for (const drop of plan.drops) {
								updated = rewriteImageReferences(updated, drop.name, plan.keeper.name);
							}
						}
						if (updated === doc.text) continue;
						await this.app.vault.modify(doc.file, updated);
						touchedNotes++;
					}

					// ② 多余的副本进回收站（走用户设置的删除方式）
					let removed = 0;
					for (let i = 0; i < dropFiles.length; i++) {
						const file = dropFiles[i];
						if (file) {
							try {
								await this.app.fileManager.trashFile(file);
								removed++;
							} catch (err) {
								console.error(`❌ [ImageTransfer] 合并失败：${file.path}`, err);
							}
						}
						ctx.progress.step(i + 1);
					}
					let step = dropFiles.length;

					// ③ 格式转换：还不是目标格式的那些转成目标格式（插件自带的编码器，一张一张来）。
					// 排在 ② 之后 —— 已经被合并掉的副本不必白转一趟；
					// 改名走 Obsidian 原生的 fileManager.renameFile，全库链接（wikilink /
					// Markdown / canvas）自动跟着更新，与那两条转换命令是同一套做法。
					let converted = 0;
					let convertSkipped = 0;
					let convertFailed = 0;
					if (ready) {
						for (const file of convertTargets) {
							try {
								const name = await convertVaultImage(this.app, file, ready.plan);
								if (name) converted++;
								else convertSkipped++;
							} catch (err) {
								// 单张出错不拖垮整批：继续跑，最后一起汇报
								convertFailed++;
								console.error(`❌ [ImageTransfer] 转换失败：${file.path}`, err);
							}
							ctx.progress.step(++step);
						}
					}

					// ④ 清理"没人引用的图片附件"（自己实现，不依赖 Clear Unused Images）。
					// 排最后：前面两步才刚把多余的副本删掉，这时清一遍最干净
					const cleared = settings.autoClearUnusedImages === false
						? 0
						: await this.clearUnusedImages();

					// 结果按实际发生了什么汇报
					const parts: string[] = [];
					if (removed > 0) {
						let merged = `合并掉 ${removed} 张重复图片（${plans.length} 组`;
						if (touchedNotes > 0) merged += `，改写了 ${touchedNotes} 篇笔记的引用`;
						parts.push(`${merged}）`);
					}
					if (converted > 0) parts.push(`把 ${converted} 张图片转换为 ${ready?.label ?? ''}`);
					if (cleared > 0) parts.push(`清理掉 ${cleared} 张没人引用的图片`);

					if (parts.length === 0) {
						ctx.progress.clear();
						if (convertSkipped > 0) {
							return `ℹ️ 没有需要整理的图片（有 ${convertSkipped} 张不是 ${ready?.label ?? ''}，但这些图解不开 / 名字被占着，按原样留着）。`;
						}
						return `ℹ️ 没有需要整理的图片（没有内容相同的重复副本，也没有需要转换格式的图片${convertHint ? `；${convertHint}` : ''}）。`;
					}

					if (removed > 0 || converted > 0) ctx.progress.finish('✅ 整理完成');
					else ctx.progress.clear();

					let message = `🎉 已整理：${parts.join('，')}。`;
					if (convertSkipped > 0) {
						message += `另有 ${convertSkipped} 张没转（已经是 ${ready?.label ?? ''}、动图，或这张解不开 / 名字被占着），按原样留着。`;
					}
					if (convertFailed > 0) message += `⚠️ 有 ${convertFailed} 张转换出错，详情见控制台。`;
					if (convertHint) message += `（${convertHint}）`;
					return message;
				}
			);
		};

		if (!confirm) {
			await run();
			return;
		}

		const planLines: string[] = [];
		if (dropFiles.length > 0) {
			planLines.push(`发现 ${plans.length} 组内容完全相同的图片（同一文件夹内），将合并掉 ${dropFiles.length} 张、回收约 ${megabytes.toFixed(1)} MB。`);
		} else {
			planLines.push('没有发现内容相同的重复副本。');
		}
		if (convertTargets.length > 0) {
			planLines.push(`另有 ${convertTargets.length} 张图片不是 ${ready?.label ?? ''}，将一并转换。`);
		}
		if (dropFiles.length === 0 && convertTargets.length === 0) {
			planLines.push('整理仍会执行一次"清理没人引用的附件"。');
		}

		new ConfirmRenameModal(this.app, dropFiles.length + convertTargets.length, run, {
			title: '确认整理图片',
			message: planLines.join(''),
			warning: '⚠️ 合并掉的是内容一模一样的副本（会进回收站）；笔记里指向它们的链接会改写到留下的那一张，显示效果不变。跨文件夹的同图不动 —— 那是「整理图片位置」特意给每篇笔记拷的副本。格式转换会重写图片文件并改扩展名（如 png → webp），链接由 Obsidian 自动更新；动图（gif）与已经是目标格式的图片不会被动。',
			confirmLabel: '确认整理',
		}).open();
	}

	/**
	 * 清理**没人引用的图片附件**（自己实现，不依赖 Clear Unused Images）。
	 *
	 * 判定与保守之处见 `image/unused.ts` 的文件头：只清图片、只认笔记与 canvas 里的引用、
	 * 走回收站。单张删不掉只记日志，不拖垮整批。
	 *
	 * @returns 送进回收站的张数
	 */
	async clearUnusedImages(): Promise<number> {
		const all = this.app.vault.getFiles();
		const images = all.filter(file => isImageFileName(file.name));
		if (images.length === 0) return 0;

		// 引用只可能出现在笔记与 canvas 里（其它附件、pdf 里的引用一律不看：误判的代价比少清几个大）
		const documents = all.filter(file => file.extension === 'md' || file.extension === 'canvas');
		const texts: string[] = [];
		for (const doc of documents) {
			try {
				texts.push(await this.app.vault.read(doc));
			} catch (err) {
				// 读不出来的那一篇当作"可能引用了一切"：宁可少清，也不能把有人用的图删了
				console.error(`⚠️ 读不出 ${doc.path}，这一次不清理没人引用的附件`, err);
				return 0;
			}
		}

		const unused = selectUnusedImages(images, texts);
		let removed = 0;
		for (const file of unused) {
			try {
				await this.app.fileManager.trashFile(file);
				removed++;
			} catch (err) {
				console.error(`⚠️ 清理 ${file.path} 失败（不影响其它图片）`, err);
			}
		}
		return removed;
	}

	/**
	 * 「清理没人引用的图片附件」命令：先让用户确认，再动手（删除是破坏性操作）。
	 *
	 * 与「整理图片」里那一步是同一个实现（`clearUnusedImages`），只是多一道确认。
	 */
	async clearUnusedImagesWithConfirm(): Promise<void> {
		const all = this.app.vault.getFiles();
		const images = all.filter(file => isImageFileName(file.name));
		const documents = all.filter(file => file.extension === 'md' || file.extension === 'canvas');
		const texts: string[] = [];
		for (const doc of documents) {
			try {
				texts.push(await this.app.vault.read(doc));
			} catch (err) {
				console.error(`⚠️ 读不出 ${doc.path}，中止清理`, err);
				new Notice('⚠️ 有笔记读不出来，为安全起见这一次不清理。');
				return;
			}
		}

		const unused = selectUnusedImages(images, texts);
		if (unused.length === 0) {
			new Notice('ℹ️ 全库图片都有笔记或 canvas 引用，没有可清理的。');
			return;
		}

		new ConfirmRenameModal(this.app, unused.length, async () => {
			await this.runner.run(
				{
					label: '🧹 清理没人引用的图片',
					files: unused,
					failureMessage: '❌ 清理没人引用的图片时出错，请检查控制台。',
				},
				async (ctx) => {
					let removed = 0;
					for (let i = 0; i < unused.length; i++) {
						const file = unused[i];
						if (file) {
							try {
								await this.app.fileManager.trashFile(file);
								removed++;
							} catch (err) {
								console.error(`⚠️ 清理 ${file.path} 失败（不影响其它图片）`, err);
							}
						}
						ctx.progress.step(i + 1);
					}
					if (removed === 0) {
						ctx.progress.clear();
						return '⚠️ 一张都没清掉，详情见控制台。';
					}
					ctx.progress.finish('✅ 清理完成');
					return `🎉 已把 ${removed} 张没人引用的图片送进回收站（只清图片、只认笔记与 canvas 里的引用）。`;
				}
			);
		}, {
			title: '确认清理没人引用的图片',
			message: `发现 ${unused.length} 张图片没有任何笔记或 canvas 引用，确认清理？`,
			warning: '⚠️ 这些图片会被送进回收站（可在回收站里恢复）。只清图片；pdf、音频等其它附件一个都不碰。',
			confirmLabel: '确认清理',
		}).open();
	}

	// ------------------------------------------------------------------ 图片位置与大小

	/**
	 * 整理图片位置：把引用了别处图片的链接，改为指向笔记自己附件夹里的副本。
	 *
	 * 解决复制粘贴笔记后的典型问题 —— 本地附件夹里没有这张图，链接仍然指向原文件夹，
	 * 一旦原图被移动、改名或删除，笔记里的图片就没了。
	 */
	async organizeImages(files: TFile[], where: string): Promise<void> {
		const settings = this.getSettings();
		await this.runner.run(
			{
				label: '🧹 整理图片位置',
				files,
				failureMessage: '❌ 整理图片位置中断，请检查控制台。',
				needsIndex: true,
			},
			async (ctx) => {
				let touched = 0;
				let copied = 0;
				let relinked = 0;
				let skipped = 0;
				const reasons: string[] = [];

				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					if (file) {
						const result = await organizeNoteImages(this.app, settings, file, ctx.index);
						copied += result.copied;
						relinked += result.relinked;
						skipped += result.skipped;
						for (const reason of result.reasons) {
							if (!reasons.includes(reason)) reasons.push(reason);
						}
						if (result.changed) {
							await this.app.vault.modify(file, result.content);
							touched++;
						}
					}
					ctx.progress.step(i + 1);
				}

				let finalMsg: string;
				if (touched > 0) {
					ctx.progress.finish('✅ 整理完成');
					const parts = [`🎉 ${where}共整理 ${touched} 篇笔记`, `复制 ${copied} 张`, `改写 ${relinked} 处链接`];
					if (skipped > 0) parts.push(`跳过 ${skipped} 处`);
					finalMsg = parts.join('，') + '。';
				} else {
					ctx.progress.clear();
					finalMsg = 'ℹ️ 没有需要整理的图片位置。';
				}
				if (skipped > 0 && reasons.length > 0) {
					finalMsg += `（${reasons.join('；')}）`;
				}
				return finalMsg;
			}
		);
	}

	/**
	 * 按指定尺寸改写笔记中的图片链接。
	 * 只写真正发生变化的文件 —— 尺寸已经正确的笔记完全不碰，避免无谓的保存与同步。
	 */
	async setImageSize(files: TFile[], options: ImageSizeOptions, scopeLabel: string): Promise<void> {
		await this.runner.run(
			{
				label: '🖼️ 设置图片大小',
				files,
				failureMessage: '❌ 设置图片大小中断，请检查控制台。',
			},
			async (ctx) => {
				let changedFiles = 0;
				let changedLinks = 0;

				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					if (file) {
						const content = await this.app.vault.read(file);
						const result = applyImageSize(content, options);
						if (result.changed > 0 && result.content !== content) {
							await this.app.vault.modify(file, result.content);
							changedFiles++;
							changedLinks += result.changed;
						}
					}
					ctx.progress.step(i + 1);
				}

				if (changedLinks > 0) {
					ctx.progress.finish('✅ 尺寸设置完成');
					return `🎉 ${scopeLabel}处理完毕！共修改 ${changedLinks} 处图片尺寸（${changedFiles} 篇笔记）。`;
				}
				ctx.progress.clear();
				return 'ℹ️ 没有需要修改的图片尺寸。';
			}
		);
	}

	/**
	 * 快速设置图片大小：**直接用设置里的默认宽度 / 高度 / 覆盖开关**，不弹窗。
	 *
	 * 弹窗那条路（`openImageSize`）适合"这次想换个尺寸"，这条适合"平时那套参数再来一遍"。
	 * 参数不合法（比如宽度填了字母）时不出手，只提示 —— 免得把一堆链接改坏。
	 */
	async quickSetImageSize(file: TFile): Promise<void> {
		const settings = this.getSettings();
		const invalid = validateImageSize(settings.imageSizeWidth, settings.imageSizeHeight);
		if (invalid !== null) {
			new Notice(`⚠️ 默认尺寸无效：${invalid}。请在「图片大小」中修改默认宽度与高度。`);
			return;
		}
		await this.setImageSize(
			[file],
			{
				width: settings.imageSizeWidth,
				height: settings.imageSizeHeight,
				overwriteExisting: settings.imageSizeOverwrite,
			},
			'当前笔记'
		);
	}

	/** 打开图片大小设置弹窗 */
	openImageSize(files: TFile[], scopeLabel: string): void {
		if (files.length === 0) {
			new Notice('ℹ️ 没有可以处理的笔记。');
			return;
		}

		const settings = this.getSettings();
		new ImageSizeModal(this.app, {
			scopeLabel,
			files,
			read: (file) => this.app.vault.read(file),
			initialWidth: settings.imageSizeWidth,
			initialHeight: settings.imageSizeHeight,
			initialOverwrite: settings.imageSizeOverwrite,
			onConfirm: (options) => this.setImageSize(files, options, scopeLabel),
		}).open();
	}

	// ------------------------------------------------------------------ 复制图片

	/**
	 * 把图片复制进系统剪贴板（命令面板、右键菜单与 Ctrl+C 三处共用）。
	 *
	 * 两种结果：
	 * - **纯图片**（选区里没别的文字）：写文件拖放列表（+ 单张时的位图），文件夹里能粘出文件；
	 * - **图文混排**（选区里既有文字又有图片）：只写 HTML 与纯文本，QQ / 微信 里贴出来是
	 *   "文字 + 图片"。这时**不放位图**（有位图微信就不解析 HTML 了）、**也不放文件列表**
	 *   （有文件列表 QQ 就只当图片上传，文字不会出现 —— 用户实测过）。拼法见 `rich-copy.ts`。
	 *
	 * 与其它任务不同，这个不需要批量外壳：它不动仓库、只跑一条系统命令，
	 * 结果一句话就能说完（复制了几张、能不能粘）。**解析不出来的直接说清楚为什么**，
	 * 因为"点了没反应"比"提示没找到"更让人摸不着头脑。
	 */
	async copyImages(file: TFile, refs: ImageRef[], selection: CopySelection | null = null): Promise<void> {
		if (refs.length === 0) {
			new Notice('没有找到可复制的图片。请把光标放到图片链接上，或选中包含图片的内容。');
			return;
		}

		const images = await resolveImageFiles(this.app, file.path, refs);
		if (images.length === 0) {
			new Notice('没有找到对应的图片文件，它可能不在仓库中，或存在同名图片而无法确定。');
			return;
		}

		const rich = await buildRichContent(selection, images);

		try {
			// 纯图片且只有一张时顺带放一份位图，QQ / Word 这类只认图的程序也能直接贴
			const bitmapPath = rich === null && images.length === 1 ? images[0]?.path ?? null : null;
			await copyImageFiles(images.map(image => image.path), bitmapPath, process.platform, rich);

			const names = summarizeNames(images.map(image => image.name));
			new Notice(
				rich === null
					? `📋 已复制 ${images.length} 张图片：${names}\n可粘贴到文件夹或聊天窗口。`
					: `📋 已复制文字和 ${images.length} 张图片：${names}\n粘贴到聊天窗口是图文混排。`,
				4000
			);
		} catch (e) {
			console.error('❌ [Note Tidy] 复制图片失败：', e);
			new Notice('❌ 复制图片失败，详情请见控制台。');
		}
	}

	/**
	 * 打开「右键菜单」管理面板（图片 / 笔记 / 文件夹三个菜单）。
	 *
	 * 清单来自"最近一次右键"（menu-injector.ts 在上膛期间看到的项），
	 * 面板里关掉的项写进设置、下次就不再出现在那个菜单里。
	 */
	openMenuManager(): void {
		const settings = this.getSettings();
		new MenuManageModal(this.app, {
			detected: {
				image: lastDetectedMenuItems('image'),
				note: lastDetectedMenuItems('note'),
				folder: lastDetectedMenuItems('folder'),
			},
			hidden: parseHiddenItems(settings.menuHiddenItems),
			ownItems: {
				copy: settings.imageMenuCopyItem !== false,
				quickSize: settings.imageMenuQuickSizeItem !== false,
				quickFix: settings.imageMenuQuickFixItem !== false,
				typesetSelection: settings.imageMenuTypesetItem !== false,
				manage: settings.imageMenuManageItem !== false,
				imageSubmenu: settings.fileMenuImageSubmenu !== false,
				textSubmenu: settings.fileMenuTextSubmenu !== false,
			},
			save: async ({ hidden, ownItems }) => {
				settings.imageMenuCopyItem = ownItems.copy;
				settings.imageMenuQuickSizeItem = ownItems.quickSize;
				settings.imageMenuQuickFixItem = ownItems.quickFix;
				settings.imageMenuManageItem = ownItems.manage;
				settings.fileMenuImageSubmenu = ownItems.imageSubmenu;
				settings.fileMenuTextSubmenu = ownItems.textSubmenu;
				settings.menuHiddenItems = serializeHiddenItems(hidden);
				await this.saveSettings();
			},
		}).open();
	}

	// ------------------------------------------------------------------ 排版

	/**
	 * 修复排版：命令面板与右键菜单共用同一条路径。
	 * 流水线里的每一步都是纯函数且严格幂等，只有内容真正变化时才写回。
	 */
	async typeset(files: TFile[], where: string): Promise<void> {
		await this.runPerFile(
			'💬 排版修复',
			files,
			async (file) => (await this.typesetOne(file)) ? 1 : 0,
			(count, processed, failed) =>
				`🎉 ${where}共修复了 ${count} 篇笔记的排版。` +
				`本次处理 ${processed} 篇${failed > 0 ? `（${failed} 篇出错）` : ''}；${this.describeLayoutSwitches()}`
		);
	}

	/**
	 * 快速修复聊天记录：**本文件内的外部图片收进仓库 + 整篇排版修一遍**，一次点完。
	 *
	 * 就是「转换当前笔记的外部图片」与「修复当前笔记的排版」两步连做 —— 从 QQ / 微信
	 * 复制出来的聊天记录，正文里是 `file:///D:\…` 这类外部图片、排版也乱七八糟，
	 * 用户要的是"一下就干净"，而不是分两次点两下。
	 *
	 * 两步**必须待在同一个批量壳里**：壳里有互斥锁，分两次调用第二次会被当成
	 * "已有任务在执行"挡掉。先收图片再排版 —— 排版把聊天记录的图片挪到消息尾部，
	 * 收进来的 `![[…]]` 也一并按规矩排好。
	 */
	async quickFixChatLog(file: TFile | null): Promise<void> {
		await this.runner.run(
			{
				label: '⚡ 快速修复聊天记录',
				files: file ? [file] : [],
				failureMessage: '❌ 处理过程中发生意外错误，请检查控制台。',
			},
			async (ctx) => {
				if (!file) return '⚠️ 无法获取当前文件，请确保您打开了一篇笔记！';

				// ① 外部路径的图片 → 收进仓库并换成内部链接
				const transferred = await transferExternalImages(this.app, this.getSettings(), file);
				// ② 文本排版（空格 / 缩进 / 聊天记录 / 标签 / 公式）
				const typeset = await this.typesetOne(file);

				if (!transferred && !typeset) {
					ctx.progress.clear();
					return 'ℹ️ 没有需要修复的内容：本文件里没有外部图片，排版也已经规范。';
				}

				ctx.progress.finish('✅ 修复完成');
				const done: string[] = [];
				if (transferred) done.push('已转换外部图片');
				if (typeset) done.push('已修复排版');
				return `🎉 聊天记录快速修复完成（${done.join('，')}）。${this.describeLayoutSwitches()}`;
			}
		);
	}

	/**
	 * 只排版**选中的那段内容**：转换选区里的外部图片 + 修复排版，笔记其余部分一个字符不动。
	 *
	 * 为什么要有这条：整篇排版绕不开一个取舍 —— 一条消息的正文到哪儿结束。
	 * 作者自己接在消息下面写的行（`06集` 这类小标题、自己插的图）与消息正文之间
	 * 没有空行时，整篇排版只能把它们算作正文（改不了，猜不出来）。
	 * 选中一段再排版就没有这个歧义：**选中的是什么就排什么**。
	 *
	 * 排版结果用 `editor.replaceRange` 写回编辑器，因此**不走写盘**，
	 * 也就不会碰到笔记里没选中的部分（撤销一次即可回退）。选中内容的缩进跟随上下文
	 * （见 `typesetEditorRange` 与 `text/context-indent.ts`）：选区连同它所在的那一层一起排。
	 */
	async typesetSelection(file: TFile, editor: Editor): Promise<void> {
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (to <= from || editor.getSelection().trim() === '') {
			new Notice('ℹ️ 先选中要排版的内容，再运行这条命令。');
			return;
		}

		await this.runner.run(
			{
				label: '✍️ 排版选中内容',
				files: [file],
				failureMessage: '❌ 排版选中内容时发生意外错误，请检查控制台。',
			},
			async (ctx) => {
				const fixed = await this.typesetEditorRange(file, editor, from, to);
				if (fixed === 'unchanged') {
					ctx.progress.clear();
					return 'ℹ️ 选中的内容没有需要修复的地方。';
				}
				if (fixed === 'skipped') {
					ctx.progress.clear();
					return 'ℹ️ 这段内容已经变了，没有改动它。';
				}
				ctx.progress.finish('✅ 排版完成');
				return `🎉 选中内容已排版。${this.describeLayoutSwitches()}`;
			}
		);
	}

	/**
	 * 粘贴自动修复：只把**刚粘进来的那一段** `[start, 光标处)` 排版。
	 *
	 * 那一段的范围是确定的（粘贴前的光标位置 → 粘贴后的光标位置），所以不需要猜
	 * "哪几行是作者自己写的"，也不会碰到笔记的其它部分。
	 *
	 * 排版时缩进跟随上下文（在列表项里粘贴就与列表项对齐）、首尾换行数保持粘贴前的样子，
	 * 见 `typesetEditorRange` 与 `text/context-indent.ts`。
	 *
	 * 这一段里的图片顺手按默认尺寸加上 `|宽x高`（同一趟、同一次写回，见
	 * `pastedImageSizeOptions`）—— 粘进来的多半是聊天截图，尺寸该与笔记里其它图一致。
	 *
	 * @returns 是否真的改了（调用方据此决定要不要提示）
	 */
	async fixPastedRange(file: TFile, editor: Editor, start: number): Promise<boolean> {
		const end = editor.posToOffset(editor.getCursor('to'));
		const fixed = await this.typesetEditorRange(
			file,
			editor,
			start,
			end,
			pastedImageSizeOptions(this.getSettings())
		);
		if (fixed === 'fixed') {
			new Notice('⚡ 已修好刚粘贴的聊天记录。');
		}
		return fixed === 'fixed';
	}

	/**
	 * 粘贴进来的那一段里的图片：按设置里的默认尺寸加上 `|宽x高`。
	 *
	 * 范围与文本修复完全同一套（`[粘贴起点, 光标处)`），**只改这一段、不写盘**，
	 * 撤销一次即可回退。别的插件的粘贴（Obsidian 自己存下的截图、别家插件插进来的图、
	 * 粘贴文本里带的图片链接）都走它；**本插件自己接管的那条路**（`pasteImages`）不用它 ——
	 * 那一条是我们自己写的，尺寸在 `fixPastedRange` / 这里当场就做掉了。
	 *
	 * 为什么单独留一条路：**别人家的粘贴**可能分几次落进编辑器（一张一张存盘 / 转码，
	 * 每存好一张才插一条链接），而文本修复那边一笔只做一次。粘贴过后的几秒里，
	 * 这段范围每变一次就再看一眼（见 `ui/paste-watch.ts` 的观望表）；
	 * 已经有尺寸的图片不会再动，所以重复跑是幂等的。
	 *
	 * @returns 是否真的改了
	 */
	async sizePastedRange(editor: Editor, start: number): Promise<boolean> {
		const options = pastedImageSizeOptions(this.getSettings());
		if (!options) return false;

		const end = editor.posToOffset(editor.getCursor('to'));
		if (end <= start) return false;

		const fromPos = editor.offsetToPos(start);
		const toPos = editor.offsetToPos(end);
		const text = editor.getRange(fromPos, toPos);
		// 这一段里连图片链接都没有：省掉一次正则扫描（粘贴后每敲一个字都会走到这里）
		if (!text.includes('![')) return false;

		const result = applyImageSize(text, options);
		if (result.changed === 0 || result.content === text) return false;
		// 期间这一段被改过（用户又打字 / 别的插件插了东西）：拿旧偏移写回只会覆盖他刚打的字
		if (editor.getRange(fromPos, toPos) !== text) return false;

		editor.replaceRange(result.content, fromPos, toPos);
		return true;
	}

	/**
	 * 粘贴图片：**我们自己接管这次粘贴** —— 把剪贴板里的图片一张一张存进附件夹
	 * （名字不撞、顺手转成目标格式），再把剪贴板的文字与图片链接写进正文，最后修一遍那一段。
	 *
	 * 为什么接管：编辑器里的图片粘贴以前交给 Image Converter 的自动粘贴，但它那边是
	 * **并发**跑的（`handlePaste` 里 `files.map(async …)`）：一批图各算各的输出名，
	 * 同一秒算出来的名字撞在一起，后写的那个直接 `File already exists` 丢图
	 * （2026-09 用户实测"粘两张只剩第一张"）。它既没有开关、也不看 `defaultPrevented`，
	 * 我们只能让它别再管（它的「Never process filenames」填 `*`），由我们把这件事做对。
	 *
	 * 写回用编辑器自己的接口（`replaceRange`），**不写盘**：撤销一次即可回退。
	 * 排版与套尺寸与"别人家的粘贴"同一套判据：文字像聊天记录就走 `fixPastedRange`
	 * （顺带套尺寸，一次写回），不像就只套尺寸。
	 *
	 * @param from / @param to 粘贴前选区（或光标）的字符偏移：写回时替换掉这一段
	 * @returns 是否真的写了东西（一张图都没存下、也没有文字时为 `false`）
	 */
	async pasteImages(
		file: TFile,
		editor: Editor,
		from: number,
		to: number,
		images: PasteImage[],
		text: string
	): Promise<boolean> {
		const links = await this.savePastedImages(file, images);
		const insertion = buildPasteText(text, links);
		if (insertion === '') return false;

		const fromPos = editor.offsetToPos(from);
		const toPos = editor.offsetToPos(to);
		editor.replaceRange(insertion, fromPos, toPos);
		// 光标落在写进去的内容末尾 —— 后面的修复 / 套尺寸都按"这一段"取范围
		editor.setCursor(editor.offsetToPos(from + insertion.length));

		if (looksLikeChatLog(insertion)) await this.fixPastedRange(file, editor, from);
		else await this.sizePastedRange(editor, from);
		return true;
	}

	/**
	 * 把剪贴板里的图片存进附件夹（**一张一张**，名字走本插件那套不撞名的规矩）。
	 *
	 * 单张失败（读不出来 / 写不进仓库）只打日志、跳过那一张，其余照旧 —— 与导入那条路一致。
	 *
	 * @returns 每张成功落盘的图片对应的 `![[名字]]` 链接
	 */
	private async savePastedImages(file: TFile, images: PasteImage[]): Promise<string[]> {
		const settings = this.getSettings();
		const plan = settings.convertImportedImages === false ? null : resolveConvertPlan(settings);
		const folder = await getTargetAttachmentFolder(this.app, settings, file);
		const reservedPaths = new Map<string, string>();
		// 起手就把全库 basename 灌进去：粘贴的图不能与仓库里已有的图片撞名
		const reservedBasenames = buildVaultBasenameMap(this.app);

		const links: string[] = [];
		for (const image of images) {
			try {
				const imported = await importImageBytes(
					this.app, settings, folder, image, plan, reservedPaths, reservedBasenames
				);
				links.push(`![[${imported.name}]]`);
			} catch (err) {
				console.error(`❌ 粘贴的图片存不进仓库: ${image.name}`, err);
			}
		}
		return links;
	}

	/**
	 * 「排版选中内容」与粘贴自动修复共用的内核：把编辑器里 `[from, to)` 这一段排版。
	 *
	 * 两步与「快速修复聊天记录」一致：先把这段里 `file:///D:\…` 这类图片收进仓库，再排版。
	 * 结果写回编辑器（不写盘）。
	 *
	 * 另外做三件"只在这条路上说得清"的事（前两件在 `text/context-indent.ts`）：
	 *
	 * - **跟随上下文缩进**：按起点那一行的续行前缀（光标处的空白 / `>` 链）给整段每一行加前缀，
	 *   在列表项里粘贴不再"第一行缩进、其余顶格"；上下文自己对不上时整块顶格；
	 * - **接缝不变**：排版结果首尾的换行数还原成这一段原来的样子，粘贴块与上下文之间不再多出空行；
	 * - **写不进就回滚**：这一段在异步期间被改过（或编辑器拒绝写入）时，把**刚导入的文件**删掉 ——
	 *   链接没写上、文件留在库里就是孤儿附件（见 `discardImportedFiles`）。
	 *
	 * 期间用户又改了这一段（或这段已被替换 / 删除）时**不动它**：拿旧的偏移去写回，
	 * 只会把他刚打的字覆盖掉。
	 *
	 * @param sizeOptions 顺带给这一段里的图片套的尺寸（只有粘贴那条路会给，见
	 *   `pastedImageSizeOptions`；给 `null` = 这一趟不管尺寸，「排版选中内容」就是这一档）。
	 *   尺寸写在链接里，与排版各改各的，合并在**同一次写回**里 —— 撤销一次两步一起回退。
	 */
	private async typesetEditorRange(
		file: TFile,
		editor: Editor,
		from: number,
		to: number,
		sizeOptions: ImageSizeOptions | null = null
	): Promise<'fixed' | 'unchanged' | 'skipped'> {
		if (to <= from) return 'skipped';

		// 缩进前缀按整篇算：这一段落在笔记的哪一层，只有全文知道
		const indent = resolveRangeIndent(editor.getValue(), from, to);

		const fromPos = editor.offsetToPos(indent.from);
		const toPos = editor.offsetToPos(to);
		// 记住替换范围内的原文：异步期间它变了就不写回（免得覆盖用户刚输入的内容）
		const text = editor.getRange(fromPos, toPos);

		// 排版只作用在"这一段自己的文字"上：起点之前那截已有缩进另算
		const pasted = editor.getRange(editor.offsetToPos(from), toPos);
		if (!pasted.trim()) return 'skipped';

		// 先把这一段原本那一层缩进剥掉，让流水线看到"顶格的这一段"；
		// 那一层由 applyIndentPrefix 在排完版后按光标处补回去（顺序反了会吃掉正文自己的缩进）
		const content = dedentBy(pasted, indent.baseIndent);

		// ① 这段里的外部路径图片 → 收进仓库并换成内部链接
		const transferred = await transferImagesInText(this.app, this.getSettings(), file, content);
		// ② 文本排版（只作用在这段文字上）
		const typeset = formatNoteText(transferred.content, this.getTextPipelineOptions());
		// ③ 整块落到光标那一层（块的缩进就是光标处那一层，不再往上加；见 placeBlockAt）
		const placed = placeBlockAt(typeset, indent.prefix);
		// ④ 粘贴那条路顺带给图片套上默认尺寸：只动链接里的尺寸别名，与 ② 的排版互不干扰，
		//    合并在一次写回里（撤销一次两步一起回退）
		const typed = sizeOptions ? applyImageSize(placed, sizeOptions).content : placed;
		const result = keepEdgeNewlines(pasted, typed);

		if (!transferred.changed && result === text) {
			// 什么都没写成：刚导入的文件一个都不能留（见 discardImportedFiles）
			await discardImportedFiles(this.app, transferred.created);
			return 'unchanged';
		}

		// 异步期间这一段被改过（用户又打字 / 别的插件插了东西）：宁可不动，
		// 也不能拿旧偏移去覆盖他刚打的字 —— 但刚导入的图片必须回收：
		// 链接写不进去，它们就永远没人引用（2026-09 那 40 个孤儿附件就是这么攒出来的）。
		if (editor.getRange(fromPos, toPos) !== text) {
			await discardImportedFiles(this.app, transferred.created);
			return 'skipped';
		}

		try {
			editor.replaceRange(result, fromPos, toPos);
		} catch (err) {
			await discardImportedFiles(this.app, transferred.created);
			throw err;
		}
		return 'fixed';
	}

	/**
	 * 修复一篇笔记的排版。
	 *
	 * 用 vault.process 做"读—改—写"：它会拿到最新内容再写回，
	 * 避免整库批处理时把编辑器里还没落盘的改动覆盖掉（表现为"改了又弹回去"）。
	 * 全部排版步骤在 text/pipeline.ts 里按固定顺序串联，每一步都是幂等纯函数。
	 */
	private async typesetOne(file: TFile): Promise<boolean> {
		let changed = false;
		await this.app.vault.process(file, (content) => {
			const result = formatNoteText(content, this.getTextPipelineOptions());
			// 只有当输出内容发生了真正变化时才会写回，解决无限重复触发的 Bug
			if (result === content) return content;
			changed = true;
			return result;
		});
		return changed;
	}

	/** 把插件设置转换为排版流水线选项 */
	private getTextPipelineOptions(): TextPipelineOptions {
		const settings = this.getSettings();
		return {
			leadingIndent: resolveLeadingIndentMode(settings.textLeadingIndentFix),
			chat: this.getChatLogOptions(),
			// 序号与标题级别：只修不齐的地方（首项编号不是 1、父子标题差不止一级）
			listRenumber: settings.listRenumber,
			headingLevels: settings.headingLevelFix,
			// 智能公式：正文里的 `矩阵 A`、`n维`、`V(F)`、`x = 0` 自动套 `$…$`
			textMath: { wrapSymbols: settings.textMathWrapSymbols },
			mathLayout: settings.mathLayout,
			// 空格排版（排版格式）：中文 / 英文 / 数字 / 公式 / 标点之间的距离
			spacing: getSpacingOptions(settings),
			// 标签排版默认关闭（会挪动正文），关闭时整步跳过
			tags: settings.tagLayout ? { sort: settings.tagSort } : null,
			blockSort: settings.blockSort,
		};
	}

	/** 把插件设置转换为聊天记录排版选项 */
	private getChatLogOptions(): ChatLogOptions {
		const settings = this.getSettings();
		return {
			showUsername: settings.chatShowUsername,
			showDate: settings.chatShowDate,
			showTime: settings.chatShowTime,
			indent: resolveIndent(settings.chatIndent),
			imageOrder: settings.chatImageOrder,
			blankLineBetweenMessages: settings.chatBlankLineBetweenMessages,
			// 老 data.json 里没有这个字段 —— 当成开（默认值），用户不用手动打开就能拿到修复
			sortByTime: settings.chatSortByTime !== false,
			// 删正文的功能，只有明确打开才生效
			stripMentions: settings.chatStripMentions === true,
		};
	}

	/**
	 * 本次排版开启了哪几步 —— 结果提示里带一句。
	 * "为什么这篇没修"十有八九是某一项开关没开，先把它摆出来省得来回找。
	 */
	private describeLayoutSwitches(): string {
		const settings = this.getSettings();
		const enabled: string[] = [];
		if (resolveLeadingIndentMode(settings.textLeadingIndentFix) !== 'off') enabled.push('缩进与标记');
		enabled.push('聊天记录');
		if (settings.listRenumber) enabled.push('列表序号');
		if (settings.headingLevelFix) enabled.push('标题级别');
		if (settings.mathLayout) enabled.push('公式');
		if (settings.tagLayout) enabled.push(settings.tagSort ? '标签（含排序）' : '标签');
		if (settings.blockSort) enabled.push('板块排序');
		return `已开启：${enabled.join('、')}。`;
	}

	// ------------------------------------------------------------------ 共用外壳

	/**
	 * 逐篇处理 + 统一汇总（原 main.ts 的 runPerFile）。
	 *
	 * 单篇失败**不中断整批**：记下失败的篇数继续跑完，最后在提示里说明并打日志。
	 * 以前一篇读不出来就会把后面所有笔记都跳过 —— 表现为"整库没修、单篇能修"。
	 *
	 * @param handle 单篇处理函数，返回本篇产生的改动数量（0 表示没有变化）
	 * @param success 汇总消息，参数为改动总数、已处理篇数、失败篇数
	 * @param after 全部处理完成后的收尾工作（如统一修正链接格式）
	 */
	private async runPerFile(
		label: string,
		files: TFile[],
		handle: (file: TFile, ctx: BatchContext) => Promise<number>,
		success: (total: number, processed: number, failed: number) => string,
		after?: () => Promise<void>
	): Promise<void> {
		await this.runner.run(
			{ label, files, failureMessage: '❌ 处理中断，请检查控制台。', needsIndex: true },
			async (ctx) => {
				let total = 0;
				let processed = 0;
				let failed = 0;

				for (let i = 0; i < files.length; i++) {
					const file = files[i];
					if (file) {
						processed++;
						try {
							total += await handle(file, ctx);
						} catch (e) {
							// 单篇出错不拖垮整批：继续跑，最后一起汇报
							failed++;
							console.error(`❌ [ImageTransfer] ${file.path} 处理失败：`, e);
						}
					}
					ctx.progress.step(i + 1);
				}
				if (after) {
					await after();
				}

				let finalMsg: string;
				if (total > 0) {
					ctx.progress.finish('✅ 处理完成');
					finalMsg = success(total, processed, failed);
				} else {
					ctx.progress.clear();
					finalMsg = 'ℹ️ 没有需要处理的笔记。';
				}
				if (failed > 0) {
					finalMsg += `⚠️ 有 ${failed} 篇处理失败，详情见控制台。`;
				}
				return finalMsg;
			}
		);
	}
}
