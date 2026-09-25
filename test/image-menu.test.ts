/**
 * 本插件的右键菜单项与"菜单观察/插项"（`src/ui/image-menu.ts` + `menu-injector.ts`）
 *
 * 运行：npm test
 *
 * 盯四件事：
 *   1. 取图规则：选区里有图片就复制选区里的（批量），没有才回退到光标处那一条
 *   2. 我们自己那几项的开关：复制 / 快速设置图片大小 / 管理入口，各自独立
 *   3. 菜单观察：三个作用域各自记录、按作用域过滤
 *   4. **连着右键两次都要插得进去**（2026-09 报回来的 bug：第二次项就没了），
 *      而且我们自己的项**不吃隐藏名单**（不然"管理右键菜单"会被自己藏掉）
 */
import { Menu } from "obsidian";
import type { Editor, MenuItem } from "obsidian";
import type { ImageTransferSettings } from "../src/settings/model";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import {
	MANAGE_MENU_TITLE,
	INJECTED_ITEM_KEYS,
	OWN_ITEM_COMMANDS,
	OWN_ITEM_SCOPES,
	QUICK_SIZE_MENU_TITLE,
	addOwnMenuItems,
	copyMenuTitle,
	editorImageRefs,
	ownMenuEntries,
} from "../src/ui/image-menu";
import type { OwnItemKey } from "../src/ui/image-menu";
import { installMenuInjector, moveOwnItemsFirst, observeMenuInstance, probeMenuItemTitle, removeHiddenItems } from "../src/ui/menu-injector";
import type { ArmedMenu } from "../src/ui/menu-injector";
import type { MenuScope } from "../src/ui/menu-hidden";

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

/** 编辑器替身：只要 getValue / posToOffset / getCursor / getSelection（真实编辑器也只用到这几个） */
function fakeEditor(text: string, cursor: number, selection?: { from: number; to: number }): Editor {
	return {
		getValue: () => text,
		posToOffset: (pos: { line: number; ch: number }) => pos.ch,
		getCursor: (side?: string) => {
			if (side === "from") return { line: 0, ch: selection ? selection.from : cursor };
			if (side === "to") return { line: 0, ch: selection ? selection.to : cursor };
			return { line: 0, ch: cursor };
		},
		getSelection: () => (selection ? text.slice(selection.from, selection.to) : ""),
	} as unknown as Editor;
}

/** 替身 Menu 会把 addItem 的结果记进 items（见 test/obsidian-stub.mjs） */
interface StubMenu {
	items: Array<{ title: string; icon: string | null; clickHandler: (() => void) | null }>;
}

const TEXT = ["![[a.png]]", "中间一行", "![[b.png]] 和 ![[c.png]]"].join("\n");
const OFFSET_B = TEXT.indexOf("![[b.png]]");
const OFFSET_C = TEXT.indexOf("![[c.png]]");
const REF_A = { target: "a.png", kind: "wiki" as const, from: 0, to: 0 };

// ------------------------------------------------------------ 1. 取图规则
function refTests(): void {
	const batch = editorImageRefs(fakeEditor(TEXT, OFFSET_B, { from: OFFSET_B, to: OFFSET_C + "![[c.png]]".length }));
	checkEqual("选区里有图片 → 复制选区里的全部", batch.map(ref => ref.target), ["b.png", "c.png"]);

	const single = editorImageRefs(fakeEditor(TEXT, OFFSET_B + 2));
	checkEqual("没有选区 → 光标处那一条", single.map(ref => ref.target), ["b.png"]);

	const fallback = editorImageRefs(fakeEditor(TEXT, OFFSET_C + 2, { from: 4, to: 8 }));
	checkEqual("选区里没图片 → 回退到光标处", fallback.map(ref => ref.target), ["c.png"]);

	checkEqual("光标在空处且没有选区 → 空", editorImageRefs(fakeEditor(TEXT, TEXT.indexOf("中间") + 1)), []);
	checkEqual("空文档 → 空", editorImageRefs(fakeEditor("", 0)), []);
}

// -------------------------------------------------------------- 2. 文案
function titleTests(): void {
	// 名字带"（Note Tidy）"：原生菜单里本来就有"复制图片"，两个行为完全不同，得分得清
	checkEqual("一张", copyMenuTitle(1), "复制图片（Note Tidy）");
	checkEqual("三张", copyMenuTitle(3), "复制 3 张图片（Note Tidy）");
}

