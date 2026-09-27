/**
 * 粘贴聊天记录时自动修复（`src/ui/paste-watch.ts`）
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 判定：开关 + 有笔记 + **粘进来的那段**像聊天记录，三条都满足才动手
 *   2. 范围：只修"粘贴起点 → 光标处"这一段，不碰笔记其余部分
 *   3. 时机：`editor-paste` 那一刻不动手（内容还没进文档），`editor-change` 才动手
 *   4. 等待表：一篇只留最后一笔、取出后才回调（免得自己触发自己）、兜底丢掉、卸载清空
 *   5. 接线：`registerPasteAutoFix` 只接 `editor-paste` / `editor-change`（不再等 `vault.modify`）
 *
 * 另有「粘贴的图片套尺寸」那一笔（`autoSetImageSizeOnPaste`）：它是**观望式**的
 * （`PasteSizeWatcher`），因为一次粘贴可能分几次落进编辑器（粘贴多张图逐张存盘 /
 * Image Converter 逐张转码），而且别的插件接管了这次粘贴时它照样要跟着。
 */
import { TFile } from "obsidian";
import type { Editor, Plugin } from "obsidian";
import type { ImageTransferSettings } from "../src/settings/model";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { TaskActions } from "../src/tasks";
import {
	PASTE_FALLBACK_MS,
	PASTE_SIZE_MAX_MS,
	PasteFixScheduler,
	PasteSizeWatcher,
	registerPasteAutoFix,
	shouldAutoFixPaste,
} from "../src/ui/paste-watch";
import type { PasteTarget } from "../src/ui/paste-watch";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail = ""): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

/** Node 下没有 window：默认定时器给个空实现（兜底那条路由假定时器单独测） */
function installDomStubs(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	globals.window = {
		setTimeout: (): number => 0,
		clearTimeout: (): void => undefined,
	};
}

const CHAT_LOG = "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的";
const PLAIN_TEXT = "这是一段普通笔记，没有任何时间戳。";

function fileOf(path: string): TFile {
	return Object.assign(new TFile(), { path, name: path, extension: "md" });
}

// -------------------------------------------------------------- 1. 判定
function gateTests(): void {
	checkTrue("开关开着 + 有笔记 + 像聊天记录 → 动手",
		shouldAutoFixPaste({ enabled: true, text: CHAT_LOG, hasFile: true }), "");
	checkTrue("开关关掉 → 不动手",
		!shouldAutoFixPaste({ enabled: false, text: CHAT_LOG, hasFile: true }), "");
	checkTrue("没有笔记 → 不动手",
		!shouldAutoFixPaste({ enabled: true, text: CHAT_LOG, hasFile: false }), "");
	checkTrue("不像聊天记录 → 不动手",
		!shouldAutoFixPaste({ enabled: true, text: PLAIN_TEXT, hasFile: true }), "");
	checkTrue("空粘贴 → 不动手",
		!shouldAutoFixPaste({ enabled: true, text: "", hasFile: true }), "");
}

