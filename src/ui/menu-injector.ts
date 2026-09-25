import type { Menu, MenuItem, TFile } from 'obsidian';
import type { ImageRef } from '../image/scan';
import type { ImageTransferSettings } from '../settings';
import { isHiddenItem, parseHiddenItems } from './menu-hidden';
import type { HiddenItems, MenuScope } from './menu-hidden';

/**
 * 右键菜单的"观察与插项"（三个菜单共用一份实现）。
 *
 * ## 为什么要接 `Menu.prototype`
 *
 * Obsidian 没给插件"往原生菜单追加一项"的接口，也没给"这个菜单里有什么"的接口：
 * 社区里的图片插件基本都自己弹一份菜单（`preventDefault` 掉原生的），代价是原生项与
 * 其它插件的项全没了。本插件不接管菜单，改成**在菜单正在建 / 将要显示的时候看一眼**：
 *
 * - `addItem`：记下这一项叫什么，并按设置里那份隐藏名单决定要不要真的加进去；
 * - `showAtMouseEvent` / `showAtPosition`：菜单已建完、还没显示 —— 我们的项在这里插，
 *   才排在所有原生项的后面（在第一个 `addItem` 时插会插进菜单中间）。
 *
 * 只有"上膛"期间才动手（右键按下的那一刻判断这次点的是图片 / 笔记正文 / 文件浏览器），
 * 其余时候三个方法都还是原来那个函数 —— 别的菜单一个字节都不碰。插件卸载时还原。
 *
 * ## 上膛与作用域
 *
 * 一次上膛 = 一次右键（见 image-menu.ts 的 mousedown）：菜单对象可能被 Obsidian 复用，
 * 所以菜单身上记的是"这次上膛的编号"，编号对不上就说明是上一次留下的记号，不能再动它。
 */

/** 这次右键点在哪、点什么 */
export interface ArmedMenu {
	scope: MenuScope;
	/** 笔记正文 / 图片嵌入所在的那篇笔记（文件夹菜单没有） */
	file?: TFile | null;
	/** 图片菜单：这次要复制的图片（选区里的那几张，或点中的这张） */
	refs?: ImageRef[];
}

export interface MenuInjectorOptions {
	getSettings: () => ImageTransferSettings;
	/** 这次右键的上下文；null = 不管，三个方法都原样放行 */
	isArmed: () => ArmedMenu | null;
	/** 菜单将要显示：把我们的项加进去（返回加进去的标题，用来把它们排到最前面） */
	onShow?: (menu: Menu, armed: ArmedMenu, detected: string[]) => string[] | void;
	/** 上膛期间看到的菜单项（每次上膛重建一份） */
	onDetected?: (scope: MenuScope, items: string[]) => void;
	/** 卸载时还原（插件里传 `plugin.register`） */
	onCleanup?: (cleanup: () => void) => void;
}

/**
 * 打给"那份菜单"的记号：值是这次上膛的编号，不是布尔 ——
 * 菜单对象可能被复用，编号对不上就说明是**上一次**右键留下的记号。
 *
 * 记在菜单对象自己身上（Symbol），而不是把 `this` 存进模块变量 —— 后者是 `no-this-alias`
 * 明确禁止的写法（闭包会多留一份菜单的引用），前者用完随菜单一起回收。
 */
const ARM_MARK = Symbol('noteTidyMenuArm');

/**
 * 打给"本插件自己的菜单项"的记号（打在**构建函数**上，见 image-menu.ts 的 addOwnMenuItems）。
 *
 * 我们自己的项也是走 `menu.addItem` 加进去的，所以一样会进这个补丁。不豁免的两条后果：
 * 1. 被"隐藏名单"误伤 —— 标题一旦进了名单，"管理右键菜单"就再也点不开（2026-09 的 bug）；
 * 2. 混进"检测到的项"里，管理面板的"其它项"一栏会列出我们自己。
 *
 * 自己的项只认自己的开关，所以**任何加法路径**（插进去的 / `editor-menu` 追加的）都不能过滤它。
 */
export const OWN_MENU_ITEM = Symbol('noteTidyOwnMenuItem');

/** 这个构建函数是在加我们自己的项吗 */
function isOwnMenuItem(builder: (item: MenuItem) => unknown): boolean {
	return (builder as { [OWN_MENU_ITEM]?: boolean })[OWN_MENU_ITEM] === true;
}

/** 我们自己的菜单项标题都带这个后缀（从 DOM 里读回来的项只能靠它认出来） */
const OWN_TITLE_SUFFIX = '（Note Tidy）';

