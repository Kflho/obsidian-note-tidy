import type { Editor, MarkdownFileInfo, MarkdownView, Plugin, TFile } from 'obsidian';
import type { ImageTransferSettings } from '../settings';
import type { TaskActions } from '../tasks';
import { looksLikeChatLog } from '../text/chat-log';

/**
 * 粘贴聊天记录时自动修好 —— **只修刚粘进来的那一段**（设置里可开关，见 `autoFixChatLogOnPaste`）。
 *
 * ## 为什么不再修整篇
 *
 * 整篇排版绕不开一个取舍：*一条消息的正文到哪儿结束*。作者自己接在消息下面写的行
 * （`06集` 这类小标题、自己插的截图）与消息正文之间没有空行时，整篇排版只能把它们算作正文
 * —— 猜过两次都猜错（见 `structure.chat-log` 的登记说明）。
 *
 * 而"刚粘进来的那一段"是**确定的**：粘贴开始时记下光标位置，粘贴落进编辑器后，
 * 从那个位置到光标之间的就是这次粘贴进文档的全部内容。于是不需要猜，也不会碰到
 * 你自己写的东西。
 *
 * ## 三步
 *
 * 1. `editor-paste`：只登记（那时内容还没进文档 —— Obsidian 的剪贴板管理器发这个事件，
 *    真正插入内容的是 CodeMirror 的处理器，排在我们后面）。不阻止这次粘贴。
 * 2. `editor-change`：粘贴落进编辑器了。读回那一段文字，用排版引擎自己的尺子
 *    （`looksLikeChatLog`）判定"像不像聊天记录"，像才动手：转换这段里的外部路径图片 → 排版
 *    → `editor.replaceRange` 写回。**不写盘**（走编辑器自己的保存路径），
 *    撤销一次即可回退，笔记其余部分一个字符都不动。
 * 3. 兜底定时器（`PASTE_FALLBACK_MS`）：编辑器迟迟没有变化（这次粘贴被别的插件吞了、
 *    视图不是 Markdown 视图……）就把这笔等待丢掉 —— 宁可什么都不做，也绝不去动整篇。
 */

/** 等待表里这一笔的最长寿命：到点还没等到编辑器变化就丢掉 */
export const PASTE_FALLBACK_MS = 5000;

/** 该不该因为这次粘贴自动修复：开关开着、有笔记、粘贴进来的这段像聊天记录 */
export function shouldAutoFixPaste(options: { enabled: boolean; text: string; hasFile: boolean }): boolean {
	if (!options.enabled || !options.hasFile) return false;
	return looksLikeChatLog(options.text);
}

/** 这次粘贴落在哪儿：哪个编辑器、从哪个字符偏移开始 */
export interface PasteTarget {
	editor: Editor;
	file: TFile;
	/** 粘贴起点（粘贴前选区 / 光标的字符偏移） */
	start: number;
}

export interface PasteFixSchedulerOptions {
	/** 时间到了 / 编辑器变了：把这一笔交给调用方（由它读回那段文字并决定修不修） */
	take: (target: PasteTarget) => void;
	/** 兜底时长，默认 `PASTE_FALLBACK_MS` */
	fallbackMs?: number;
	/** 定时器（测试里换成手动控制） */
	setTimer?: (handler: () => void, ms: number) => number;
	clearTimer?: (id: number) => void;
}

/**
 * "刚粘过、等着修"的等待表（按笔记路径记，一篇只留最后一笔）。
 *
 * 一笔等待只有两种下场：编辑器真的变了（`onEditorChange` → 取出交给调用方），
 * 或者超时（兜底定时器 → 直接丢掉）。**摘掉之后才回调** —— 我们自己的
 * `replaceRange` 也会触发 `editor-change`，不摘就会自己触发自己。
 */
export class PasteFixScheduler {
	private readonly pending = new Map<string, { target: PasteTarget; timer: number }>();
	private readonly take: (target: PasteTarget) => void;
	private readonly fallbackMs: number;
	private readonly setTimer: (handler: () => void, ms: number) => number;
	private readonly clearTimer: (id: number) => void;

