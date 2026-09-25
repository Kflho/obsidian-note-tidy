import { MarkdownView, Menu, TFile } from 'obsidian';
import type { App, Editor, MenuItem, Plugin } from 'obsidian';
import { basePathOf, vaultPathFromResourceUrl } from '../image/copy';
import type { CopySelection } from '../image/rich-copy';
import { pickImageRefs } from '../image/scan';
import type { ImageRef } from '../image/scan';
import type { ImageTransferSettings } from '../settings';
import type { TaskActions } from '../tasks';
import { OWN_MENU_ITEM, installMenuInjector, observeMenuInstance } from './menu-injector';
import type { ArmedMenu } from './menu-injector';
import type { MenuScope } from './menu-hidden';

/**
 * 本插件往右键菜单里加的项，以及"这次右键点的是什么"的判断。
 *
 * ## 三个菜单、两种加法
 *
 * | 菜单 | 怎么加 | 备注 |
 * | --- | --- | --- |
 * | 笔记正文（`editor-menu`） | Obsidian 自己的事件，直接追加 | 官方口子，最稳 |
 * | 笔记里渲染出来的图片 | 菜单将要显示时插进去（见 menu-injector.ts） | 没有事件可用，只能接 `Menu.prototype` |
 * | 文件浏览器 | 不用加（本插件的"图片功能 / 文本排版"二级栏走 `file-menu`） | 只参与"检测 + 隐藏" |
 *
 * 三个菜单都进同一套"检测 + 隐藏"：右键按下的那一刻判断作用域（图片 / 笔记 / 文件夹），
 * 之后那份菜单里加了什么都会被记下来，设置里勾掉的项不会被加进去。管理面板见
 * menu-manage-modal.ts。
 *
 * ## 为什么不接管菜单
 *
 * 社区里的图片插件基本都自己弹一份菜单（`preventDefault` 掉原生的），代价是原生项与
 * 其它插件加的项全没了。这里只**往里插自己的项**，谁都不删。
 *
 * ## 菜单项为什么都带"（Note Tidy）"
 *
 * 原生菜单里本来就有一项"复制图片"（复制的是位图，粘不到文件夹），不写清楚用户分不出
 * 点的是哪一个。
 */

/** 管理面板那一项（标题固定，设置里按标题隐藏它时用得上） */
export const MANAGE_MENU_TITLE = '管理右键菜单…（Note Tidy）';

/** 快速设置大小那一项 */
export const QUICK_SIZE_MENU_TITLE = '快速设置图片大小（Note Tidy）';

/** 我们自己往菜单里加的一项 */
export interface OwnMenuEntry {
	title: string;
	icon: string;
	action: () => void;
}

/** 本插件菜单项的键（设置里的开关、管理面板、命令审计都按它对齐） */
export type OwnItemKey = 'copy' | 'quickSize' | 'manage' | 'imageSubmenu' | 'textSubmenu';

/** 文件菜单里那两个二级栏的标题（`menus.ts` 用它加菜单，面板用它显示） */
export const IMAGE_SUBMENU_TITLE = '图片功能';
export const TEXT_SUBMENU_TITLE = '文本排版';

/**
 * 这五项各自的图标与说明（管理面板显示用）。
 * 标题不放这儿：`copy` 那条会写成"复制 3 张图片"，按张数算。
 */
export const OWN_ITEMS: Record<OwnItemKey, { title: string; icon: string; desc: string }> = {
	copy: { title: '复制图片（Note Tidy）', icon: 'copy', desc: '复制图片文件，可粘贴到文件夹或聊天窗口' },
	quickSize: { title: QUICK_SIZE_MENU_TITLE, icon: 'image', desc: '使用默认尺寸直接修改当前笔记的图片大小，不弹出设置窗口' },
	manage: { title: MANAGE_MENU_TITLE, icon: 'settings-2', desc: '打开本面板；关闭后可从命令面板打开' },
	imageSubmenu: { title: IMAGE_SUBMENU_TITLE, icon: 'image', desc: '转换外部图片、重命名、整理位置、设置大小' },
	textSubmenu: { title: TEXT_SUBMENU_TITLE, icon: 'message-square', desc: '修复笔记排版（空格 / 缩进 / 聊天记录 / 标签 / 公式）' },
};

/**
 * 本插件的五项分别出现在哪些菜单里（管理面板按这一层分节显示）。
 * 与实现是同一份事实，改一处记得改另一处 —— test/image-menu.test.ts 会对着核。
 */
