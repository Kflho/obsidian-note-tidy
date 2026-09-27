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
 *
 * ## 还有一笔：粘贴进来的图片套尺寸（`autoSetImageSizeOnPaste`）
 *
 * 同一段范围再干一件事：把里面的图片按「图片大小」那套预设加上 `|宽x高`。它与文本修复
 * **共用一次写回**（`fixPastedRange` 内部顺手做掉），文本不像聊天记录时则由
 * `sizePastedRange` 单独做 —— 粘一张截图本来就没有"像不像聊天记录"这一说。
 *
 * 它与文本修复有两处不同，都是被"粘贴图片"这件事本身逼出来的：
 *
 * - **别的插件接管了也要跟着**：Image Converter 会 `preventDefault` 自己处理图片文件，
 *   但它同样把图片存进仓库、把链接插进正文 —— 那正是要套尺寸的图片；
 * - **要盯着看一会儿**（`PasteSizeWatcher`）：一次粘贴可能分几次落进编辑器（粘贴多张图时
 *   逐张存盘 / 转码，每存好一张才插一条链接），所以粘贴后几秒内每变一次就再看一眼。
 */

/** 等待表里这一笔的最长寿命：到点还没等到编辑器变化就丢掉 */
export const PASTE_FALLBACK_MS = 5000;

/** 「粘贴的图片套尺寸」那一笔：编辑器安静这么久（一直没人动）就丢掉 */
export const PASTE_SIZE_IDLE_MS = 5000;

/** 那一笔的总寿命上限：一直有人在改也总有个头，免得用户随手打字把它一直续下去 */
export const PASTE_SIZE_MAX_MS = 20000;

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

export interface PasteSizeWatcherOptions {
	/** 编辑器安静多久就把这笔丢掉，默认 `PASTE_SIZE_IDLE_MS` */
	idleMs?: number;
	/** 一笔观望的总寿命，默认 `PASTE_SIZE_MAX_MS` */
	maxMs?: number;
	/** 定时器（测试里换成手动控制） */
	setTimer?: (handler: () => void, ms: number) => number;
	clearTimer?: (id: number) => void;
	/** 取当前时刻（只用来算总寿命；测试里注入假时钟） */
	now?: () => number;
}

/**
 * 「粘贴进来的图片要套尺寸」的观望表（按笔记路径记，一篇只留最后一笔）。
 *
 * 为什么不像文本修复那样"一笔只做一次"：**一次粘贴可能分好几次落进编辑器** ——
 * 粘贴多张图时 Obsidian（或 Image Converter）逐张存盘 / 转码，每存好一张才插一条链接。
 * 第一笔 `editor-change` 只看得到第一张，一笔即摘的话后面几张就漏了。
 *
 * 所以改成"观望"：粘贴后每变一次就把 `[起点, 光标处)` 交出去一次（重复跑是幂等的 ——
 * 已经有尺寸的图片不会再动），编辑器安静 `idleMs` 才丢掉；总寿命不超过 `maxMs`，
 * 免得用户随手打字把这笔观望一直续下去。**摘掉之后才回调**这件事在这里同样成立：
 * 调用方要拿它返回的 target 去异步改正文，而改正文又会触发 `editor-change`。
 */
export class PasteSizeWatcher {
	private readonly pending = new Map<string, { target: PasteTarget; timer: number; startedAt: number }>();
	private readonly idleMs: number;
	private readonly maxMs: number;
	private readonly setTimer: (handler: () => void, ms: number) => number;
	private readonly clearTimer: (id: number) => void;
	private readonly now: () => number;

	constructor(options: PasteSizeWatcherOptions = {}) {
		this.idleMs = options.idleMs ?? PASTE_SIZE_IDLE_MS;
		this.maxMs = options.maxMs ?? PASTE_SIZE_MAX_MS;
		this.setTimer = options.setTimer ?? ((handler, ms) => window.setTimeout(handler, ms));
		this.clearTimer = options.clearTimer ?? ((id) => { window.clearTimeout(id); });
		this.now = options.now ?? (() => Date.now());
	}

	/** 还在观望的笔数（测试与调试用） */
	get size(): number {
		return this.pending.size;
	}

	/** 记下"刚往这篇笔记里粘了东西"：后面的每一次编辑器变化都再看一眼 */
	schedule(target: PasteTarget): void {
		this.forget(target.file.path);
		const entry = { target, timer: 0, startedAt: this.now() };
		this.pending.set(target.file.path, entry);
		this.arm(target.file.path, entry);
	}

	/**
	 * 编辑器里的内容变了：是等着的那篇就续一次时，并把这一笔交出去（返回是否命中）。
	 *
	 * 与文本修复的等待表同一套判定：笔记对不上、编辑器实例对不上（换了面板 / 弹出窗口）
	 * 都不放行 —— 免得拿着别处的偏移去改这篇笔记。
	 */
	onEditorChange(editor: Editor, file: TFile): PasteTarget | null {
		const entry = this.pending.get(file.path);
		if (!entry || entry.target.editor !== editor) return null;

		// 总寿命到点：这笔观望作废（用户可能已经在别处打字了，别再跟着他改）
		if (this.now() - entry.startedAt > this.maxMs) {
			this.forget(file.path);
			return null;
		}

		this.arm(file.path, entry);
		return entry.target;
	}