/** 这个标题是不是我们自己加的项 */
function isOwnTitle(title: string): boolean {
	return title.trim().endsWith(OWN_TITLE_SUFFIX);
}

type MarkedMenu = Menu & { [ARM_MARK]?: number };

/**
 * 从菜单的 DOM 里读一遍项目标题。
 *
 * 菜单项渲染成 `.menu-item` 里套一个 `.menu-item-title`；分隔线没有标题，自然被跳过。
 * 读 DOM 是为了补上"在我们拿到这份菜单**之前**就加好的项" —— 那些项没有任何接口能枚举出来。
 */
function readMenuTitles(menu: Menu, doc: Document | null): string[] {
	const holder = menu as Menu & { dom?: HTMLElement };
	const root = holder.dom ?? (doc === null ? null : queryAll<HTMLElement>(doc, '.menu').pop() ?? null);
	if (!isQueryable(root)) return [];

	return queryAll(root, '.menu-item-title')
		.map(element => (element.textContent ?? '').trim())
		.filter(title => title.length > 0);
}

/** 这个对象像个能查子元素的 DOM 根吗（用 `in` 判断，免得直接访问被标 deprecated 的原生成员） */
function isQueryable(root: unknown): root is Element {
	if (root === null || root === undefined || typeof root !== 'object') return false;
	return 'findAll' in root || 'querySelectorAll' in root;
}

/**
 * 查元素：优先用 Obsidian 的 `findAll`（原生 `querySelectorAll` 在这套类型下被标了 deprecated），
 * 没有就退回 `querySelectorAll` —— 测试里的替身 DOM 只实现后者。
 */
function queryAll<T extends Element>(root: Element | Document, selector: string): T[] {
	const withFindAll = root as unknown as { findAll?: (selector: string) => T[] };
	if (typeof withFindAll.findAll === 'function') return withFindAll.findAll(selector);
	const withQuery = root as unknown as { querySelectorAll?: (selector: string) => ArrayLike<T> };
	return withQuery.querySelectorAll ? Array.from(withQuery.querySelectorAll(selector)) : [];
}

/** 当前文档（Node 里跑测试时没有 `document`，返回 null 就行） */
function currentDocument(): Document | null {
	return typeof document === 'undefined' ? null : document;
}

/**
 * 菜单的 DOM 根：优先用菜单自己的 `dom`（Obsidian 有，但没写进类型定义）；
 * 拿不到就退回到"文档里最后一个 `.menu`"。
 */
function menuRoot(menu: Menu, doc: Document | null): HTMLElement | null {
	const holder = menu as Menu & { dom?: HTMLElement };
	if (holder.dom !== undefined && holder.dom !== null) return holder.dom;
	if (doc === null) return null;

	const menus = queryAll<HTMLElement>(doc, '.menu');
	return menus.length > 0 ? (menus[menus.length - 1] as HTMLElement) : null;
}

/** 一个菜单项元素的标题（去掉二级菜单那个 › 记号） */
function menuItemTitle(element: Element): string {
	const text = (element.querySelector('.menu-item-title')?.textContent ?? '').trim();
	return text.replace(/\s*›$/, '');
}

/**
 * 把本插件加的项挪到菜单**最前面**。
 *
 * `addItem` 只能往后加，而 Obsidian 自己的项早就加好了，所以顺序只能在显示之后于 DOM 上重排。
 * 这一步紧跟着 `show*` 做（同一个任务里跑完，浏览器还没绘制），用户看不到跳动。
 *
 * @param ownTitles 我们自己的项标题（按想要的显示顺序给）
 */
export function moveOwnItemsFirst(menu: Menu, ownTitles: string[], doc: Document | null): void {
	if (ownTitles.length === 0) return;
	const root = menuRoot(menu, doc);
	if (!root) return;

	const items = queryAll(root, '.menu-item');
	const ordered = ownTitles
		.map(title => items.find(item => menuItemTitle(item) === title))
		.filter((item): item is Element => item !== undefined);
	if (ordered.length === 0) return;

	// 倒着 prepend：最终顺序就是 ownTitles 的顺序
	for (const item of [...ordered].reverse()) root.prepend(item);
}

/**
 * 把隐藏名单里的项从**已显示**的菜单里摘掉。
 *
 * 在 `addItem` 那一刻过滤只对"我们接得到的那条路"有效；而菜里的项有的是**在我们拿到它之前**
 * 就加好的（编辑器菜单尤其如此 —— 格式 / 段落设置那一批），拦不住。所以菜单显示之后
 * 再按标题把它们的 DOM 摘掉，用户就看不到了。
 *
 * 摘掉的分隔线不处理：最多留一条分隔线，比误删原生项安全。
 */