export const OWN_ITEM_SCOPES: Record<OwnItemKey, MenuScope[]> = {
	copy: ['image', 'note'],
	quickSize: ['image', 'note'],
	manage: ['image', 'note', 'folder'],
	imageSubmenu: ['folder'],
	textSubmenu: ['folder'],
};

/** 由本模块**插进菜单**的项；其余自有项（文件菜单那两个二级栏）由 `menus.ts` 加 */
export const INJECTED_ITEM_KEYS: OwnItemKey[] = ['copy', 'quickSize', 'manage'];

/**
 * 本插件自己的菜单项 ↔ 命令 ID。
 *
 * 右键菜单里的每一项都必须在命令面板里有对应命令（`test/commands.test.ts` 会照着核）——
 * 文件菜单与编辑器菜单由那两张审计表看着，**注入进图片 / 文件夹菜单的项**就靠这张表。
 * `null` = 容器项（二级栏）：它本身不是命令，里面的每条命令都在文件菜单审计表里。
 */
export const OWN_ITEM_COMMANDS: Record<OwnItemKey, string | null> = {
	copy: 'copy-images-to-clipboard',
	quickSize: 'quick-set-image-size-current-note',
	manage: 'manage-image-menu',
	imageSubmenu: null,
	textSubmenu: null,
};

/** 三个菜单各自"最近一次右键时看到的项"（管理面板靠它列清单） */
const detectedByScope: Record<MenuScope, string[]> = { image: [], note: [], folder: [] };

/** 某个菜单最近一次检测到的项（副本，调用方改不到内部状态） */
export function lastDetectedMenuItems(scope: MenuScope): string[] {
	return [...detectedByScope[scope]];
}

/** 记下某个菜单最近一次看到的项目（`menus.ts` 观察文件菜单时也往这里写） */
export function recordDetectedMenuItems(scope: MenuScope, items: string[]): void {
	detectedByScope[scope] = [...items];
}

/** 菜单 / 提示里的文案：一张就说"复制图片"，多张说"复制 N 张图片" */
export function copyMenuTitle(count: number): string {
	return count > 1 ? `复制 ${count} 张图片（Note Tidy）` : '复制图片（Note Tidy）';
}

/**
 * 我们自己这一轮要加进菜单的项（顺序即显示顺序）。
 *
 * - 「复制图片」「快速设置图片大小」：只在**笔记内**两个菜单里有（图片菜单 + 正文菜单）——
 *   文件夹菜单里没有图可复制，也没有"当前笔记"可改大小；
 * - 「管理右键菜单」：**三个菜单里都给**。它就是这套管理功能的入口，
 *   哪个菜单里没有它，用户在那个菜单里就找不到北（2026-09 的反馈）。
 *
 * 开关一律"开着 = 显示"。**自己的项只认自己的开关，绝不走"按标题隐藏"那条路**
 * （见 menu-injector.ts 的 OWN_MENU_ITEM）。
 */
export function ownMenuEntries(options: {
	scope: MenuScope;
	settings: ImageTransferSettings;
	/** 这次涉及哪些图片（空数组 = 不插"复制图片"） */
	refs: ImageRef[];
	/** 有没有笔记可操作（"快速设置图片大小"要整篇笔记） */
	hasFile: boolean;
	copy: () => void;
	quickSize: () => void;
	manage: () => void;
}): OwnMenuEntry[] {
	const entries: OwnMenuEntry[] = [];
	const insideNote = options.scope !== 'folder';

	if (insideNote && options.settings.imageMenuCopyItem !== false && options.refs.length > 0) {
		entries.push({ title: copyMenuTitle(options.refs.length), icon: OWN_ITEMS.copy.icon, action: options.copy });
	}
	if (insideNote && options.settings.imageMenuQuickSizeItem !== false && options.hasFile) {
		entries.push({ title: QUICK_SIZE_MENU_TITLE, icon: OWN_ITEMS.quickSize.icon, action: options.quickSize });
	}
	if (options.settings.imageMenuManageItem !== false) {
		entries.push({ title: MANAGE_MENU_TITLE, icon: OWN_ITEMS.manage.icon, action: options.manage });
	}

	return entries;
}

/**
 * 把我们的项加进一份菜单（三个入口共用）。
 *
 * 每一项的构建函数都打上 `OWN_MENU_ITEM` 记号：注入器看到记号就原样放行 ——
 * 我们自己的项不会被隐藏名单误伤，也不会混进"检测到的项"里。
 */
export function addOwnMenuItems(menu: Menu, entries: OwnMenuEntry[]): void {
	for (const entry of entries) {
		const builder = (item: MenuItem): void => {
			item.setTitle(entry.title).setIcon(entry.icon).onClick(entry.action);
		};
		(builder as { [OWN_MENU_ITEM]?: boolean })[OWN_MENU_ITEM] = true;
		menu.addItem(builder);
	}
}