	/** 插件卸载：清掉所有观望，卸载之后不再动手 */
	dispose(): void {
		for (const path of [...this.pending.keys()]) {
			this.forget(path);
		}
	}

	/** 重新计时（每一次编辑器变化都算"还在动"） */
	private arm(path: string, entry: { timer: number }): void {
		this.clearTimer(entry.timer);
		entry.timer = this.setTimer(() => { this.forget(path); }, this.idleMs);
	}

	/** 撤销一笔观望（连同它的定时器） */
	private forget(path: string): void {
		const entry = this.pending.get(path);
		if (!entry) return;
		this.pending.delete(path);
		this.clearTimer(entry.timer);
	}
}

/**
 * 注册"粘贴时自动修好"（main.ts 调用）：文本修复（`autoFixChatLogOnPaste`）与
 * 粘贴图片套尺寸（`autoSetImageSizeOnPaste`）两笔，共用同一套范围判定。
 *
 * @param getSettings 开关实时读取（设置面板改完立刻生效，不用重载插件）
 */
export function registerPasteAutoFix(
	plugin: Plugin,
	actions: TaskActions,
	getSettings: () => ImageTransferSettings
): void {
	// 文本修复那一笔：命中时先把"这段像不像聊天记录"判掉，再由 handleEditorChange 串起来跑。
	// 判定结果先放进这个槽里（`take` 是同步回调，返回后就能取到）
	const pendingTextFix: { target: PasteTarget | null } = { target: null };
	const textFixFor = (target: PasteTarget): PasteTarget | null => {
		const end = offsetOf(target.editor, 'to');
		if (end <= target.start) return null;

		const text = target.editor.getRange(
			target.editor.offsetToPos(target.start),
			target.editor.offsetToPos(end)
		);

		// 判定用的是**真正插进文档的那段文字**（不是剪贴板里的），与排版引擎看到的是同一份
		const enabled = getSettings().autoFixChatLogOnPaste === true;
		return shouldAutoFixPaste({ enabled, text, hasFile: true }) ? target : null;
	};

	const scheduler = new PasteFixScheduler({ take: (target) => { pendingTextFix.target = textFixFor(target); } });
	plugin.register(() => { scheduler.dispose(); });

	// 尺寸那一笔：观望式（见 PasteSizeWatcher），与文本修复互不影响
	const sizeWatcher = new PasteSizeWatcher();
	plugin.register(() => { sizeWatcher.dispose(); });

	// ① 粘贴：只看一眼"粘在哪儿"，不判定也不动手（此刻内容还没进文档）；
	//    处理函数是**具名函数**：它是观察者，故意不 preventDefault ——
	//    那会把这次粘贴整个吞掉，而我们要的恰恰是"粘进去之后顺手修好"。
	const handlePaste = (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		const file = info.file ?? null;
		if (!file) return;

		const start = Math.min(offsetOf(editor, 'from'), offsetOf(editor, 'to'));

		// 图片尺寸这一笔**谁接管这次粘贴都要跟着**：Image Converter 会 preventDefault 自己
		// 处理剪贴板里的图片文件，但它同样把图片存进仓库、把链接插进正文 —— 那正是要套尺寸的图片
		if (getSettings().autoSetImageSizeOnPaste === true) {
			sizeWatcher.schedule({ editor, file, start });
		}

		// 文本修复不一样：别的插件已经接管了这次粘贴就不凑热闹
		// （插进来的不一定是剪贴板里那些内容，拿去排版没有道理）
		if (evt.defaultPrevented) return;
		scheduler.schedule({ editor, file, start });
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-paste', handlePaste));

	// ② 粘贴落进编辑器：正是等着的那一篇就把刚粘的那段交出去
	const handleEditorChange = (editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		const file = info.file ?? null;
		if (!file) return;

		pendingTextFix.target = null;
		const textHit = scheduler.onEditorChange(editor, file);
		// `take` 是同步回调：上面这一句返回时槽里已经放好了结果。
		// （断言是因为 TS 的控制流分析看不到回调里的赋值，直接读会窄化成 null）
		const textFix = pendingTextFix.target as PasteTarget | null;
		const sizeTarget = sizeWatcher.onEditorChange(editor, file);

		if (textHit && textFix) {
			// 文本修复内部顺带把尺寸也套上（两步共用一次写回），这里不再单独跑一遍；
			// 尺寸那笔观望刚才已经续过时了 —— 后面几张图落进来时还要靠它
			void actions.fixPastedRange(textFix.file, textFix.editor, textFix.start);
			return;
		}
		if (sizeTarget) void actions.sizePastedRange(sizeTarget.editor, sizeTarget.start);
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-change', handleEditorChange));
}
