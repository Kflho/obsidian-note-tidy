// eslint-disable-next-line import/no-extraneous-dependencies -- CodeMirror 由 Obsidian 自带（esbuild.config.mjs 里也是 external），这里只为拿到 ViewPlugin 的类型与实现
import { ViewPlugin } from '@codemirror/view';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * 编辑器选区变化 → 把选中文本交给回调（CodeMirror 6 扩展，main.ts 用
 * `registerEditorExtension` 装上）。
 *
 * ## 为什么要动 CodeMirror
 *
 * Obsidian 的公开事件里没有"选区变了"：`editor-change` 只在**正文改动**时触发，
 * 光拖选一段文字不会响，所以拿不到"当前选中内容"。CM6 的 ViewPlugin 恰好有
 * `update.selectionSet`（选区集合变了）与 `destroy`（编辑器没了），比在 DOM 上
 * 听 `selectionchange` 可靠 —— 那是浏览器的选区，与编辑器状态不一定同步。
 *
 * 只读不写：这里一个 transaction 都不 dispatch，纯观察，不会影响撤销栈与光标。
 */
export function selectionCountExtension(onSelectionText: (text: string) => void): Extension {
	/** 把当前选区文本交出去（多光标时各段用换行拼起来，计数不受影响） */
	const report = (view: EditorView): void => {
		const { state } = view;
		const text = state.selection.ranges
			.map(range => (range.empty ? '' : state.sliceDoc(range.from, range.to)))
			.join('\n');
		onSelectionText(text);
	};

	class SelectionObserver {
		constructor(view: EditorView) {
			// 光标刚落到这篇笔记 / 切回来时，先把当前选区报一次
			report(view);
		}

		update(viewUpdate: ViewUpdate): void {
			// 选区动了、正文改了都要重算（删掉一个 `![[图.png]]` 也得跟着减）
			if (!viewUpdate.selectionSet && !viewUpdate.docChanged) return;
			report(viewUpdate.view);
		}

		destroy(): void {
			// 编辑器没了（切到阅读视图、关掉这篇笔记）：状态栏那一格跟着清空
			onSelectionText('');
		}
	}

	return ViewPlugin.fromClass(SelectionObserver);
}
