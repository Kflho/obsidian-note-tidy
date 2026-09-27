/**
 * 粘贴聊天记录时自动修复（`src/ui/paste-watch.ts`）
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 判定：开关 + 有笔记 + 像聊天记录，三条都满足才动手（错一条都不动）
 *   2. 时机：粘贴那一刻**不动手**（那时正文里还没有粘进来的内容），落盘之后再修
 *   3. 不干等：内容一落进编辑器就催这篇笔记立刻落盘（否则要等 Obsidian 停手 2 秒的自动保存）
 *   4. 等待表：同一篇连着粘只跑一次、兜底定时器、卸载后清干净
 *   5. 接线：`registerPasteAutoFix` 把 `editor-paste` / `editor-change` / `vault.modify` 都接上了
 */
import { MarkdownView, TFile } from "obsidian";
import type { Plugin } from "obsidian";
import type { ImageTransferSettings } from "../src/settings/model";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { TaskActions } from "../src/tasks";
import { PASTE_FALLBACK_MS, PasteFixScheduler, registerPasteAutoFix, shouldAutoFixPaste } from "../src/ui/paste-watch";

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

// -------------------------------------------------- 2. 等待表（时机与兜底）
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
	const ran: string[] = [];
	const flushed: string[] = [];
	const scheduler = new PasteFixScheduler({
		run: (file) => { ran.push(file.path); },
		flush: (file) => { flushed.push(file.path); },
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
	});

	const note = fileOf("聊天记录.md");
	const other = fileOf("别的.md");

	// 粘贴那一刻只登记，不动手（正文里还没有粘进来的内容）
	scheduler.schedule(note);
	checkEqual("登记时先不修", ran, []);
	checkEqual("等待表里有一篇", scheduler.size, 1);
	checkEqual("兜底时长用默认值", timers.lastDelay(), PASTE_FALLBACK_MS);

	// 别的笔记有动静都不算数
	checkEqual("别的笔记内容变了不催落盘", scheduler.onEditorChange(other), false);
	checkEqual("别的笔记落盘不触发", scheduler.onModified(other), false);
	checkEqual("等待表还在", scheduler.size, 1);
	checkEqual("也没催过谁的落盘", flushed, []);

	// 内容真的落进编辑器：催这篇立刻落盘（但还不修 —— 磁盘上还是旧正文）
	checkEqual("内容落地催落盘", scheduler.onEditorChange(note), true);
	checkEqual("催的是这一篇", flushed, ["聊天记录.md"]);
	checkEqual("催落盘时先不修", ran, []);
	checkEqual("催落盘不算完，还在等落盘", scheduler.size, 1);
	checkEqual("同一笔只催一次（粘完接着打字会连着触发）", scheduler.onEditorChange(note), false);
	checkEqual("还是只催了一次", flushed, ["聊天记录.md"]);

	// 这篇落盘了：立刻修，并且不再等兜底
	checkEqual("这篇落盘触发", scheduler.onModified(note), true);
	checkEqual("修了一次", ran, ["聊天记录.md"]);
	checkEqual("等待表清空", scheduler.size, 0);
	checkEqual("兜底定时器也撤掉", timers.count(), 0);

	// 同一条消息再落盘一次：没有等待，什么都不做（我们自己的写盘也会触发 modify）
	checkEqual("没有等待时落盘不触发", scheduler.onModified(note), false);
	checkEqual("没有多修一次", ran, ["聊天记录.md"]);

	// 连着粘两次：只留最后一次，只修一次
	scheduler.schedule(note);
	scheduler.schedule(note);
	checkEqual("同一篇连着粘只留一条等待", scheduler.size, 1);
	checkEqual("旧定时器撤掉，只剩一个", timers.count(), 1);
	timers.fireAll();
	checkEqual("兜底也能修（编辑器迟迟没落盘时）", ran, ["聊天记录.md", "聊天记录.md"]);
	checkEqual("跑完等待表清空", scheduler.size, 0);

	// 卸载：清掉等待与定时器，卸载之后一个字节都不写
	scheduler.schedule(note);
	scheduler.dispose();
	checkEqual("卸载后清空等待表", scheduler.size, 0);
	checkEqual("卸载后定时器也清了", timers.count(), 0);
	timers.fireAll();
	checkEqual("卸载后不再动手", ran.length, 2);
}