export function removeHiddenItems(
	menu: Menu,
	scope: MenuScope,
	hidden: HiddenItems,
	ownTitles: string[],
	doc: Document | null
): void {
	const root = menuRoot(menu, doc);
	if (!root) return;

	for (const item of queryAll(root, '.menu-item')) {
		const title = menuItemTitle(item);
		if (title === '' || isOwnTitle(title) || ownTitles.includes(title)) continue;
		if (!isHiddenItem(scope, title, hidden)) continue;
		item.remove();
	}
}

/**
 * 观察"Obsidian 亲手交给我们的那份菜单"（`editor-menu` / `file-menu` 事件给的实例）。
 *
 * 原型补丁（`installMenuInjector`）只对"和插件用的是同一个 `Menu` 类"的菜单有效；
 * Obsidian 自己建的**编辑器菜单**不一定走那个类 —— 表现就是笔记菜单一直读不到项目
 * （2026-09 的 bug：图片、文件夹菜单都有，唯独笔记菜单空着）。事件里拿到的是**实例**，
 * 在实例上接一层就与它是什么类无关了：
 *
 * - `addItem`：之后加进来的项都记下、也按名单过滤（事件之前就加好的项接不到，只能靠下面那条）；
 * - `showAtMouseEvent` / `showAtPosition`：确认"这份菜单真的显示了"，从菜单 DOM 里补读一遍项目、
 *   把隐藏名单里的项摘掉，并把我们自己的项挪到最前面。
 *
 * @param options.ownTitles 不在 `addItem` 那条路上、但我们自己的项（兜底用）
 */
export function observeMenuInstance(
	menu: Menu,
	options: {
		scope: MenuScope;
		getSettings: () => ImageTransferSettings;
		onDetected: (scope: MenuScope, items: string[]) => void;
		ownTitles?: string[];
	}
): void {
	const instance = menu as Menu & {
		addItem?: (builder: (item: MenuItem) => unknown) => Menu;
		showAtMouseEvent?: (evt: MouseEvent) => Menu;
		showAtPosition?: (position: { x: number; y: number }, doc?: Document) => Menu;
		__noteTidyObserved?: boolean;
	};
	if (instance.__noteTidyObserved === true) return;
	instance.__noteTidyObserved = true;

	const collected: string[] = [];
	const ownTitles: string[] = [...(options.ownTitles ?? [])];
	const record = (title: string | null | undefined): void => {
		const text = (title ?? '').trim();
		if (text === '' || isOwnTitle(text) || collected.includes(text)) return;
		collected.push(text);
	};

	const originalAddItem = instance.addItem;
	if (typeof originalAddItem === 'function') {
		instance.addItem = function (this: Menu, builder: (item: MenuItem) => unknown): Menu {
			// 我们自己的项：记下顺序（排序用），照旧只管放行
			if (isOwnMenuItem(builder)) {
				const own = probeMenuItemTitle(builder);
				if (own !== null && !ownTitles.includes(own)) ownTitles.push(own);
				return originalAddItem.call(this, builder);
			}

			const title = probeMenuItemTitle(builder);
			record(title);

			const hidden: HiddenItems = parseHiddenItems(options.getSettings().menuHiddenItems);
			if (title !== null && !isOwnTitle(title) && isHiddenItem(options.scope, title, hidden)) {
				return this;
			}
			return originalAddItem.call(this, builder);
		};
	}

	const publish = (doc: Document | null): void => {
		// 事件之前就加好的项枚举不到，从菜单 DOM 里补读；顺序按用户看到的来（DOM 顺序优先）
		const fromDom = readMenuTitles(menu, doc).filter(title => !isOwnTitle(title));
		const merged = [...fromDom, ...collected.filter(title => !fromDom.includes(title))];
		collected.splice(0, collected.length, ...merged);

		// 先摘掉隐藏名单里的项，再排序、再报检测结果（报的仍是"这个菜单里本来有哪些项"）
		removeHiddenItems(menu, options.scope, parseHiddenItems(options.getSettings().menuHiddenItems), ownTitles, doc);
		moveOwnItemsFirst(menu, ownTitles, doc);
		options.onDetected(options.scope, [...collected]);
	};

	const wrapShow = (key: 'showAtMouseEvent' | 'showAtPosition'): void => {
		const original = instance[key];
		if (typeof original !== 'function') return;
		(instance as unknown as Record<string, unknown>)[key] = function (this: Menu, ...args: unknown[]): unknown {
			const result = (original as (...callArgs: unknown[]) => unknown).apply(this, args);
			// 菜单 DOM 是显示的时候建的：等这一轮同步流程走完再读、再排序
			const doc = (args[0] as { ownerDocument?: Document } | undefined)?.ownerDocument ?? currentDocument();
			queueMicrotask(() => publish(doc));
			return result;
		};
	};
	wrapShow('showAtMouseEvent');
	wrapShow('showAtPosition');
}

