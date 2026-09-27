import { MarkdownView, TFile } from 'obsidian';
import type { App, Editor, MarkdownFileInfo, Plugin } from 'obsidian';
import type { ImageTransferSettings } from '../settings';
import type { TaskActions } from '../tasks';
import { looksLikeChatLog } from '../text/chat-log';

/**
 * 粘贴聊天记录时自动执行「快速修复聊天记录」（设置里可开关，见 `autoFixChatLogOnPaste`）。
 *
 * ## 为什么挂在 `editor-paste` 上
 *
 * Obsidian 有官方的 `editor-paste` 事件（粘贴时把 `ClipboardEvent` 与视图一起交给我们），
 * 不用自己接 DOM 的 paste，也不会像"接管 Ctrl+C"那样抢按键：我们**不阻止这次粘贴**，
 * 只是看一眼剪贴板里的纯文本像不像聊天记录。
 *
 * ## 时机：粘贴那一刻不动手，落进编辑器那一刻催落盘，落盘了才动手
 *
 * 一、**粘贴那一刻读到的正文还是旧的**。`editor-paste` 是 Obsidian 的剪贴板管理器在自己的
 * paste 处理器里发出的，而真正往文档里插内容是 CodeMirror 内置的处理器（排在后面，一返回 true
 * 就 break）—— 此刻读到的正文里还没有刚粘进来的东西。此刻修完写盘，要么白修，要么被编辑器
 * 随后的保存覆盖回去（"改了又弹回去"）。
 *
 * 二、**不能干等 Obsidian 的自动保存**。`vault` 的 `modify` 确实是"能动手"的信号（那一刻磁盘上
 * 才是含粘贴内容的正文），但 Obsidian 的自动保存是**停手 2 秒后**（`TextFileView.requestSave`
 * 的 debounce 就是 2000 毫秒）—— 干等它，用户看到的就是"粘完一两秒才修好"。
 * 所以中间加了一步：内容一落进编辑器（`editor-change`）就调 `view.save()` 把这篇笔记
 * **立刻**写盘，`modify` 随之而来，修复几乎与粘贴同时发生。
 *
 * 三、**万一没人落盘**（这次粘贴被别的插件吞了、视图不是 Markdown 视图……）还有兜底定时器
 * （`PASTE_FALLBACK_MS`）：宁可多跑一次"没有需要修复的内容"，也不要静悄悄地什么都不做。
 *
 * ## 判定与"真去修"分开
 *
 * - `looksLikeChatLog`（`text/chat-log.ts`）：像不像聊天记录，用的是排版引擎自己的尺子；
 * - `shouldAutoFixPaste`：开关 + 有笔记 + 像聊天记录，三条都满足才动手；
 * - `PasteFixScheduler`：谁在等、什么时候催落盘、什么时候真跑（定时器可注入，测试里手动控制）。
 */

/** 等落盘的兜底时长：编辑器一直没把这次粘贴写下去就按这个时间先跑一次 */
export const PASTE_FALLBACK_MS = 5000;

/** 该不该因为这次粘贴自动修复：开关开着、有笔记、粘贴内容像聊天记录 */
export function shouldAutoFixPaste(options: { enabled: boolean; text: string; hasFile: boolean }): boolean {
	if (!options.enabled || !options.hasFile) return false;
	return looksLikeChatLog(options.text);
}

export interface PasteFixSchedulerOptions {
	/** 真正去修（任务的 `quickFixChatLog`） */
	run: (file: TFile) => void;
	/** 催这篇笔记立刻落盘（`MarkdownView.save()`），落盘后才有 `modify` 可等 */
	flush: (file: TFile) => void;
	/** 等不到落盘时的兜底时长，默认 `PASTE_FALLBACK_MS` */
	fallbackMs?: number;
	/** 定时器（测试里换成手动控制） */
	setTimer?: (handler: () => void, ms: number) => number;
	clearTimer?: (id: number) => void;
}

/**
 * "粘贴之后修哪篇笔记"的等待表。
 *
 * 一笔等待走过三步：`schedule`（粘贴，只登记）→ `onEditorChange`（内容落地，催落盘）
 * → `onModified`（落盘，真去修）。
 *
 * 同一篇笔记连着粘两次只留最后一笔（编辑器会把两次粘贴一起存盘，跑一次就够）；
 * 真跑之前先把这一笔从表里删掉 —— 我们自己写盘也会触发 `modify`，
 * 不删就会自己把自己再触发一次。
 */
export class PasteFixScheduler {
	private readonly pending = new Map<string, { file: TFile; timer: number; flushed: boolean }>();
	private readonly run: (file: TFile) => void;
	private readonly flush: (file: TFile) => void;
	private readonly fallbackMs: number;
	private readonly setTimer: (handler: () => void, ms: number) => number;
	private readonly clearTimer: (id: number) => void;