	constructor(options: PasteFixSchedulerOptions) {
		this.take = options.take;
		this.fallbackMs = options.fallbackMs ?? PASTE_FALLBACK_MS;
		this.setTimer = options.setTimer ?? ((handler, ms) => window.setTimeout(handler, ms));
		this.clearTimer = options.clearTimer ?? ((id) => { window.clearTimeout(id); });
	}

	/** 还在等编辑器变化的笔数（测试与调试用） */
	get size(): number {
		return this.pending.size;
	}

	/** 记下"刚往这篇笔记里粘了东西"：等编辑器变化，再交出这一笔 */
	schedule(target: PasteTarget): void {
		this.forget(target.file.path);
		const timer = this.setTimer(() => { this.forget(target.file.path); }, this.fallbackMs);
		this.pending.set(target.file.path, { target, timer });
	}

	/**
	 * 编辑器里的内容变了：是等着的那篇就把这一笔交出去（返回是否命中）。
	 *
	 * @param editor 变化的那个编辑器实例；与登记时不是同一个（换了面板 / 弹出窗口）则不放行，
	 *   免得拿着别处的偏移去改这篇笔记
	 */
	onEditorChange(editor: Editor, file: TFile): boolean {
		const entry = this.pending.get(file.path);
		if (!entry) return false;
		if (entry.target.editor !== editor) return false;
		this.forget(file.path);
		this.take(entry.target);
		return true;
	}

	/** 插件卸载：清掉所有等待，卸载之后不再动手 */
	dispose(): void {
		for (const path of [...this.pending.keys()]) {
			this.forget(path);
		}
	}

	/** 撤销一笔等待（连同它的兜底定时器） */
	private forget(path: string): void {
		const entry = this.pending.get(path);
		if (!entry) return;
		this.pending.delete(path);
		this.clearTimer(entry.timer);
	}
}

/** 光标/选区在编辑器里的字符偏移（不好取时按 0 算：那一段会读成空，等于不修） */
function offsetOf(editor: Editor, which: 'from' | 'to'): number {
	try {
		return editor.posToOffset(editor.getCursor(which));
	} catch {
		return 0;
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
	const fixNow = (target: PasteTarget): void => {
		const end = offsetOf(target.editor, 'to');
		if (end <= target.start) return;

		const text = target.editor.getRange(
			target.editor.offsetToPos(target.start),
			target.editor.offsetToPos(end)
		);

		// 判定用的是**真正插进文档的那段文字**（不是剪贴板里的），与排版引擎看到的是同一份
		const enabled = getSettings().autoFixChatLogOnPaste === true;
		if (!shouldAutoFixPaste({ enabled, text, hasFile: true })) return;

		void actions.fixPastedRange(target.file, target.editor, target.start);
	};

	const scheduler = new PasteFixScheduler({ take: fixNow });
	plugin.register(() => { scheduler.dispose(); });

	// ① 粘贴：只看一眼"粘在哪儿"，不判定也不动手（此刻内容还没进文档）；
	//    处理函数是**具名函数**：它是观察者，故意不 preventDefault ——
	//    那会把这次粘贴整个吞掉，而我们要的恰恰是"粘进去之后顺手修好"。
	//    `evt.defaultPrevented` 要看：别的插件已经接管了这次粘贴，我们就不凑热闹了。
	const handlePaste = (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		if (evt.defaultPrevented) return;

		const file = info.file ?? null;
		if (!file) return;

		const start = Math.min(offsetOf(editor, 'from'), offsetOf(editor, 'to'));
		scheduler.schedule({ editor, file, start });
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-paste', handlePaste));

	// ② 粘贴落进编辑器：正是等着的那一篇就把刚粘的那段交出去修
	const handleEditorChange = (editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		const file = info.file ?? null;
		if (file) scheduler.onEditorChange(editor, file);
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-change', handleEditorChange));
}
