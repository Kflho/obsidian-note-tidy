import type { Editor, MarkdownFileInfo, MarkdownView, Plugin, TFile } from 'obsidian';
import { Notice } from 'obsidian';
import type { ImageTransferSettings } from '../settings';
import type { PasteImage, TaskActions } from '../tasks';
import { PasteTakeoverHint, imageFilesFromClipboard, pastedImageName } from './paste-images';

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
 * 2. `editor-change`：粘贴落进编辑器了。把这一段（`[粘贴起点, 光标处)`）整个交给
 *    `ImageTasks.fixPastedRange`，由它按**各自的开关**做三件事（见 `pasteFixPlanFrom`）：
 *    **收图**（这段里的 `file:///D:\…` 外部图片复制进仓库、换成内部链接）、
 *    **排版**（像聊天记录就整段排；不像就一个字的正文都不改，只把整块缩进对齐到光标那一层 ——
 *    编辑器粘贴只把第一行放在光标那一列、其余行从第 0 列开始）、
 *    **套尺寸**（`|宽x高`）。三件事合并在**同一次写回**里，**不写盘**
 *    （走编辑器自己的保存路径），撤销一次一起回退，笔记其余部分一个字符都不动。
 * 3. 兜底定时器（`PASTE_FALLBACK_MS`）：编辑器迟迟没有变化（这次粘贴被别的插件吞了、
 *    视图不是 Markdown 视图……）就把这笔等待丢掉 —— 宁可什么都不做，也绝不去动整篇。
 *
 * ## 还有一笔：粘贴进来的图片套尺寸（`autoSetImageSizeOnPaste`）
 *
 * 同一段范围里的第三件事：把里面的图片按「图片大小」那套预设加上 `|宽x高`。
 * **我们自己的粘贴**由 `fixPastedRange` 顺手做掉（同一次写回）；**别人家的粘贴**
 * （Obsidian 自己存下的截图、别的插件插进来的图）由 `sizePastedRange` 单独做 ——
 * 那一段不归我们处理，就只补尺寸。
 *
 * 它与前两件事有两处不同，都是被"粘贴图片"这件事本身逼出来的：
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

/** 这次粘贴落在哪儿：哪个编辑器、从哪个字符偏移开始 */
export interface PasteTarget {
	editor: Editor;
	file: TFile;
	/** 粘贴起点（粘贴前选区 / 光标的字符偏移） */
	start: number;
}