// -------------------------------------------------- 2. 等待表（范围、时机与兜底）
/** 手动定时器：什么时候触发由测试说了算 */
function fakeTimers(): {
	setTimer: (handler: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
	fireAll: () => void;
	count: () => number;
	lastDelay: () => number;
} {
	const timers = new Map<number, () => void>();
	let next = 1;
	let delay = 0;
	return {
		setTimer: (handler, ms) => {
			delay = ms;
			const id = next++;
			timers.set(id, handler);
			return id;
		},
		clearTimer: (id) => { timers.delete(id); },
		fireAll: () => {
			for (const [id, handler] of [...timers]) {
				timers.delete(id);
				handler();
			}
		},
		count: () => timers.size,
		lastDelay: () => delay,
	};
}

function schedulerTests(): void {
	const timers = fakeTimers();
	const taken: PasteTarget[] = [];
	const scheduler = new PasteFixScheduler({
		take: (target) => { taken.push(target); },
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
	});

	const note = fileOf("聊天记录.md");
	const other = fileOf("别的.md");
	const editor = {} as Editor;
	const otherEditor = {} as Editor;

	// 粘贴那一刻只登记：带上了编辑器、笔记与粘贴起点
	scheduler.schedule({ editor, file: note, start: 42 });
	checkEqual("登记时不动手", taken, []);
	checkEqual("等待表里有一篇", scheduler.size, 1);
	checkEqual("兜底时长用默认值", timers.lastDelay(), PASTE_FALLBACK_MS);

	// 别的笔记 / 别的编辑器有动静都不算数
	checkEqual("别的笔记内容变了不触发", scheduler.onEditorChange(editor, other), false);
	checkEqual("别的编辑器内容变了不触发", scheduler.onEditorChange(otherEditor, note), false);
	checkEqual("等待表还在", scheduler.size, 1);
	checkEqual("也还没交出去", taken, []);

	// 编辑器内容变了：把这一笔（编辑器 + 笔记 + 起点）交出去
	checkEqual("内容落地交出去", scheduler.onEditorChange(editor, note), true);
	checkEqual("交出去的是这一笔", taken.map(t => [t.file.path, t.start]), [["聊天记录.md", 42]]);
	checkEqual("交出去之后等待表清空", scheduler.size, 0);
	checkEqual("兜底定时器也撤掉", timers.count(), 0);

	// 同一次粘贴之后编辑器又变了（我们自己的 replaceRange）：没有等待，什么都不做
	checkEqual("没有等待时再变不触发", scheduler.onEditorChange(editor, note), false);
	checkEqual("没有多交一次", taken.length, 1);

	// 连着粘两次：只留最后一次，只交一次
	scheduler.schedule({ editor, file: note, start: 10 });
	scheduler.schedule({ editor, file: note, start: 20 });
	checkEqual("同一篇连着粘只留一条等待", scheduler.size, 1);
	checkEqual("旧定时器撤掉，只剩一个", timers.count(), 1);
	timers.fireAll();
	checkEqual("兜底只是把这笔等待丢掉（绝不动整篇）", taken.length, 1);
	checkEqual("跑完等待表清空", scheduler.size, 0);

	// 卸载：清掉等待与定时器，卸载之后一个字节都不动
	scheduler.schedule({ editor, file: note, start: 0 });
	scheduler.dispose();
	checkEqual("卸载后清空等待表", scheduler.size, 0);
	checkEqual("卸载后定时器也清了", timers.count(), 0);
	timers.fireAll();
	checkEqual("卸载后不再交出去", taken.length, 1);
}

// ------------------------------------------------- 3. 尺寸观望表（粘贴多张图）
function sizeWatcherTests(): void {
	const timers = fakeTimers();
	let clock = 0;
	const watcher = new PasteSizeWatcher({
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
		now: () => clock,
	});

	const note = fileOf("聊天记录.md");
	const other = fileOf("别的.md");
	const editor = {} as Editor;
	const otherEditor = {} as Editor;

	checkEqual("没粘过：什么都不做", watcher.onEditorChange(editor, note), null);

	watcher.schedule({ editor, file: note, start: 5 });
	checkEqual("观望表里有一笔", watcher.size, 1);

	// 粘贴多张图：第一张落进来之后**不摘**，后面几张还能接着管
	const first = watcher.onEditorChange(editor, note);
	checkEqual("第一次变化交出去（范围从粘贴起点算）", first?.start, 5);
	checkEqual("交出去之后这一笔还活着", watcher.size, 1);
	clock += 1000;
	const second = watcher.onEditorChange(editor, note);
	checkEqual("第二张图落进来照样交出去", second?.start, 5);

	checkEqual("别的笔记变化不命中", watcher.onEditorChange(editor, other), null);
	checkEqual("别的编辑器变化不命中", watcher.onEditorChange(otherEditor, note), null);
	checkEqual("不命中也不影响这一笔", watcher.size, 1);

	// 每次变化都重新计时：编辑器安静下来（idleMs 内没有动静）才丢掉
	timers.fireAll();
	checkEqual("安静之后丢掉这笔观望", watcher.size, 0);
	checkEqual("丢掉之后不再交出去", watcher.onEditorChange(editor, note), null);

	// 总寿命：一直有人在改也总有个头（用户随手打字不能把这笔观望一直续下去）
	clock = 0;
	watcher.schedule({ editor, file: note, start: 0 });
	checkEqual("刚开始还能交出去", watcher.onEditorChange(editor, note)?.start, 0);
	clock = PASTE_SIZE_MAX_MS + 1;
	checkEqual("超过总寿命就不再管", watcher.onEditorChange(editor, note), null);
	checkEqual("作废之后观望表清空", watcher.size, 0);

	// 卸载：清掉观望与定时器
	watcher.schedule({ editor, file: note, start: 0 });
	watcher.dispose();
	checkEqual("卸载后清空观望表", watcher.size, 0);
	checkEqual("卸载后定时器也清了", timers.count(), 0);
	checkEqual("卸载后不再交出去", watcher.onEditorChange(editor, note), null);
}

// ------------------------------------------------------------ 4. 接线
/** 编辑器替身：够 paste-watch 与 tasks 的替身用（偏移 ↔ 位置、读区间） */
function fakeEditor(text: string, cursor = 0): Editor & { setText: (t: string, c?: number) => void; replaced: string[] } {
	let value = text;
	let at = cursor;
	const replaced: string[] = [];
	return {
		get replaced(): string[] { return replaced; },
		setText: (t: string, c = 0): void => { value = t; at = c; },
		posToOffset: (pos: { line: number; ch: number }) => pos.line * 100000 + pos.ch,
		offsetToPos: (offset: number) => ({ line: Math.floor(offset / 100000), ch: offset % 100000 }),
		getCursor: () => ({ line: Math.floor(at / 100000), ch: at % 100000 }),
		getSelection: () => "",
		getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }) => {
			const a = from.line * 100000 + from.ch;
			const b = to.line * 100000 + to.ch;
			return value.substring(a, b);
		},
		replaceRange: (replacement: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void => {
			const a = from.line * 100000 + from.ch;
			const b = to.line * 100000 + to.ch;
			replaced.push(replacement);
			value = value.substring(0, a) + replacement + value.substring(b);
			at = a + replacement.length;
		},
	} as unknown as Editor & { setText: (t: string, c?: number) => void; replaced: string[] };
}