// ------------------------------------------------- 3. 我们自己那几项
function entryTests(): void {
	const base = {
		settings: { ...DEFAULT_SETTINGS },
		hasFile: true,
		copy: () => { /* 不做事 */ },
		quickSize: () => { /* 不做事 */ },
		manage: () => { /* 不做事 */ },
	};

	// 图片菜单：三项（复制 / 快速设置大小 / 管理）
	checkEqual("图片菜单：三项", ownMenuEntries({ ...base, scope: "image", refs: [REF_A] }).map(entry => entry.title),
		["复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);
	checkEqual("图片菜单：多张时带张数",
		ownMenuEntries({ ...base, scope: "image", refs: [REF_A, { ...REF_A, target: "另一张.png" }] })[0]?.title,
		"复制 2 张图片（Note Tidy）");

	// 笔记正文菜单：三项（管理入口也在 —— 三个菜单里都能进管理面板）
	checkEqual("笔记菜单：三项", ownMenuEntries({ ...base, scope: "note", refs: [REF_A] }).map(entry => entry.title),
		["复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);
	checkEqual("笔记菜单：没有图片时不插复制项",
		ownMenuEntries({ ...base, scope: "note", refs: [] }).map(entry => entry.title),
		[QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);

	// 文件夹菜单：只有管理入口（没有图可复制，也没有"当前笔记"可改大小）
	checkEqual("文件夹菜单：只有管理入口",
		ownMenuEntries({ ...base, scope: "folder", refs: [], hasFile: false }).map(entry => entry.title),
		[MANAGE_MENU_TITLE]);

	// 三个开关各自独立，且关掉之后不出现
	const noCopy = { ...DEFAULT_SETTINGS, imageMenuCopyItem: false };
	checkEqual("关掉复制项", ownMenuEntries({ ...base, settings: noCopy, scope: "image", refs: [REF_A] }).map(entry => entry.title),
		[QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);
	const noQuick = { ...DEFAULT_SETTINGS, imageMenuQuickSizeItem: false };
	checkEqual("关掉快速设置大小", ownMenuEntries({ ...base, settings: noQuick, scope: "image", refs: [REF_A] }).map(entry => entry.title),
		["复制图片（Note Tidy）", MANAGE_MENU_TITLE]);
	const noManage = { ...DEFAULT_SETTINGS, imageMenuManageItem: false };
	checkEqual("关掉管理入口", ownMenuEntries({ ...base, settings: noManage, scope: "image", refs: [REF_A] }).map(entry => entry.title),
		["复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE]);

	// 没有笔记（比如图片菜单里拿不到 file）时不插"快速设置图片大小"
	checkEqual("没有笔记时不插快速设置大小",
		ownMenuEntries({ ...base, hasFile: false, scope: "image", refs: [REF_A] }).map(entry => entry.title),
		["复制图片（Note Tidy）", MANAGE_MENU_TITLE]);

	// 动作真的接上了
	let copied = 0;
	let quick = 0;
	let managed = 0;
	const entries = ownMenuEntries({
		...base,
		scope: "image",
		refs: [REF_A],
		copy: () => { copied++; },
		quickSize: () => { quick++; },
		manage: () => { managed++; },
	});
	for (const entry of entries) entry.action();
	checkEqual("三项各调自己的动作", [copied, quick, managed], [1, 1, 1]);

	// 加进菜单
	const menu = new Menu() as unknown as StubMenu;
	addOwnMenuItems(menu as unknown as Menu, entries);
	checkEqual("加进菜单的标题", menu.items.map(item => item.title), ["复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);
	checkEqual("图标", menu.items.map(item => item.icon), ["copy", "image", "settings-2"]);
	checkTrue("点了有回调", typeof menu.items[0]?.clickHandler === "function", String(menu.items[0]?.clickHandler));

	const empty = new Menu() as unknown as StubMenu;
	addOwnMenuItems(empty as unknown as Menu, []);
	checkEqual("没有项时菜单保持为空", empty.items.length, 0);
}

// -------------------------------------------------- 4. 标题探测
function probeTests(): void {
	checkEqual("从构建函数里拿到标题",
		probeMenuItemTitle(item => item.setTitle("复制图片").setIcon("image").onClick(() => { /* 不做事 */ })),
		"复制图片");
	checkEqual("标题是文档片段时取文字", probeMenuItemTitle(item => item.setTitle({ textContent: "另存为图片…" } as unknown as DocumentFragment)), "另存为图片…");
	checkEqual("什么都没设 → null", probeMenuItemTitle(() => undefined), null);
	checkEqual("构建函数抛错 → null（不做隐藏判断，总比崩了强）",
		probeMenuItemTitle(() => { throw new Error("换了写法"); }), null);
}

// --------------------------------- 5. 菜单观察与插项（三个作用域）
function injectorTests(): void {
	// 卸载回调（真实用法是 plugin.register）：补丁必须撤得掉，插件 reload 后才不会留着
	const cleanups: Array<() => void> = [];
	const menuClass = Menu as unknown as typeof Menu;
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS };
	let armed: ArmedMenu | null = null;
	const actions = { copied: 0, quick: 0, managed: 0 };
	// 检测结果按作用域记下来（真实实现把它写进 image-menu.ts 的模块状态，这里看同一份数据）
	const detected: Record<string, string[]> = { image: [], note: [], folder: [] };

	installMenuInjector(menuClass, {
		getSettings: () => settings,
		isArmed: () => armed,
		onDetected: (scope, items) => { detected[scope] = [...items]; },
		onShow: (menu, context) => {
			// 与真实实现同一套：笔记菜单走 editor-menu（这里不插），图片 / 文件夹菜单在这里插
			if (context.scope === "note") return;
			addOwnMenuItems(menu, ownMenuEntries({
				scope: context.scope,
				settings,
				refs: context.refs ?? [],
				hasFile: context.file != null,
				copy: () => { actions.copied++; },
				quickSize: () => { actions.quick++; },
				manage: () => { actions.managed++; },
			}));
		},
		onCleanup: (cleanup) => { cleanups.push(cleanup); },
	});

	/** 模拟一次右键：上膛 → Obsidian 建菜单（原生两项）→ show（我们的项在这时插进去）→ 下膛 */
	function rightClick(scope: ArmedMenu["scope"], nativeTitles: string[]): StubMenu {
		armed = {
			scope,
			// 文件夹菜单拿不到"当前笔记"，与真实实现一致
			file: scope === "folder" ? undefined : ({} as never),
			refs: scope === "image" ? [REF_A] : undefined,
		};
		const menu = new Menu() as unknown as StubMenu;
		for (const title of nativeTitles) {
			(menu as unknown as Menu).addItem((item: MenuItem) => item.setTitle(title));
		}
		(menu as unknown as Menu).showAtMouseEvent({} as MouseEvent);
		armed = null; // 下膛（真实代码在 contextmenu 之后做）
		return menu;
	}

	const native = ["复制图片", "另存为图片…"];

	const first = rightClick("image", native);
	checkEqual("图片菜单：原生项都在，后面接上我们三项",
		first.items.map(item => item.title),
		["复制图片", "另存为图片…", "复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);

	const second = rightClick("image", native);
	checkEqual("第二次右键照样插得进去（不能只有第一次有）",
		second.items.map(item => item.title),
		["复制图片", "另存为图片…", "复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);

	// 点我们那几项：真的调到对应的动作
	second.items[2]?.clickHandler?.();
	second.items[3]?.clickHandler?.();
	second.items[4]?.clickHandler?.();
	checkEqual("复制 / 快速设置大小 / 管理各调一次", [actions.copied, actions.quick, actions.managed], [1, 1, 1]);

	checkEqual("检测到的是那次菜单里的项（按作用域分）", detected.image, native);

	// 笔记与文件夹菜单：笔记菜单走 editor-menu（这里不插），文件夹菜单只插管理入口
	const note = rightClick("note", ["复制", "粘贴", "全选"]);
	checkEqual("笔记菜单不插我们的项", note.items.map(item => item.title), ["复制", "粘贴", "全选"]);
	checkEqual("笔记菜单检测", detected.note, ["复制", "粘贴", "全选"]);

	const folder = rightClick("folder", ["新建笔记", "在系统中显示"]);
	checkEqual("文件夹菜单：原生项后面接上管理入口",
		folder.items.map(item => item.title),
		["新建笔记", "在系统中显示", MANAGE_MENU_TITLE]);
	checkEqual("文件夹菜单检测", detected.folder, ["新建笔记", "在系统中显示"]);

	// 我们自己的项在"笔记菜单"这条路上（editor-menu 追加）也不受隐藏名单影响、也不进检测结果
	settings.menuHiddenItems = `笔记：复制图片（Note Tidy）\n笔记：${MANAGE_MENU_TITLE}`;
	armed = { scope: "note", file: {} as never };
	const noteMenu = new Menu() as unknown as StubMenu;
	addOwnMenuItems(noteMenu as unknown as Menu, ownMenuEntries({
		scope: "note",
		settings,
		refs: [REF_A],
		hasFile: true,
		copy: () => { /* 不做事 */ },
		quickSize: () => { /* 不做事 */ },
		manage: () => { /* 不做事 */ },
	}));
	(noteMenu as unknown as Menu).addItem((item: MenuItem) => item.setTitle("复制"));
	(noteMenu as unknown as Menu).showAtMouseEvent({} as MouseEvent);
	armed = null;
	checkEqual("笔记菜单里我们自己的项不吃隐藏名单",
		noteMenu.items.map(item => item.title),
		["复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE, "复制"]);
	checkEqual("我们自己的项不进检测结果", detected.note, ["复制"]);

	// 二级菜单先建、主菜单后建：只有"真要显示的那份"才算数
	// （2026-09 的 bug：编辑器菜单里"格式 / 块类型"那一套二级菜单被当成了笔记菜单）
	settings.menuHiddenItems = "";
	armed = { scope: "note", file: {} as never };
	const submenu = new Menu() as unknown as StubMenu;
	for (const title of ["正文", "1级标题", "2级标题", "引用", "任务列表", "表格", "脚注", "标注"]) {
		(submenu as unknown as Menu).addItem((item: MenuItem) => item.setTitle(title));
	}
	const mainMenu = new Menu() as unknown as StubMenu;
	for (const title of ["剪切", "复制", "粘贴"]) {
		(mainMenu as unknown as Menu).addItem((item: MenuItem) => item.setTitle(title));
	}
	(mainMenu as unknown as Menu).showAtMouseEvent({} as MouseEvent);
	armed = null;
	checkEqual("二级菜单的项不算进笔记菜单", detected.note, ["剪切", "复制", "粘贴"]);
	checkEqual("二级菜单一个字节都不动",
		submenu.items.map(item => item.title),
		["正文", "1级标题", "2级标题", "引用", "任务列表", "表格", "脚注", "标注"]);

	// 隐藏名单按作用域生效
	settings.menuHiddenItems = "图片：另存为图片…\n笔记：粘贴";
	const filtered = rightClick("image", native);
	checkEqual("图片菜单过滤掉名单里的项",
		filtered.items.map(item => item.title),
		["复制图片", "复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);

	const noteFiltered = rightClick("note", ["复制", "粘贴"]);
	checkEqual("笔记菜单按自己的名单过滤（图片那份不影响它）",
		noteFiltered.items.map(item => item.title),
		["复制"]);

	// 就算用户手滑把我们自己的标题写进名单，也不能把自己藏掉
	settings.menuHiddenItems = `图片：${MANAGE_MENU_TITLE}\n图片：复制图片（Note Tidy）`;
	const selfHide = rightClick("image", native);
	checkEqual("本插件自己的项不吃隐藏名单",
		selfHide.items.map(item => item.title),
		["复制图片", "另存为图片…", "复制图片（Note Tidy）", QUICK_SIZE_MENU_TITLE, MANAGE_MENU_TITLE]);

	// 三个开关各自管一项
	settings.menuHiddenItems = "";
	settings.imageMenuCopyItem = false;
	settings.imageMenuQuickSizeItem = false;
	settings.imageMenuManageItem = false;
	const off = rightClick("image", native);
	checkEqual("三个开关都关掉时只剩别人的项", off.items.map(item => item.title), native);

	// 没上膛时一个字节都不碰
	settings.imageMenuCopyItem = true;
	settings.imageMenuQuickSizeItem = true;
	settings.imageMenuManageItem = true;
	const plain = new Menu() as unknown as StubMenu;
	(plain as unknown as Menu).addItem((item: MenuItem) => item.setTitle("随便一个菜单"));
	checkEqual("没上膛的菜单不受影响", plain.items.map(item => item.title), ["随便一个菜单"]);

	// 卸载时还原（插件 reload 后不能留着补丁）
	for (const cleanup of cleanups) cleanup();
	const afterRestore = new Menu() as unknown as StubMenu;
	armed = { scope: "image", file: {} as never, refs: [REF_A] };
	(afterRestore as unknown as Menu).addItem((item: MenuItem) => item.setTitle("还原之后的菜单"));
	(afterRestore as unknown as Menu).showAtMouseEvent({} as MouseEvent);
	armed = null;
	checkEqual("卸载后补丁撤掉", afterRestore.items.map(item => item.title), ["还原之后的菜单"]);
}

// ------------------------------- 6. 实例级观察（编辑器菜单靠它才读得到）
/**
 * 假菜单 DOM：能查 `.menu-item` / `.menu-item-title`、能 `prepend`（重排）、也能 `remove`（摘项）。
 * 真实菜单里"在我们接手之前就加好的项"只能靠这一套布局来模拟。
 */
function fakeMenu(titles: string[]): { root: HTMLElement; titles: () => string[] } {
	type Node = { title: string; querySelector: (selector: string) => { textContent: string } | null; remove: () => void };
	let nodes: Node[] = [];
	const make = (title: string): Node => {
		const node: Node = {
			title,
			querySelector: (selector: string) => (selector === '.menu-item-title' ? { textContent: title } : null),
			remove: () => { nodes = nodes.filter(item => item !== node); },
		};
		return node;
	};
	nodes = titles.map(make);

	const root = {
		querySelectorAll: (selector: string) => {
			if (selector === '.menu-item') return nodes;
			if (selector === '.menu-item-title') return nodes.map(node => node.querySelector('.menu-item-title'));
			return [];
		},
		prepend: (node: unknown) => {
			const moved = node as Node;
			nodes = [moved, ...nodes.filter(item => item !== moved)];
		},
	};
	return { root: root as unknown as HTMLElement, titles: () => nodes.map(node => node.title) };
}

/**
 * 编辑器菜单（笔记正文右键）不一定走插件拿到的那个 `Menu` 类，原型补丁读不到它。
 * Obsidian 会通过 `editor-menu` 事件把菜单实例交给我们，所以这里盯实例级观察：
 *   1. 事件之前就加好的项 —— 从菜单 DOM 里补读
 *   2. 事件之后加的项 —— 实例上的 `addItem` 接得住，也能按名单过滤
 *   3. 我们自己的项（标题带"（Note Tidy）"）不算别人的项
 *   4. **关不掉的项**（在我们接手之前就加好的，如"新增外部链接"）—— 显示后从 DOM 里摘掉
 */
async function observeTests(): Promise<void> {
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS };
	const detected: string[] = [];
	const menu = new Menu() as unknown as StubMenu & { dom?: HTMLElement };

	// 事件之前 Obsidian 已经加好的项（含我们自己的那一项）
	const dom = fakeMenu(["剪切", "复制", "粘贴", "新增外部链接", "复制图片（Note Tidy）"]);
	menu.dom = dom.root;

	observeMenuInstance(menu as unknown as Menu, {
		scope: "note",
		getSettings: () => settings,
		onDetected: (scope: MenuScope, items: string[]) => { void scope; detected.splice(0, detected.length, ...items); },
	});

	// 事件之后加的项：重复的只记一次
	(menu as unknown as Menu).addItem((item: MenuItem) => item.setTitle("全选"));
	(menu as unknown as Menu).addItem((item: MenuItem) => item.setTitle("全选"));

	// 名单里的项：来不及拦的那条（新增外部链接）显示后要摘掉；拦得住的那条（粘贴）压根不加进去
	settings.menuHiddenItems = "笔记：粘贴\n笔记：新增外部链接";
	(menu as unknown as Menu).addItem((item: MenuItem) => item.setTitle("粘贴"));

	(menu as unknown as Menu).showAtMouseEvent({} as MouseEvent);
	await Promise.resolve(); // 读 DOM 在微任务里

	// 顺序按用户看到的来：DOM 里的顺序在前，事件之后才加进来的排在后面
	checkEqual("读到菜单里的项（含事件之前就有的、跳过我们自己的）", detected,
		["剪切", "复制", "粘贴", "新增外部链接", "全选"]);
	checkTrue("名单里的项没加进菜单", !menu.items.some(item => item.title === "粘贴"),
		`实际 ${JSON.stringify(menu.items.map(item => item.title))}`);
	checkTrue("其它项照常加进去", menu.items.some(item => item.title === "全选"), "全选 没加进去");
	checkEqual("拦不住的项显示后被摘掉", dom.titles(), ["剪切", "复制", "复制图片（Note Tidy）"]);
}

// ------------------------------- 7. 本插件项置顶（DOM 重排）
function orderTests(): void {
	const menu = fakeMenu(["打开", "重命名", "删除", "复制图片（Note Tidy）", MANAGE_MENU_TITLE]);
	moveOwnItemsFirst({ dom: menu.root } as unknown as Menu, ["复制图片（Note Tidy）", MANAGE_MENU_TITLE], null);
	checkEqual("本插件项挪到最前，顺序按给定的来", menu.titles(),
		["复制图片（Note Tidy）", MANAGE_MENU_TITLE, "打开", "重命名", "删除"]);

	// 退化路径的标题带一个 ›（见 menus.ts 的 addSubmenuEntry）
	const fallback = fakeMenu(["打开", "图片功能 ›", "文本排版 ›"]);
	moveOwnItemsFirst({ dom: fallback.root } as unknown as Menu, ["图片功能", "文本排版"], null);
	checkEqual("退化路径的 › 也认得出来", fallback.titles(), ["图片功能 ›", "文本排版 ›", "打开"]);

	// 菜单里没有我们的项（或拿不到 DOM）时什么都不做
	const none = fakeMenu(["打开", "删除"]);
	moveOwnItemsFirst({ dom: none.root } as unknown as Menu, ["复制图片（Note Tidy）"], null);
	checkEqual("菜单里没有我们的项时不动", none.titles(), ["打开", "删除"]);
	moveOwnItemsFirst({} as unknown as Menu, ["复制图片（Note Tidy）"], null);

	// 二级菜单那种"关不掉"的项：显示后按名单摘掉
	const hidden = fakeMenu(["打开", "文本格式", "段落设置", "复制图片（Note Tidy）"]);
	removeHiddenItems(
		{ dom: hidden.root } as unknown as Menu,
		"note",
		{ image: [], note: ["文本格式", "段落设置"], folder: [] },
		["复制图片（Note Tidy）"],
		null,
	);
	checkEqual("隐藏名单里的项被摘掉，自己的项留着", hidden.titles(), ["打开", "复制图片（Note Tidy）"]);
}

// ------------------------------- 8. 开关表与实际菜单项一致
function scopeTableTests(): void {
	const expectedTitle = (key: OwnItemKey): string => key === "copy"
		? "复制图片（Note Tidy）"
		: key === "quickSize" ? QUICK_SIZE_MENU_TITLE : MANAGE_MENU_TITLE;

	for (const scope of ["image", "note", "folder"] as MenuScope[]) {
		// 只比"注入进去"的那几项：文件菜单那两个二级栏由 menus.ts 加，不在这条路上
		const keys = INJECTED_ITEM_KEYS.filter(key => OWN_ITEM_SCOPES[key].includes(scope));
		const entries = ownMenuEntries({
			scope,
			settings: { ...DEFAULT_SETTINGS },
			refs: scope === "folder" ? [] : [REF_A],
			hasFile: scope !== "folder",
			copy: () => { /* 不做事 */ },
			quickSize: () => { /* 不做事 */ },
			manage: () => { /* 不做事 */ },
		});
		checkEqual(`开关表与实际菜单项一致（${scope}）`, entries.map(entry => entry.title), keys.map(expectedTitle));
	}

	checkEqual("五项都有登记（注入项配命令，二级栏是容器）", Object.keys(OWN_ITEM_COMMANDS).sort(), ["copy", "imageSubmenu", "manage", "quickSize", "textSubmenu"]);
}

// -------------------------------------------------------------------- 运行
console.log("=== 取图规则 ===");
refTests();
console.log("=== 文案 ===");
titleTests();
console.log("=== 本插件的菜单项 ===");
entryTests();
console.log("=== 标题探测 ===");
probeTests();
console.log("=== 菜单观察与插项 ===");
injectorTests();
console.log("=== 实例级观察 ===");
await observeTests();
console.log("=== 本插件项置顶 ===");
orderTests();
console.log("=== 开关表一致性 ===");
scopeTableTests();

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