// ------------------------------------------------------------ 3. 接线
function wiringTests(): void {
	installDomStubs();

	const pasteHandlers: Array<(evt: ClipboardEvent, editor: unknown, info: { file: TFile | null }) => void> = [];
	const changeHandlers: Array<(editor: unknown, info: { file: TFile | null }) => void> = [];
	const modifyHandlers: Array<(file: unknown) => void> = [];
	const cleanups: Array<() => void> = [];
	const note = fileOf("聊天记录.md");
	const saved: string[] = [];
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS };
	const ran: string[] = [];

	// 编辑器视图替身：flush 要能认出"这篇笔记开着"并调它的 save()
	// （真实定义里 MarkdownView 的构造函数要一个 leaf，替身类不用；这里按替身来造实例）
	const ViewClass = MarkdownView as unknown as new () => MarkdownView;
	const view = Object.assign(new ViewClass(), {
		file: note,
		save: async (): Promise<void> => { saved.push(note.path); },
	});

	const plugin = {
		app: {
			workspace: {
				on: (event: string, callback: never) => {
					if (event === "editor-paste") pasteHandlers.push(callback);
					if (event === "editor-change") changeHandlers.push(callback);
					return { event };
				},
				getLeavesOfType: (type: string) => (type === "markdown" ? [{ view }] : []),
			},
			vault: {
				on: (_event: string, callback: never) => { modifyHandlers.push(callback); return { event: _event }; },
			},
		},
		register: (cleanup: () => void) => { cleanups.push(cleanup); },
		registerEvent: () => undefined,
	} as unknown as Plugin;

	const actions = { quickFixChatLog: async (file: TFile) => { ran.push(file.path); } } as unknown as TaskActions;
	registerPasteAutoFix(plugin, actions, () => settings);

	const paste = (text: string): void => {
		const evt = { clipboardData: { getData: () => text } } as unknown as ClipboardEvent;
		for (const handler of pasteHandlers) handler(evt, {}, { file: note });
	};
	const change = (): void => {
		for (const handler of changeHandlers) handler({}, { file: note });
	};
	const save = (): void => {
		for (const handler of modifyHandlers) handler(note);
	};

	checkTrue("editor-paste / editor-change / vault.modify 都接上了",
		pasteHandlers.length === 1 && changeHandlers.length === 1 && modifyHandlers.length === 1,
		`paste ${pasteHandlers.length} / change ${changeHandlers.length} / modify ${modifyHandlers.length}`);

	// 像聊天记录：粘贴时不写，等内容落地催一次落盘，落盘后才修
	paste(CHAT_LOG);
	checkEqual("粘贴时不立刻写", ran, []);
	change();
	checkEqual("内容落地催这篇笔记落盘", saved, ["聊天记录.md"]);
	checkEqual("催落盘时还没修", ran, []);
	save();
	checkEqual("落盘后自动修一次", ran, ["聊天记录.md"]);

	// 普通粘贴：什么都不发生
	paste(PLAIN_TEXT);
	change();
	save();
	checkEqual("普通粘贴不触发", ran, ["聊天记录.md"]);
	checkEqual("普通粘贴也不催落盘", saved, ["聊天记录.md"]);

	// 开关关掉：什么都不发生
	settings.autoFixChatLogOnPaste = false;
	paste(CHAT_LOG);
	change();
	save();
	checkEqual("开关关掉后不触发", ran, ["聊天记录.md"]);
	checkEqual("开关关掉后也不催落盘", saved, ["聊天记录.md"]);

	// 卸载：等待清空，不再写仓库、也不再催落盘
	settings.autoFixChatLogOnPaste = true;
	paste(CHAT_LOG);
	for (const cleanup of cleanups) cleanup();
	change();
	save();
	checkEqual("卸载后不再动手", ran, ["聊天记录.md"]);
	checkEqual("卸载后也不再催落盘", saved, ["聊天记录.md"]);
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
