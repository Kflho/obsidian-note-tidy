/**
 * 命令注册审计
 *
 * 运行：npm test
 *
 * 右键菜单与命令面板是同一批操作的两个入口，任何"菜单里有、命令面板里没有"的操作
 * 都是漏注册。这里把插件真的 onload 一遍，再抓下它注册的命令与右键菜单结构对照：
 *
 *   1. 命令 ID 固定 —— 改名或删除会立刻失败（命令 ID 是已发布版本的稳定接口）
 *   2. 菜单里的每个操作都能在命令表里找到；命令表里的每条命令都真的注册了
 *   3. 两条子菜单路径行为一致 —— 原生 setSubmenu（右侧画 › 箭头）与旧版退化路径
 */
import { Menu, MenuItem, Notice, TFile } from "obsidian";
import type { App, PluginManifest } from "obsidian";
import ImageTransferPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import { INJECTED_ITEM_KEYS, OWN_ITEM_COMMANDS, OWN_ITEM_SCOPES, ownMenuEntries } from "../src/ui/image-menu";
import type { MenuScope } from "../src/ui/menu-hidden";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

function check(name: string, actual: string, expected: string): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[期望输出不符] ${name}
  期望 ${JSON.stringify(expected)}
  实际 ${JSON.stringify(actual)}`);
	}
}

function checkList(name: string, actual: string[], expected: string[]): void {
	checks++;
	if (actual.join(" | ") !== expected.join(" | ")) {
		failures.push(`[列表不符] ${name}\n  期望 ${expected.join(" | ")}\n  实际 ${actual.join(" | ")}`);
	}
}

// ---------------------------------------------------------------- 测试替身类型
/** 替身 MenuItem 记录下来的字段（真实 MenuItem 没有 title / clickHandler） */
interface StubMenuItem {
	title: string;
	submenu?: StubMenu;
	clickHandler: ((evt: { clientX: number; clientY: number }) => void) | null;
}

interface StubMenu {
	items: StubMenuItem[];
}

interface StubMenuCtor {
	new (): StubMenu;
	created: StubMenu[];
}

interface RecordedCommand {
	id: string;
	name: string;
}

interface RecordedPlugin {
	commands: RecordedCommand[];
	settingTabs: unknown[];
	statusBarItems: unknown[];
	editorExtensions: unknown[];
}

type FileMenuHandler = (menu: StubMenu, file: TFile) => void;

const MenuCtor = Menu as unknown as StubMenuCtor;
const MenuItemPrototype = (MenuItem as unknown as { prototype: { setSubmenu?: () => StubMenu } }).prototype;

// -------------------------------------------------------------- 操作 ↔ 命令表
/**
 * 右键菜单操作 → 命令 ID。
 * 菜单里出现、这张表里没有的标题 = 漏注册命令（测试会失败）。
 */
const OPERATIONS: Array<{ menu: RegExp; commands: string[] }> = [
	{
		menu: /^转换.*的外部图片$/,
		commands: ["transfer-images-current-note", "transfer-images-entire-vault"],
	},
	{
		menu: /^重命名.*的乱码图片$/,
		commands: ["rename-garbled-images-current-note", "rename-garbled-images-entire-vault"],
	},
	{
		menu: /^将.*的所有图片重命名为预设格式$/,
		commands: ["rename-all-images-entire-vault"],
	},
	{
		menu: /^强制将.*的所有图片重命名为预设格式$/,
		commands: ["force-rename-all-images-entire-vault"],
	},
	{
		menu: /^整理.*图片位置$/,
		commands: ["organize-images-current-note", "organize-images-entire-vault"],
	},
	{
		menu: /^设置.*图片的大小$/,
		commands: ["set-image-size-current-note", "set-image-size-entire-vault"],
	},
	{
		menu: /^修复.*的排版（空格 \/ 缩进 \/ 聊天记录 \/ 标签 \/ 公式）$/,
		commands: ["format-chat-log-current-note", "format-chat-log-entire-vault"],
	},
	{
		menu: /^快速设置.*图片的大小$/,
		commands: ["quick-set-image-size-current-note"],
	},
];

/**
 * 编辑器 / 图片右键菜单里的操作 → 命令 ID。
 *
 * 「复制图片」挂在编辑器菜单（编辑模式）与图片自己的菜单（阅读模式）上，
 * 不在文件菜单里，所以单独一张表（触发方式也不同，见 collectEditorMenus）。
 */
const EDITOR_OPERATIONS: Array<{ menu: RegExp; commands: string[] }> = [
	{
		menu: /^复制.*图片（Note Tidy）$/,
		commands: ["copy-images-to-clipboard"],
	},
	{
		menu: /^快速设置图片大小（Note Tidy）$/,
		commands: ["quick-set-image-size-current-note"],
	},
	{
		// 三个菜单里都有这一项：编辑器菜单这条由本表看着，图片 / 文件夹菜单那条是插进去的
		menu: /^管理右键菜单…（Note Tidy）$/,
		commands: ["manage-image-menu"],
	},
];

/**
 * 没有右键菜单入口的命令（目前是空的：设置 / 命令面板里的面板类命令将来若有，
 * 又没有菜单入口，就登记在这里 —— 免得漏掉一个"注册了却没人用"的命令）。
 */
const PANEL_COMMANDS: string[] = [];

/**
 * **注入**进图片 / 文件夹菜单的那些项 → 命令 ID。
 *
 * 它们不是走 `file-menu` / `editor-menu` 事件加的（上面两张表抓不到），
 * 所以从实现里的 `imageMenuEntries` 直接生成：菜单里能看到的功能，命令面板里必须也找得到。
 */
const INJECTED_OPERATIONS: Array<{ scope: MenuScope; key: 'copy' | 'quickSize' | 'manage' }> = [
	{ scope: "image", key: "copy" },
	{ scope: "image", key: "quickSize" },
	{ scope: "image", key: "manage" },
	{ scope: "note", key: "copy" },
	{ scope: "note", key: "quickSize" },
	{ scope: "note", key: "manage" },
	{ scope: "folder", key: "manage" },
];

/**
 * 每个菜单里到底该出现哪几项 —— 与 OWN_ITEM_SCOPES 对着核。
 * 少写一项 = 那一层拿不到这个功能；多写一项 = 那一层会多出一个设置里没有开关的项。
 */
const EXPECTED_OWN_ITEMS: Record<string, string[]> = {
	image: ["copy", "quickSize", "manage"],
	note: ["copy", "quickSize", "manage"],
	folder: ["imageSubmenu", "manage", "textSubmenu"],
};

// ------------------------------------------------------------------ 辅助构造
/** 记录笔记内容与"读就报错"的文件，用来跑真实的批处理路径 */
interface VaultStub {
	app: App;
	handlers: Map<string, FileMenuHandler[]>;
	contents: Map<string, string>;
	files: TFile[];
}

function createApp(options?: { contents?: Map<string, string>; failOn?: string }): VaultStub {
	const handlers = new Map<string, FileMenuHandler[]>();
	const contents = options?.contents ?? new Map<string, string>();
	const files = [...contents.keys()].map(path =>
		Object.assign(new TFile(), { path, name: path, extension: "md" })
	);

	const app = {
		vault: {
			getMarkdownFiles: (): TFile[] => files,
			getFiles: (): TFile[] => [],
			getAbstractFileByPath: (): null => null,
			read: async (file: TFile): Promise<string> => contents.get(file.path) ?? "",
			modify: async (file: TFile, data: string): Promise<void> => {
				contents.set(file.path, data);
			},
			// 插件用 process 做"读—改—写"；这里模拟"某一篇读不出来"
			process: async (file: TFile, fn: (data: string) => string): Promise<string> => {
				if (options?.failOn === file.path) throw new Error(`模拟读取失败：${file.path}`);
				const current = contents.get(file.path) ?? "";
				const next = fn(current);
				if (next !== current) contents.set(file.path, next);
				return next;
			},
			createBinary: async (): Promise<unknown> => ({}),
		},
		workspace: {
			on: (event: string, callback: FileMenuHandler) => {
				const list = handlers.get(event) ?? [];
				list.push(callback);
				handlers.set(event, list);
				return { event };
			},
		},
		fileManager: { renameFile: async (): Promise<void> => undefined },
	} as unknown as App;

	return { app, handlers, contents, files };
}

async function loadPlugin(): Promise<{ plugin: RecordedPlugin; handlers: Map<string, FileMenuHandler[]> }> {
	const { app, handlers } = createApp();
	const manifest = { id: "note-tidy", name: "test", version: "0.0.0" } as PluginManifest;
	const plugin = new ImageTransferPlugin(app, manifest);
	await plugin.onload();
	return { plugin: plugin as unknown as RecordedPlugin, handlers };
}

/** 触发一次文件右键菜单，取出顶层入口与二级菜单里的操作 */
function collectMenus(handlers: Map<string, FileMenuHandler[]>): { titles: string[]; leaves: string[] } {
	const menu = new Menu() as unknown as StubMenu;
	MenuCtor.created.length = 0;

	const file = Object.assign(new TFile(), { extension: "md", name: "测试.md", path: "测试.md" });
	for (const handler of handlers.get("file-menu") ?? []) handler(menu, file);

	const titles: string[] = [];
	const leaves: string[] = [];
	for (const entry of menu.items) {
		titles.push(entry.title);
		if (entry.submenu) {
			// 原生子菜单：build() 的结果直接挂在菜单项上
			for (const leaf of entry.submenu.items) leaves.push(leaf.title);
			continue;
		}
		// 退化路径：子菜单在点击时才创建
		const before = MenuCtor.created.length;
		entry.clickHandler?.({ clientX: 0, clientY: 0 });
		for (const submenu of MenuCtor.created.slice(before)) {
			for (const leaf of submenu.items) leaves.push(leaf.title);
		}
	}
	return { titles, leaves };
}

/** 菜单操作是否与 OPERATIONS 表双向对应 */
function checkOperations(label: string, leaves: string[]): void {
	checkAgainst(label, leaves, OPERATIONS);
}

/** 菜单里的标题与某张审计表是否双向对应 */
function checkAgainst(label: string, leaves: string[], table: Array<{ menu: RegExp; commands: string[] }>): void {
	const matched = new Set<number>();
	for (const title of leaves) {
		const hits = table.map((op, index) => (op.menu.test(title) ? index : -1)).filter(index => index >= 0);
		if (hits.length !== 1) {
			checkTrue(
				`${label}：菜单项已登记`,
				false,
				`菜单里有「${title}」，审计表匹配到 ${hits.length} 条（应为 1 条）`
			);
			continue;
		}
		matched.add(hits[0] as number);
	}
	for (let i = 0; i < table.length; i++) {
		const op = table[i];
		if (!op) continue;
		checkTrue(
			`${label}：操作出现在菜单里`,
			matched.has(i),
			`审计表里的 ${op.menu} 在右键菜单里找不到`
		);
	}
	checkTrue(`${label}：菜单项数量`, leaves.length === table.length, `期望 ${table.length} 项，实际 ${leaves.length} 项`);
}

/** 编辑器替身：菜单注册只用 getValue / posToOffset / getCursor / getSelection 四个方法 */
function fakeEditor(text: string, cursor: number): unknown {
	return {
		getValue: () => text,
		posToOffset: (pos: { ch: number }) => pos.ch,
		getCursor: () => ({ line: 0, ch: cursor }),
		getSelection: () => "",
	};
}

/**
 * 触发一次编辑器右键菜单（编辑模式的图片入口）。
 * 文本里放一张图，光标停在它上面 —— 与用户右键点图片时的情形一致。
 */
function collectEditorMenus(handlers: Map<string, FileMenuHandler[]>): string[] {
	const menu = new Menu() as unknown as StubMenu;
	const file = Object.assign(new TFile(), { extension: "md", name: "测试.md", path: "测试.md" });
	const text = "正文\n![[图.png]]\n";
	const editor = fakeEditor(text, text.indexOf("![[图.png]]") + 2);

	for (const handler of handlers.get("editor-menu") ?? []) {
		(handler as unknown as (menu: StubMenu, editor: unknown, info: { file: TFile }) => void)(menu, editor, { file });
	}
	return menu.items.map(item => item.title);
}

// -------------------------------------------------------------------- 审计
async function audit(): Promise<void> {
	// 插件 onload 里会挂 document 上的右键监听，Node 下先把 DOM 替身备好
	installDomStubs();
	const { plugin, handlers } = await loadPlugin();

	// ---- 1. 命令 ID 与注册情况 ----
	const registered = plugin.commands.map(command => command.id);
	checkTrue("命令 ID 不重复", new Set(registered).size === registered.length, `出现重复：${registered.join(", ")}`);

	const expected = [...OPERATIONS, ...EDITOR_OPERATIONS].flatMap(op => op.commands).concat(PANEL_COMMANDS);
	for (const id of expected) {
		checkTrue(`命令已注册：${id}`, registered.includes(id), `审计表里的 ${id} 没有被 addCommand 注册`);
	}
	for (const id of registered) {
		checkTrue(
			`命令已登记审计表：${id}`,
			expected.includes(id),
			`${id} 没有登记在本文件的 OPERATIONS / EDITOR_OPERATIONS / PANEL_COMMANDS 表里，请补上它对应的入口`
		);
	}

	// ---- 2. 原生子菜单路径（Obsidian 自带，右侧 › 箭头） ----
	const native = collectMenus(handlers);
	checkList("原生子菜单：顶层入口", native.titles, ["图片功能", "文本排版"]);
	checkOperations("原生子菜单", native.leaves);

	// ---- 3. 拿不到 setSubmenu 时的退化路径 ----
	const savedSetSubmenu = MenuItemPrototype.setSubmenu;
	delete MenuItemPrototype.setSubmenu;
	try {
		const fallback = collectMenus(handlers);
		checkList("退化路径：顶层入口", fallback.titles, ["图片功能 ›", "文本排版 ›"]);
		checkOperations("退化路径", fallback.leaves);
		checkTrue(
			"两条子菜单路径的操作一致",
			fallback.leaves.join("|") === native.leaves.join("|"),
			`原生 ${native.leaves.join(" | ")}\n退化 ${fallback.leaves.join(" | ")}`
		);
	} finally {
		MenuItemPrototype.setSubmenu = savedSetSubmenu;
	}

	// ---- 4. 编辑器 / 图片右键菜单（「复制图片」的家） ----
	const editorMenus = collectEditorMenus(handlers);
	checkAgainst("编辑器右键菜单", editorMenus, EDITOR_OPERATIONS);

	// ---- 4.5 注入进图片 / 文件夹菜单的项：一样得对得上命令 ----
	// 这些项由 ownMenuEntries 生成（走 Menu.prototype，审计的菜单事件抓不到），
	// 所以直接照着实现算一遍：每个菜单层该有哪几项、每项对应哪条命令。
	const ownTitles: Record<string, string[]> = { image: [], note: [], folder: [] };
	for (const scope of ["image", "note", "folder"] as MenuScope[]) {
		const entries = ownMenuEntries({
			scope,
			settings: DEFAULT_SETTINGS,
			refs: scope === "folder" ? [] : [{ target: "图.png", kind: "wiki", from: 0, to: 0 }],
			hasFile: scope !== "folder",
			copy: () => { /* 不做事 */ },
			quickSize: () => { /* 不做事 */ },
			manage: () => { /* 不做事 */ },
		});
		ownTitles[scope] = entries.map(entry => entry.title);
	}

	for (const [scope, expectedKeys] of Object.entries(EXPECTED_OWN_ITEMS)) {
		const keys = Object.entries(OWN_ITEM_SCOPES)
			.filter(([, scopes]) => scopes.includes(scope as MenuScope))
			.map(([key]) => key)
			.sort();
		checkList(`本插件项的开关覆盖 ${scope} 菜单`, keys, [...expectedKeys].sort());

		// 注入进去的那几项（二级栏由 menus.ts 加，不在这条路上）
		const injected = INJECTED_ITEM_KEYS.filter(key => OWN_ITEM_SCOPES[key].includes(scope as MenuScope));
		checkTrue(`${scope} 菜单里真有这几项`, ownTitles[scope]?.length === injected.length,
			`期望 ${injected.length} 项，实际 ${JSON.stringify(ownTitles[scope])}`);
	}

	for (const operation of INJECTED_OPERATIONS) {
		const command = OWN_ITEM_COMMANDS[operation.key];
		checkTrue(`注入项「${operation.key}」有对应命令`, command !== null && registered.includes(command),
			`${operation.key} → ${String(command)} 没有注册`);
	}

	// 二级栏是容器项：本身不是命令，但要能对应到文件菜单那一行（里面的命令由 OPERATIONS 看着）
	for (const key of ["imageSubmenu", "textSubmenu"] as const) {
		checkTrue(`容器项 ${key} 不占命令`, OWN_ITEM_COMMANDS[key] === null, String(OWN_ITEM_COMMANDS[key]));
		checkList(`容器项 ${key} 属于文件夹菜单`, OWN_ITEM_SCOPES[key], ["folder"]);
	}

	// ---- 5. 其他入口 ----
	checkTrue("设置面板已注册", plugin.settingTabs.length === 1, `实际注册 ${plugin.settingTabs.length} 个`);
	// 状态栏两格：批量进度 + 选中内容的图片张数（各占一格才不会互相覆盖）
	checkTrue("状态栏注册了两格", plugin.statusBarItems.length === 2, `实际注册 ${plugin.statusBarItems.length} 格`);
	// 选区监听是 CodeMirror 扩展：Obsidian 的公开事件里没有"选区变化"
	checkTrue("选区监听扩展已注册", plugin.editorExtensions.length === 1, `实际注册 ${plugin.editorExtensions.length} 个`);
}

// ------------------------------------------------- 5. 整库批处理：单篇失败不拖垮整批
/** suppressNotices / 状态栏用到的浏览器 API，在 Node 里补上最小替身 */
function installDomStubs(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	const classes = new Set<string>();
	globals.document = {
		body: {
			classList: {
				add: (name: string) => { classes.add(name); },
				remove: (name: string) => { classes.delete(name); },
				contains: (name: string) => classes.has(name),
			},
		},
	};
	// 定时器立即执行：省掉恢复通知的 5 秒等待，也不留悬挂的定时器
	globals.window = {
		setTimeout: (fn: () => void) => { fn(); return 0; },
		clearTimeout: () => undefined,
		innerWidth: 100,
		innerHeight: 100,
	};
	globals.MutationObserver = class {
		observe(): void { /* 不观察 */ }
		disconnect(): void { /* 无需断开 */ }
	};
}

/** 替身 Notice 记录的提示消息（真实 Notice 没有这个字段） */
const noticeLog = Notice as unknown as { messages: string[] };

async function batchTests(): Promise<void> {
	installDomStubs();

	const contents = new Map<string, string>([
		["a.md", " >引用A"],
		["坏掉的笔记.md", " >引用B"],   // 读取就报错
		["c.md", " >引用C"],
	]);
	const { app, contents: store, files } = createApp({ contents, failOn: "坏掉的笔记.md" });
	const manifest = { id: "note-tidy", name: "test", version: "0.0.0" } as PluginManifest;
	const plugin = new ImageTransferPlugin(app, manifest);
	await plugin.onload();

	const command = (plugin as unknown as { commands: Array<{ id: string; callback?: () => unknown }> }).commands
		.find(entry => entry.id === "format-chat-log-entire-vault");
	checkTrue("整库排版命令已注册", command !== undefined, "找不到 format-chat-log-entire-vault");

	noticeLog.messages.length = 0;
	const consoleError = console.error;
	const consoleDebug = console.debug;
	const logged: string[] = [];
	console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
	// 插件批处理时会打调试日志（屏蔽通知那套），测试输出里不需要
	console.debug = () => undefined;
	try {
		// createApp 里的文件列表来自 contents 的键，插件拿到的就是这个列表
		checkTrue("测试仓库里有 3 篇笔记", files.length === 3, `实际 ${files.length} 篇`);
		await command?.callback?.();
	} finally {
		console.error = consoleError;
		console.debug = consoleDebug;
	}

	check("整库批处理：第一遍修好", store.get("a.md") ?? "", "> 引用 A");
	check("整库批处理：出错的那篇保持原样", store.get("坏掉的笔记.md") ?? "", " >引用B");
	check("整库批处理：出错之后的笔记照样修好", store.get("c.md") ?? "", "> 引用 C");
	checkTrue("出错的文件被写进日志", logged.some(line => line.includes("坏掉的笔记.md")), `日志：${logged.join(" | ")}`);

	const failureNotice = noticeLog.messages.find((message: string) => message.includes("处理失败"));
	checkTrue("结果提示里说明了失败篇数", failureNotice !== undefined, `实际提示：${noticeLog.messages.join(" | ")}`);
	const summary = noticeLog.messages.find((message: string) => message.includes("共修复了"));
	checkTrue("结果提示里带了本次处理篇数与开关状态", summary !== undefined && summary.includes("本次处理 3 篇") && summary.includes("已开启"),
		`实际提示：${noticeLog.messages.join(" | ")}`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 命令注册审计 ===");
await audit();

console.log("=== 整库批处理：单篇失败不拖垮整批 ===");
await batchTests();

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