	constructor(options: PasteFixSchedulerOptions) {
		this.run = options.run;
		this.flush = options.flush;
		this.fallbackMs = options.fallbackMs ?? PASTE_FALLBACK_MS;
		this.setTimer = options.setTimer ?? ((handler, ms) => window.setTimeout(handler, ms));
		this.clearTimer = options.clearTimer ?? ((id) => { window.clearTimeout(id); });
	}

	/** 还在等落盘的笔记数（测试与调试用） */
	get size(): number {
		return this.pending.size;
	}

	/** 记下"这篇笔记刚粘了聊天记录"：等内容落地、落盘，再修 */
	schedule(file: TFile): void {
		this.forget(file.path);
		const timer = this.setTimer(() => { this.fire(file.path); }, this.fallbackMs);
		this.pending.set(file.path, { file, timer, flushed: false });
	}

	/**
	 * 编辑器里的内容真的变了（粘贴落进去了）：催它立刻落盘，别再等那 2 秒的自动保存。
	 * 同一笔只催一次 —— 用户粘完接着打字会连着触发，催第二遍没有意义。
	 *
	 * @returns 是否真的催了（没有这笔等待、或已经催过，都返回 false）
	 */
	onEditorChange(file: TFile): boolean {
		const entry = this.pending.get(file.path);
		if (!entry || entry.flushed) return false;
		entry.flushed = true;
		this.flush(entry.file);
		return true;
	}

	/** 文件落盘了：正是等着的那篇就立刻修（返回是否命中） */
	onModified(file: TFile): boolean {
		if (!this.pending.has(file.path)) return false;
		this.fire(file.path);
		return true;
	}

	/** 插件卸载：清掉所有等待，卸载之后不再去写仓库 */
	dispose(): void {
		for (const path of [...this.pending.keys()]) {
			this.forget(path);
		}
	}

	/** 真的跑一次（先从表里删掉，免得我们自己的写盘又把它触发一遍） */
	private fire(path: string): void {
		const entry = this.pending.get(path);
		if (!entry) return;
		this.forget(path);
		this.run(entry.file);
	}

	/** 撤销一笔等待（连同它的兜底定时器） */
	private forget(path: string): void {
		const entry = this.pending.get(path);
		if (!entry) return;
		this.pending.delete(path);
		this.clearTimer(entry.timer);
	}
}

/**
 * 催这篇笔记立刻落盘。
 *
 * 同一篇笔记可能开着好几个视图（分屏），干净的那几份 `save()` 自己会早退（内容没变不写盘），
 * 所以不用挑哪一份是"刚粘过的那份"。
 *
 * 失败不用我们操心：Obsidian 会打日志并弹"保存失败"的通知，这里再吵一次只会重复。
 */
function saveViewsOf(app: App, file: TFile): void {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.file?.path === file.path) {
			void view.save().catch(() => undefined);
		}
	}
}

/**
 * 注册"粘贴聊天记录时自动修复"（main.ts 调用）。
 *
 * @param getSettings 开关实时读取（设置面板改完立刻生效，不用重载插件）
 */
export function registerPasteAutoFix(
	plugin: Plugin,
	actions: TaskActions,
	getSettings: () => ImageTransferSettings
): void {
	const scheduler = new PasteFixScheduler({
		run: (file) => { void actions.quickFixChatLog(file); },
		flush: (file) => { saveViewsOf(plugin.app, file); },
	});
	plugin.register(() => { scheduler.dispose(); });

	// ① 粘贴：只看剪贴板里的纯文本，不像聊天记录就一个字节都不碰（这次粘贴照常进行）
	//
	// 处理函数单独写成一个具名函数：**它是观察者，不是接管者** ——
	// 我们故意不 `preventDefault()`，那会把这次粘贴整个吞掉（内容根本进不了笔记），
	// 而我们要的恰恰是"粘进去之后顺手修好"。`evt.defaultPrevented` 倒是要看：
	// 别的插件已经接管了这次粘贴，我们就不凑热闹了。
	const handlePaste = (evt: ClipboardEvent, _editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		if (evt.defaultPrevented) return;

		const file = info.file ?? null;
		const text = evt.clipboardData?.getData('text/plain') ?? '';
		const enabled = getSettings().autoFixChatLogOnPaste === true;
		if (!shouldAutoFixPaste({ enabled, text, hasFile: file !== null })) return;
		if (file) scheduler.schedule(file);
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-paste', handlePaste));

	// ② 粘贴落进编辑器：催这篇笔记立刻写盘（默认要等停手 2 秒，见模块头注释）
	const handleEditorChange = (_editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		const file = info.file ?? null;
		if (file) scheduler.onEditorChange(file);
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-change', handleEditorChange));

	// ③ 落盘：编辑器把这次粘贴写进文件之后才动手（这时正文里才有刚粘的内容）
	plugin.registerEvent(
		plugin.app.vault.on('modify', (file) => {
			if (file instanceof TFile) scheduler.onModified(file);
		})
	);
}
