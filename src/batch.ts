import { App, Notice, TFile } from 'obsidian';
import { buildBasenameIndex } from './image/links';
import type { NoticeSuppressor } from './ui/notice-suppressor';
import type { StatusBarProgress } from './ui/progress';

/**
 * 批量处理外壳（从 main.ts 抽出）。
 *
 * 九条批量入口（命令面板 / 右键菜单 / 弹窗确认后）共用同一套壳：
 * **互斥锁 + 通知屏蔽 + 状态栏进度 + 出错兜底 + 结果通知**。
 * 以前每个入口各抄一份，加一个功能就要再抄一遍，改一处忘一处。
 *
 * 各入口自己的差异只有三样，都由参数表达：进度标签、出错提示语、要不要全库文件名索引。
 */

/** 交给批量体的运行环境 */
export interface BatchContext {
	app: App;
	/** 本批次的全库文件名索引（`needsIndex` 为 true 时才是真的建立了；否则为空表） */
	index: Map<string, TFile[]>;
	/** 进度显示 */
	progress: BatchProgress;
}

/** 进度显示的门面：把「第几篇 / 共几篇 / 标签」收在一处，批量体只管报数 */
export interface BatchProgress {
	/** 显示第 current 篇 */
	step(current: number): void;
	/** 完成：显示结果，5 秒后清空 */
	finish(message: string): void;
	/** 没有改动 / 出错：立刻清空 */
	clear(): void;
}

export interface BatchOptions {
	/** 状态栏进度标签，如 `📷 图片重命名` */
	label: string;
	/** 参与处理的笔记 */
	files: TFile[];
	/** 整个批次崩掉时的提示语（单篇出错由批量体自己决定要不要兜） */
	failureMessage: string;
	/** 是否建立全库文件名索引（只有需要解析图片链接的任务才要，见 image/links.ts） */
	needsIndex?: boolean;
}

export class BatchRunner {
	private busy = false;

	constructor(
		private readonly app: App,
		private readonly progress: StatusBarProgress,
		private readonly notices: NoticeSuppressor
	) {}

	/** 是否有任务正在执行（命令回调可以据此提前让路） */
	get isBusy(): boolean {
		return this.busy;
	}

	/**
	 * 跑一次批量任务。
	 *
	 * @param options 进度标签、参与文件、出错提示语、是否建索引
	 * @param body 批量体：自己决定单篇出错怎么处理、怎么汇总，返回最终提示语（空串则不提示）
	 */
	async run(options: BatchOptions, body: (ctx: BatchContext) => Promise<string>): Promise<void> {
		if (this.busy) {
			new Notice('⚠️ 已有重命名/转换任务在执行中，请等待完成后再试。');
			return;
		}
		this.busy = true;
		this.notices.suppress();

		const total = options.files.length;
		const index = options.needsIndex ? buildBasenameIndex(this.app) : new Map<string, TFile[]>();
		let finalMsg = '';

		try {
			// 没有参与文件时不动状态栏：省得留下一个"0/0"没人清（见 transferCurrentNote 的没开笔记分支）
			if (total > 0) this.progress.show(0, total, options.label);
			finalMsg = await body({
				app: this.app,
				index,
				progress: {
					step: (current: number) => this.progress.show(current, total, options.label),
					finish: (message: string) => this.progress.finish(message),
					clear: () => this.progress.clear(),
				},
			});
		} catch (e) {
			this.progress.clear();
			console.error(e);
			finalMsg = options.failureMessage;
		} finally {
			this.notices.restore(finalMsg);
			this.busy = false;
		}
	}
}