/**
 * 编辑器里这次涉及的图片 + 选区原文。
 *
 * 选区里有图片就取选区里的（批量），没有才回退到光标处那一条
 * （右键点在图片上时，光标就在那条链接里）。
 * 选区原文一并给出：里面有文字时"复制图片"要连文字一起复制（图文混排，见 `rich-copy.ts`）。
 */
export function editorImagePicks(editor: Editor): { refs: ImageRef[]; selection: CopySelection | null } {
	const from = editor.posToOffset(editor.getCursor('from'));
	const to = editor.posToOffset(editor.getCursor('to'));
	const selection = to > from ? { from, to } : null;

	return {
		refs: pickImageRefs(editor.getValue(), editor.posToOffset(editor.getCursor()), selection),
		selection: selection ? { text: editor.getSelection(), from: selection.from } : null,
	};
}

/** 只要图片引用时用它（判定与 `editorImagePicks` 完全同一份） */
export function editorImageRefs(editor: Editor): ImageRef[] {
	return editorImagePicks(editor).refs;
}

// ------------------------------------------------------------------ 上膛

/** 这次右键的上下文；null = 没上膛（注入器一律原样放行） */
let armed: ArmedMenu | null = null;

/** 上膛（右键按下时调用）：把"这次点的是什么"记下来，等菜单建好 */
function armMenu(doc: Document, context: ArmedMenu): void {
	armed = context;

	// 下膛只认自己这一次（连着右键两下时，先来的那个定时器不能把后来的清掉）
	const disarm = (): void => {
		if (armed === context) armed = null;
	};
	// contextmenu 派发完（菜单就是在这次派发里建的）就下膛；没等到 contextmenu（按 Esc、拖动）时兜底超时
	doc.addEventListener('contextmenu', () => { window.setTimeout(disarm, 0); }, { capture: true, once: true });
	window.setTimeout(disarm, 1500);
}

/**
 * 这次右键点在哪？三种作用域各自判断：
 * 笔记里渲染出来的图片 → `image`；笔记正文 → `note`；文件浏览器 → `folder`。
 * 都不沾（画布、悬浮预览、状态栏…）就返回 null，那份菜单我们完全不管。
 */
function armedMenuFor(app: App, evt: MouseEvent): ArmedMenu | null {
	if (evt.button !== 2) return null;

	const element = evt.target as HTMLElement | null;
	if (!element || typeof element.closest !== 'function') return null;

	// ① 笔记里渲染出来的图片（阅读模式与 Live Preview 都算）
	const image = element.closest('img');
	if (image) {
		const view = markdownViewFor(app, image);
		const file = view?.file ?? null;
		if (!view || !file) return null;
		const refs = renderedImageRefs(app, view, image);
		return refs.length > 0 ? { scope: 'image', file, refs } : null;
	}

	// ② 笔记正文（编辑器菜单 / 阅读模式的文字菜单）
	const view = markdownViewFor(app, element);
	if (view) return { scope: 'note', file: view.file ?? null };

	// ③ 文件浏览器（文件、文件夹、空白处都算）
	if (element.closest('.workspace-leaf-content[data-type="file-explorer"]')) return { scope: 'folder' };

	return null;
}

/**
 * 注册右键菜单相关的三个入口（main.ts 调用）。
 *
 * @param plugin 挂事件（走 register* 助手，卸载时自动清掉）
 * @param actions 任务实现
 * @param getSettings 读设置（开关与隐藏名单实时生效，不用重载插件）
 */