/**
 * 接一层 `menuClass.prototype`（正式用法是 `Menu`；测试里传替身）。
 *
 * @returns 装上返回 true；已经装过（或类不对）返回 false
 */
export function installMenuInjector(menuClass: typeof Menu, options: MenuInjectorOptions): boolean {
	const proto = menuClass.prototype as unknown as {
		addItem: (this: Menu, builder: (item: MenuItem) => unknown) => Menu;
		showAtMouseEvent: (this: Menu, evt: MouseEvent) => Menu;
		showAtPosition: (this: Menu, position: { x: number; y: number }, direct?: boolean) => Menu;
		__noteTidyInjector?: boolean;
	};
	const originalAddItem = proto.addItem;
	const originalShowAtMouseEvent = proto.showAtMouseEvent;
	const originalShowAtPosition = proto.showAtPosition;
	if (typeof originalAddItem !== 'function' || proto.__noteTidyInjector === true) return false;

	// 每次上膛都从干净状态开始（认的是"上下文对象本身"：arm 时每次都新建一个）
	let currentArmed: ArmedMenu | null = null;
	/** 上膛编号：每次新上膛 +1，用来判断菜单身上的记号是不是这一次的 */
	let armId = 0;
	/**
	 * 这一轮里**每份菜单各自**记一份清单；只有"真的要显示的那份"才算数。
	 *
	 * 不能只认"第一份菜单"：Obsidian 的编辑器菜单带二级菜单（格式 / 块类型那一套：
	 * 正文、1 级标题…、引用、任务列表、表格、脚注、标注），而二级菜单可能比主菜单**先**建 ——
	 * 认错了就会把二级菜单的项当成"笔记菜单里有什么"（2026-09 的 bug）。
	 */
	let buffers = new Map<MarkedMenu, string[]>();
	/** 这一轮最后建的那份菜单（万一某条路径不经过 show*，兜底就认它 —— 主菜单通常最后建） */
	let lastMenu: MarkedMenu | null = null;
	/** 真要显示的那份菜单里有哪些项（管理面板看的就是它） */
	let detected: string[] = [];
	/** 这次上膛已经把项插进去了吗 */
	let surfaced = false;
	/** 兜底只排一次（见 addItem 末尾） */
	let fallbackScheduled = false;
	/**
	 * 最近一次上膛的作用域（下膛后仍留着）。
	 *
	 * 二级菜单是**之后**才弹出来的，那时早就下膛了；按这个"粘住"的作用域过滤，
	 * 用户在同一个右键菜单里展开的那一层也能生效（2026-09：文本格式 / 段落设置那一批关不掉）。
	 */
	let lastScope: MenuScope | null = null;
	let lastScopeAt = 0;
	/** 粘住的有效期：超过这个时间就认为跟刚才那次右键无关了 */
	const STICKY_SCOPE_MS = 30_000;

	/** 现在该按哪个作用域过滤（正在上膛就用它，刚上过膛就用粘住的那个） */
	const activeScope = (): MenuScope | null => {
		if (currentArmed !== null) return currentArmed.scope;
		if (lastScope !== null && Date.now() - lastScopeAt < STICKY_SCOPE_MS) return lastScope;
		return null;
	};

	/** 按名单把不该出现的项摘掉（能拦的在 addItem 就拦了，这里兜住拦不住的） */
	const dropHidden = (menu: MarkedMenu, ownTitles: string[], doc: Document | null): void => {
		const scope = activeScope();
		if (scope === null) return;
		removeHiddenItems(menu, scope, parseHiddenItems(options.getSettings().menuHiddenItems), ownTitles, doc);
	};

	/** 把我们的项加进这份菜单（只加一次，且只加在"真要显示的那份"里）；返回加进去的标题 */
	const surface = (menu: MarkedMenu, id: number | undefined): string[] => {
		if (id === undefined || id !== armId || surfaced) return [];
		const armed = currentArmed;
		if (armed === null) return [];
		surfaced = true;

		// 用户看到的只有这一份菜单，检测结果就按它记
		detected = buffers.get(menu) ?? [];
		options.onDetected?.(armed.scope, detected);
		return options.onShow?.(menu, armed, detected) ?? [];
	};

	proto.addItem = function (this: Menu, builder: (item: MenuItem) => unknown): Menu {
		const armed = options.isArmed();
		if (armed === null) return originalAddItem.call(this, builder);
		// 我们自己的项：原样放行（不过滤、不记录）—— 它只认自己的开关
		if (isOwnMenuItem(builder)) return originalAddItem.call(this, builder);

		if (armed !== currentArmed) {
			currentArmed = armed;
			armId++;
			buffers = new Map();
			lastMenu = null;
			surfaced = false;
			fallbackScheduled = false;
		}
		lastScope = armed.scope;
		lastScopeAt = Date.now();

		// 这一轮见过的菜单都记上编号：谁最后要显示，谁才是"这次右键的菜单"
		const menu = this as MarkedMenu;
		if (menu[ARM_MARK] !== armId) menu[ARM_MARK] = armId;
		lastMenu = menu;

		const title = probeMenuItemTitle(builder);
		if (title !== null) {
			const list = buffers.get(menu);
			if (list) list.push(title);
			else buffers.set(menu, [title]);
		}

		// 设置里勾掉的项：不加它（`addItem` 返回菜单本身，跳过不影响调用方）
		const hidden: HiddenItems = parseHiddenItems(options.getSettings().menuHiddenItems);
		if (title !== null && isHiddenItem(armed.scope, title, hidden)) return this;

		const added = originalAddItem.call(this, builder);

		// 兜底：万一某条路径没经过 show*，菜单建完之后的微任务里认最后那份菜单
		if (!fallbackScheduled) {
			fallbackScheduled = true;
			queueMicrotask(() => {
				if (!lastMenu) return;
				const ownTitles = surface(lastMenu, lastMenu[ARM_MARK]);
				dropHidden(lastMenu, ownTitles, currentDocument());
				moveOwnItemsFirst(lastMenu, ownTitles, currentDocument());
			});
		}

		return added;
	};

	proto.showAtMouseEvent = function (this: Menu, evt: MouseEvent): Menu {
		const menu = this as MarkedMenu;
		const ownTitles = surface(menu, menu[ARM_MARK]);
		const result = originalShowAtMouseEvent.call(this, evt);
		const doc = (evt as { view?: Window } | undefined)?.view?.document ?? currentDocument();
		dropHidden(menu, ownTitles, doc);
		moveOwnItemsFirst(menu, ownTitles, doc);
		return result;
	};

	proto.showAtPosition = function (this: Menu, position: { x: number; y: number }, direct?: boolean): Menu {
		const menu = this as MarkedMenu;
		const ownTitles = surface(menu, menu[ARM_MARK]);
		const result = originalShowAtPosition.call(this, position, direct);
		dropHidden(menu, ownTitles, currentDocument());
		moveOwnItemsFirst(menu, ownTitles, currentDocument());
		return result;
	};

	options.onCleanup?.(() => {
		proto.addItem = originalAddItem;
		proto.showAtMouseEvent = originalShowAtMouseEvent;
		proto.showAtPosition = originalShowAtPosition;
		delete proto.__noteTidyInjector;
	});
	proto.__noteTidyInjector = true;
	return true;
}

/**
 * 用替身跑一遍菜单项的构建函数，只为拿到它的标题。
 *
 * `Menu.addItem(cb)` 是"先加进去、再让 cb 配置它"，要**在加之前**判断该不该加，
 * 就得先知道标题。替身是个 Proxy：`setTitle` 记下标题，其余方法一律 no-op 并继续链式，
 * 所以 `item.setTitle(…).setIcon(…).onClick(…)` 这种写法照样跑得通。
 */
export function probeMenuItemTitle(builder: (item: MenuItem) => unknown): string | null {
	let title: string | null = null;
	const probe: unknown = new Proxy({}, {
		get: (_target, prop) => {
			if (prop === 'setTitle') {
				return (value: string | DocumentFragment) => {
					title = typeof value === 'string' ? value : value.textContent;
					return probe;
				};
			}
			return () => probe;
		},
	});

	try {
		builder(probe as MenuItem);
	} catch {
		// 有构建函数会读属性 / 调别的方法，替身接不住就算了：拿不到标题 = 不做隐藏判断
		return null;
	}
	return title;
}