export interface PasteFixSchedulerOptions {
	/** 时间到了 / 编辑器变了：把这一笔交给调用方（由它读回那段文字并收拾） */
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
 * 把剪贴板里的图片读成字节再交给任务层（`ImageTasks.pasteImages`）。
 *
 * 读不出来的那一张只打日志、跳过，其余照旧 —— 与导入那条路一个态度。
 * 这里**不 await**（事件处理器是同步的），但保证顺序：一张一张读、读完整批再写正文。
 */
async function pasteImagesFromClipboard(
	actions: TaskActions,
	file: TFile,
	editor: Editor,
	from: number,
	to: number,
	files: File[],
	text: string
): Promise<void> {
	const images: PasteImage[] = [];
	for (const file of files) {
		try {
			images.push({ name: pastedImageName(file), bytes: await file.arrayBuffer() });
		} catch (err) {
			console.error(`❌ 读不出剪贴板里的这张图: ${file.name}`, err);
		}
	}
	await actions.pasteImages(file, editor, from, to, images, text);
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
 * 注册粘贴相关的三笔（main.ts 调用）：
 *
 * 1. **粘贴图片由我们接管**（`takeOverImagePaste`，默认开）：剪贴板里带图片文件时自己存
 *    （见 `ui/paste-images.ts` 的文件头 —— 别的插件那条并发粘贴会丢图）；
 * 2. **粘贴后自动收拾这一段**（`ImageTasks.fixPastedRange`）：**收图**（`autoTransferImagesOnPaste`）、
 *    **排版**（`autoFixChatLogOnPaste`：像聊天记录就整段排，不像就只对齐整块缩进）、
 *    **套尺寸**（`autoSetImageSizeOnPaste`）三件事各认各的开关，一次写回；
 * 3. **别人家的粘贴只补尺寸**（`sizePastedRange`）：那一段不归我们处理。
 *
 * 后两笔共用同一套范围判定（`[粘贴起点, 光标处)`）。
 *
 * @param getSettings 开关实时读取（设置面板改完立刻生效，不用重载插件）
 */
export function registerPasteAutoFix(
	plugin: Plugin,
	actions: TaskActions,
	getSettings: () => ImageTransferSettings
): void {
	// 文本那一笔：粘贴落进编辑器后把"刚粘的那一段"整个交给任务层
	// （收图 / 排版 / 套尺寸三件事各自认开关，见 `pasteFixPlanFrom`；三件事全关时任务自己立刻返回）
	const pendingTextFix: { target: PasteTarget | null } = { target: null };
	const scheduler = new PasteFixScheduler({ take: (target) => { pendingTextFix.target = target; } });
	plugin.register(() => { scheduler.dispose(); });

	// 尺寸那一笔：观望式（见 PasteSizeWatcher），与文本修复互不影响
	const sizeWatcher = new PasteSizeWatcher();
	plugin.register(() => { sizeWatcher.dispose(); });

	// 「这次粘贴被别人抢走了」的提醒（一次会话一次）：见 `PasteTakeoverHint`
	const takeoverHint = new PasteTakeoverHint(message => { new Notice(message); });

	// ① 粘贴：先看这次粘贴里有没有图片文件 —— 有就是**我们的活**（自己存图 + 写正文），
	//    没有才回到"只看一眼粘在哪儿、等编辑器变化"那套观察者路子。
	const handlePaste = (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo): void => {
		const file = info.file ?? null;
		if (!file) return;

		const start = Math.min(offsetOf(editor, 'from'), offsetOf(editor, 'to'));
		const takeover = getSettings().takeOverImagePaste !== false;
		const clipboardImages = takeover ? imageFilesFromClipboard(evt.clipboardData) : [];

		// 图片被别的插件抢走了（它已经 preventDefault）：我们不重复处理（那会存两份），
		// 但一次粘多张时要提醒一句 —— 它那条路会撞名丢图，而让开它的开关在它自己设置里。
		// 只粘一张时不唠叨：那条路单张是好的（没撞名可言），提示只会变成噪音
		if (takeover && evt.defaultPrevented && clipboardImages.length > 1) {
			takeoverHint.maybeShow();
		}

		// 粘贴图片：剪贴板里带图片文件时我们自己来（`takeOverImagePaste`，默认开）。
		// 别的插件的自动粘贴是并发跑的，一次粘多张会算出同一个输出名、后写的直接丢图
		// （2026-09 用户实测"粘两张只剩第一张"），所以这件事得由一张一张来的我们做。
		// 前提：这次粘贴**没人管**、开关开着。接下来尺寸与排版都在 `pasteImages` 里
		// 顺着做掉，不再走下面那两笔。
		if (!evt.defaultPrevented && clipboardImages.length > 0) {
			evt.preventDefault();
			const to = Math.max(offsetOf(editor, 'from'), offsetOf(editor, 'to'));
			const text = evt.clipboardData?.getData('text/plain') ?? '';
			void pasteImagesFromClipboard(actions, file, editor, start, to, clipboardImages, text);
			return;
		}

		// 图片尺寸这一笔**谁接管这次粘贴都要跟着**：别的插件会 preventDefault 自己
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
		const fixTarget = pendingTextFix.target as PasteTarget | null;
		const sizeTarget = sizeWatcher.onEditorChange(editor, file);

		// 我们自己的粘贴：整段交给任务层（收图 / 排版 / 套尺寸各认开关，一次写回）。
		// 尺寸那一笔也归它 —— 它已经看过这一段的图片，不必再单独跑一遍
		if (textHit && fixTarget) {
			void actions.fixPastedRange(fixTarget.file, fixTarget.editor, fixTarget.start);
			return;
		}
		if (sizeTarget) void actions.sizePastedRange(sizeTarget.editor, sizeTarget.start);
	};

	plugin.registerEvent(plugin.app.workspace.on('editor-change', handleEditorChange));
}