export function registerImageMenu(
	plugin: Plugin,
	actions: TaskActions,
	getSettings: () => ImageTransferSettings
): void {
	const app = plugin.app;

	// 入口一：笔记正文右键 —— Obsidian 自己的编辑器菜单，直接追加
	plugin.registerEvent(
		app.workspace.on('editor-menu', (menu, editor, info) => {
			// 这份菜单的实例先纳入观察：编辑器菜单不一定走插件的 Menu 类，
			// 光靠原型补丁读不到它加了什么（笔记菜单一直是空的就是这个原因）
			observeMenuInstance(menu, {
				scope: 'note',
				getSettings,
				onDetected: (scope, items) => { recordDetectedMenuItems(scope, items); },
			});

			const file = info.file;
			const picks = editorImagePicks(editor);
			const refs = picks.refs;
			addOwnMenuItems(menu, ownMenuEntries({
				scope: 'note',
				settings: getSettings(),
				refs,
				hasFile: file !== null,
				copy: () => { if (file) void actions.copyImages(file, refs, picks.selection); },
				quickSize: () => { if (file) void actions.quickSetImageSize(file); },
				manage: () => actions.openMenuManager(),
			}));
		})
	);

	// 入口二 / 三：图片菜单与文件夹菜单 —— 都在菜单将要显示时插我们的项（检测与隐藏也在这条路上）
	installMenuInjector(Menu, {
		getSettings,
		isArmed: () => armed,
		onDetected: (scope, items) => { recordDetectedMenuItems(scope, items); },
		onShow: (menu, context) => {
			// 笔记正文菜单走上面的 editor-menu（官方口子），这里不用插
			if (context.scope === 'note') return [];

			// 文件夹菜单里只有"管理右键菜单"（没有图可复制、也没有"当前笔记"可改大小）
			const file = context.file ?? null;
			const refs = context.refs ?? [];
			const entries = ownMenuEntries({
				scope: context.scope,
				settings: getSettings(),
				refs,
				hasFile: file !== null,
				copy: () => { if (file) void actions.copyImages(file, refs); },
				quickSize: () => { if (file) void actions.quickSetImageSize(file); },
				manage: () => actions.openMenuManager(),
			});
			addOwnMenuItems(menu, entries);
			// 返回加进去的标题：菜单显示后要按这个把它们挪到最前面
			return entries.map(entry => entry.title);
		},
		onCleanup: (cleanup) => plugin.register(cleanup),
	});

	const attach = (doc: Document): void => {
		plugin.registerDomEvent(doc, 'mousedown', (evt: MouseEvent) => {
			const context = armedMenuFor(app, evt);
			if (context) armMenu(doc, context);
		}, { capture: true });
	};
	attach(document);
	// 弹出窗口各有各的 document，得单独挂一份
	plugin.registerEvent(app.workspace.on('window-open', (_workspaceWindow, win) => attach(win.document)));
}

// ------------------------------------------------------------------ DOM 侧辅助

/** 这个元素属于哪个 markdown 视图（多面板 / 弹出窗口里不能只看"当前视图"） */
export function markdownViewFor(app: App, element: HTMLElement): MarkdownView | null {
	for (const leaf of app.workspace.getLeavesOfType('markdown')) {
		const view = leaf.view;
		if (view instanceof MarkdownView && view.contentEl.contains(element)) return view;
	}
	return null;
}

/** 这次要复制的图片：DOM 选区跨过的那些，没选就只复制点中的这张 */
function renderedImageRefs(app: App, view: MarkdownView, image: HTMLImageElement): ImageRef[] {
	const selected = imagesInSelection(image, view);
	const refs: ImageRef[] = [];
	for (const element of selected.length > 0 ? selected : [image]) {
		const ref = imageRefOf(app, view, element);
		if (ref) refs.push(ref);
	}
	return refs;
}

/** DOM 选区跨过了视图里的哪几张图（没选中 / 选区里没有图时返回空数组） */
function imagesInSelection(image: HTMLImageElement, view: MarkdownView): HTMLImageElement[] {
	const selection = image.ownerDocument.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return [];

	const range = selection.getRangeAt(0);
	return Array.from(view.contentEl.querySelectorAll('img'))
		.filter(candidate => range.intersectsNode(candidate));
}

/** 一个 `<img>` 元素 → 一条图片引用；解析不出仓库文件时返回 null */
function imageRefOf(app: App, view: MarkdownView, image: HTMLImageElement): ImageRef | null {
	const sourcePath = view.file?.path;
	if (!sourcePath) return null;

	const target = linkTargetOf(app, image);
	if (!target) return null;

	// 同步确认"这张图在仓库里"：确认不了就不管这个菜单
	const native = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	const file = native instanceof TFile ? native : app.vault.getAbstractFileByPath(target);
	return file instanceof TFile ? { target, kind: 'wiki', from: 0, to: 0 } : null;
}

/**
 * 从元素上取出链接目标。
 *
 * 优先 `internal-embed` 的 `src`（Obsidian 渲染嵌入时把原始链接写在这里，
 * 可能带 `../` 前缀）；拿不到才退回到 `img.src` 里的资源 URL（`app://local/…`）。
 */
function linkTargetOf(app: App, image: HTMLImageElement): string | null {
	const embedSrc = image.closest('.internal-embed')?.getAttribute('src') ?? '';
	const src = (embedSrc || image.getAttribute('src') || '').trim();
	if (src === '') return null;

	if (!src.includes('://')) return src.replace(/^(\.\.\/)+/, '');

	const basePath = basePathOf(app);
	return basePath ? vaultPathFromResourceUrl(src, basePath) : null;
}
