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
 */
import { TFile } from "obsidian";
import type { Editor, Plugin } from "obsidian";
import type { ImageTransferSettings } from "../src/settings/model";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { TaskActions } from "../src/tasks";
import {
	PASTE_FALLBACK_MS,
	PasteFixScheduler,
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

// ------------------------------------------------------------ 3. 接线
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
	} as unknown as TaskActions;
	registerPasteAutoFix(plugin, actions, () => settings);

	const editor = fakeEditor("笔记开头。", 5);
	const paste = (text: string): void => {
		const evt = { clipboardData: { getData: () => text }, defaultPrevented: false } as unknown as ClipboardEvent;
		for (const handler of pasteHandlers) handler(evt, editor, { file: note });
	};
	const change = (): void => {
		for (const handler of changeHandlers) handler(editor, { file: note });
	};

	checkTrue("editor-paste / editor-change 都接上了（不再等 vault.modify）",
		pasteHandlers.length === 1 && changeHandlers.length === 1,
		`paste ${pasteHandlers.length} / change ${changeHandlers.length}`);

	// 像聊天记录：粘贴那一刻不动手，内容落进编辑器后把"刚粘的那一段"交出去修
	paste(CHAT_LOG);
	checkEqual("粘贴时不立刻动手", calls, []);
	editor.setText("笔记开头。" + CHAT_LOG, 5 + CHAT_LOG.length);
	change();
	checkEqual("内容落地后修这一段（起点 = 粘贴前光标）", calls, [["聊天记录.md", 5]]);

	// 普通粘贴（内容不像聊天记录）：什么都不做
	calls.length = 0;
	paste(PLAIN_TEXT);
	editor.setText("笔记开头。" + PLAIN_TEXT, 5 + PLAIN_TEXT.length);
	change();
	checkEqual("不像聊天记录就不动手", calls, []);

	// 开关关掉：什么都不发生
	settings.autoFixChatLogOnPaste = false;
	paste(CHAT_LOG);
	editor.setText("笔记开头。" + CHAT_LOG, 5 + CHAT_LOG.length);
	change();
	checkEqual("开关关掉后不触发", calls, []);

	// 别的插件已经接管了这次粘贴（defaultPrevented）：不凑热闹
	settings.autoFixChatLogOnPaste = true;
	for (const handler of pasteHandlers) {
		handler({ clipboardData: { getData: () => CHAT_LOG }, defaultPrevented: true } as unknown as ClipboardEvent, editor, { file: note });
	}
	editor.setText("笔记开头。" + CHAT_LOG + CHAT_LOG, 5 + CHAT_LOG.length * 2);
	change();
	checkEqual("被别处接管的粘贴不触发", calls, []);

	// 卸载：等待清空，不再动手
	paste(CHAT_LOG);
	for (const cleanup of cleanups) cleanup();
	change();
	checkEqual("卸载后不再动手", calls, []);
}

// -------------------------------------------------------------------- 运行
console.log("=== 判定 ===");
gateTests();

console.log("=== 等待表 ===");
schedulerTests();

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
