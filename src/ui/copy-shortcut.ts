import type { App, Plugin } from 'obsidian';
import type { ImageTransferSettings } from '../settings';
import type { TaskActions } from '../tasks';
import { editorImagePicks, markdownViewFor } from './image-menu';

/**
 * 接管 Ctrl+C（可选）：光标处或选中内容里有图片时，复制的是**图片文件**，
 * 而不是 `![[图.png]]` 这段链接文字。
 *
 * ## 为什么接管按键而不是监听 `copy` 事件
 *
 * `copy` 事件分不出"这次是快捷键还是右键菜单点的复制"，接管了会把菜单里的"复制"也一起改掉。
 * 用户要的是"接管 Ctrl+C"，所以这里只认按键：命中才 `preventDefault`，
 * 别的时候一个字节都不碰（在别处按 Ctrl+C 复制普通文字完全不受影响）。
 *
 * ## 只在编辑器里动手
 *
 * 阅读模式的选中内容本来就不是链接文字（浏览器的选区里没有 `![[…]]`），
 * 交给 Obsidian 自己复制更合适；所以要求按下的位置在 CodeMirror 编辑器里（`.cm-editor`）。
 *
 * 取图规则与命令面板 / 右键菜单**共用同一份** `editorImagePicks`：选区里有图片就取选区里的，
 * 没有选区（光标停在图片链接上）就取光标处那一条。
 * 选区里除了图片还有文字时，文字也一起进剪贴板（QQ / 微信 里贴出来是图文混排，见 `rich-copy.ts`）——
 * 这本来也正是用户按 Ctrl+C 想要的：选了什么就复制什么。
 */

/** 按键替身：只用到这几个字段（测试里给普通对象就行） */
export interface CopyKeyEvent {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
	/** 输入法组词中（这时候的 Ctrl+C 是输入法在用，不能抢） */
	isComposing?: boolean;
}

/** 这是不是"复制"快捷键：Ctrl+C，macOS 上是 ⌘C；带别的修饰键或正在组词时不算 */
export function isCopyShortcut(evt: CopyKeyEvent): boolean {
	if (evt.isComposing === true) return false;
	if (!(evt.ctrlKey || evt.metaKey)) return false;
	if (evt.altKey || evt.shiftKey) return false;
	return evt.key.toLowerCase() === 'c';
}

/**
 * 该不该由我们复制？该的话把图片（选区里还有文字时连文字一起）放进剪贴板并返回 true。
 *
 * 判据与右键菜单那套一致：位置在编辑器里、属于某个 markdown 视图、取得到图片引用。
 */
function takeOverCopy(app: App, target: EventTarget | null, actions: TaskActions): boolean {
	const element = target as HTMLElement | null;
	if (!element || typeof element.closest !== 'function') return false;
	if (!element.closest('.cm-editor')) return false;

	const view = markdownViewFor(app, element);
	const file = view?.file ?? null;
	const editor = view?.editor;
	if (!file || !editor) return false;

	const picks = editorImagePicks(editor);
	if (picks.refs.length === 0) return false;

	void actions.copyImages(file, picks.refs, picks.selection);
	return true;
}

/**
 * 注册接管（main.ts 调用）。
 *
 * @param getSettings 开关实时读取（设置面板改完立刻生效，不用重载插件）
 */
export function registerCopyShortcut(
	plugin: Plugin,
	actions: TaskActions,
	getSettings: () => ImageTransferSettings
): void {
	const handle = (evt: KeyboardEvent): void => {
		if (getSettings().takeOverCopyShortcut !== true) return;
		if (!isCopyShortcut(evt)) return;
		if (!takeOverCopy(plugin.app, evt.target, actions)) return;

		// 拦下这一次复制：浏览器别再往剪贴板写那段链接文字（图片已经放进去了）
		evt.preventDefault();
		evt.stopPropagation();
	};

	const attach = (doc: Document): void => {
		plugin.registerDomEvent(doc, 'keydown', handle, { capture: true });
	};
	attach(document);
	// 弹出窗口各有各的 document，得单独挂一份
	plugin.registerEvent(plugin.app.workspace.on('window-open', (_window, win) => attach(win.document)));
}
