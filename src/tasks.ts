import { App, Notice, TFile } from 'obsidian';
import type { BatchContext, BatchRunner } from './batch';
import { buildBasenameIndex } from './image/links';
import { buildVaultBasenameMap } from './image/naming';
import { organizeNoteImages } from './image/organize';
import { countImages, fixImageLinkFormats, renameGarbledImages, renameImagesToPreset } from './image/rename';
import { applyImageSize } from './image/size';
import type { ImageSizeOptions } from './image/size';
import { transferExternalImages } from './image/transfer';
import { resolveIndent } from './text/chat-log';
import type { ChatLogOptions } from './text/chat-log';
import { getSpacingOptions } from './settings';
import type { ImageTransferSettings } from './settings';
import { resolveLeadingIndentMode } from './text/indent';
import { formatNoteText } from './text/pipeline';
import type { TextPipelineOptions } from './text/pipeline';
import { ConfirmRenameModal } from './ui/confirm-rename-modal';
import { ImageSizeModal } from './ui/image-size-modal';
import type { StatusBarProgress } from './ui/progress';

/**
 * 任务编排（从 main.ts 抽出）。
 *
 * 命令面板、右键菜单、弹窗确认后三条路最终都落到这里，每种操作只有一份实现。
 * 每个任务都只管两件事：**这一批要做什么**、**结果怎么汇报**；
 * 互斥锁、通知屏蔽、进度、出错兜底都在 batch.ts 的壳里。
 */

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
	/** 修复排版（空格 / 缩进 / 聊天记录 / 标签 / 公式） */
	typeset(files: TFile[], where: string): Promise<void>;
}

export class ImageTasks implements TaskActions {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => ImageTransferSettings,
		private readonly runner: BatchRunner,
		private readonly progress: StatusBarProgress
	) {}

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