function wiringTests(): void {
	installDomStubs();

	const pasteHandlers: Array<(evt: ClipboardEvent, editor: unknown, info: { file: TFile | null }) => void> = [];
	const changeHandlers: Array<(editor: unknown, info: { file: TFile | null }) => void> = [];
	const cleanups: Array<() => void> = [];
	const note = fileOf("聊天记录.md");
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS };
	const calls: Array<[string, number]> = [];
	const sizeCalls: number[] = [];

	const plugin = {
		app: {
			workspace: {
				on: (event: string, callback: never) => {
					if (event === "editor-paste") pasteHandlers.push(callback);
					if (event === "editor-change") changeHandlers.push(callback);
					return { event };
				},
			},
		},
		register: (cleanup: () => void) => { cleanups.push(cleanup); },
		registerEvent: () => undefined,
	} as unknown as Plugin;

	const actions = {
		fixPastedRange: async (file: TFile, _editor: Editor, start: number) => {
			calls.push([file.path, start]);
			return true;
		},
		sizePastedRange: async (_editor: Editor, start: number) => {
			sizeCalls.push(start);
			return true;
		},
	} as unknown as TaskActions;
	registerPasteAutoFix(plugin, actions, () => settings);

	const editor = fakeEditor("笔记开头。", 5);
	/** 把光标放回第 5 个字符（=`粘贴前光标`），这样每次粘贴的起点都是 5，断言好写 */
	const resetCursor = (): void => { editor.setText("笔记开头。", 5); };
	/** 粘贴一次；`prevented` = 别的插件（比如 Image Converter）接管了这次粘贴 */
	const paste = (text: string, prevented = false): void => {
		const evt = { clipboardData: { getData: () => text }, defaultPrevented: prevented } as unknown as ClipboardEvent;
		for (const handler of pasteHandlers) handler(evt, editor, { file: note });
	};
	const change = (): void => {
		for (const handler of changeHandlers) handler(editor, { file: note });
	};

	checkTrue("editor-paste / editor-change 都接上了（不再等 vault.modify）",
		pasteHandlers.length === 1 && changeHandlers.length === 1,
		`paste ${pasteHandlers.length} / change ${changeHandlers.length}`);

	// 0. 尺寸开关关掉：粘贴图片也不登记观望（被接管的粘贴同样不登记）
	settings.autoSetImageSizeOnPaste = false;
	resetCursor();
	paste(PLAIN_TEXT, true);
	editor.setText("笔记开头。![[a.png]]", 5 + "![[a.png]]".length);
	change();
	checkEqual("尺寸开关关掉：不套尺寸", sizeCalls, []);
	checkEqual("尺寸开关关掉：也不跑文本修复", calls, []);

	// 1. 像聊天记录：粘贴那一刻不动手，内容落进编辑器后把"刚粘的那一段"交出去修。
	//    文本与尺寸共用**一次**写回 —— 那一次变化里只调 fixPastedRange
	settings.autoSetImageSizeOnPaste = true;
	resetCursor();
	paste(CHAT_LOG);
	checkEqual("粘贴时不立刻动手", calls, []);
	editor.setText("笔记开头。" + CHAT_LOG, 5 + CHAT_LOG.length);
	change();
	checkEqual("内容落地后修这一段（起点 = 粘贴前光标）", calls, [["聊天记录.md", 5]]);
	checkEqual("同一次变化里不再单独跑尺寸（文本修复内部已经做掉）", sizeCalls, []);
	change();
	checkEqual("文本那一笔摘掉之后，尺寸那一笔还看着这一段", sizeCalls, [5]);

	// 2. 普通粘贴（内容不像聊天记录）：文本不动手；尺寸那一笔照看（真没图时任务自己会跳过）
	calls.length = 0;
	sizeCalls.length = 0;
	resetCursor();
	paste(PLAIN_TEXT);
	editor.setText("笔记开头。" + PLAIN_TEXT, 5 + PLAIN_TEXT.length);
	change();
	checkEqual("不像聊天记录就不动手", calls, []);
	checkEqual("尺寸那一笔照样看一眼", sizeCalls, [5]);

	// 3. 文本开关关掉：文本那一笔不登记（尺寸那一笔不受它影响）
	settings.autoFixChatLogOnPaste = false;
	calls.length = 0;
	resetCursor();
	paste(CHAT_LOG);
	editor.setText("笔记开头。" + CHAT_LOG, 5 + CHAT_LOG.length);
	change();
	checkEqual("文本开关关掉后不触发", calls, []);

	// 4. 别的插件已经接管了这次粘贴（defaultPrevented）：文本修复不凑热闹……
	settings.autoFixChatLogOnPaste = true;
	calls.length = 0;
	sizeCalls.length = 0;
	resetCursor();
	paste(CHAT_LOG, true);
	editor.setText("笔记开头。" + CHAT_LOG + CHAT_LOG, 5 + CHAT_LOG.length * 2);
	change();
	checkEqual("被别处接管的粘贴不触发文本修复", calls, []);
	// ……但尺寸那一笔要跟：Image Converter 处理图片文件时就是 preventDefault 自己来的，
	// 图片是它存进仓库、链接是它插进正文的 —— 那正是要套尺寸的图片
	checkEqual("被接管的粘贴照样套尺寸", sizeCalls, [5]);

	// 5. 粘贴图片：一次粘贴可能分几次落进编辑器（逐张存盘 / 逐张转码），每落一张都再看一眼
	sizeCalls.length = 0;
	resetCursor();
	paste("", true);
	editor.setText("笔记开头。![[a.png]]", 5 + "![[a.png]]".length);
	change();
	editor.setText("笔记开头。![[a.png]]\n![[b.png]]", 5 + "![[a.png]]\n![[b.png]]".length);
	change();
	checkEqual("粘贴多张图：逐张都看一眼（起点都是粘贴处）", sizeCalls, [5, 5]);

	// 6. 卸载：观望清空，不再动手
	calls.length = 0;
	sizeCalls.length = 0;
	resetCursor();
	paste(CHAT_LOG, true);
	for (const cleanup of cleanups) cleanup();
	change();
	checkEqual("卸载后不再动手", [calls.length, sizeCalls], [0, []]);
}

// -------------------------------------------------------------------- 运行
console.log("=== 判定 ===");
gateTests();

console.log("=== 等待表 ===");
schedulerTests();

console.log("=== 尺寸观望表 ===");
sizeWatcherTests();

console.log("=== 接线 ===");
wiringTests();

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
