import { countImageRefs } from '../image/scan';

/**
 * 状态栏里的「选中内容有几张图片」。
 *
 * 与 `ui/progress.ts` 同一个套路：**只管一个元素的文本**，不认识 Obsidian API，
 * 所以文案与那一格都能脱离 Obsidian 单测（`test/selection-count.test.ts`）。
 * 编辑器那边的接线在 `ui/selection-status.ts`（CodeMirror 扩展），main.ts 把两者接起来。
 *
 * "什么算一张图片"（嵌入 / 代码块里的不算 / 哪些扩展名算）全在 `image/scan.ts`，
 * 与"复制图片"共用同一份扫描 —— 这里只负责把它变成一个数字和一句文案。
 */

/**
 * 状态栏文案：一张都没有时返回空串（这一格留空，不写"0 张"占地方）。
 */
export function formatSelectionImageCount(count: number): string {
	return count > 0 ? `🖼 选中 ${count} 张图片` : '';
}

/**
 * 状态栏上的那一格。
 *
 * 与批量进度共用右下角，但**各占一个条目**：进度条在跑任务时反复改写自己的文本、
 * 完成后 5 秒清空，两者共用一个元素会互相覆盖（跑批量时选区数字会忽明忽暗）。
 */
export class SelectionImageCount {
	/** 这一格现在写着什么（只用来避免重复写 DOM） */
	private current = '';

	constructor(
		private readonly el: HTMLElement,
		/** 开关的实时读取（设置面板改完立刻生效，不用重载插件） */
		private readonly isEnabled: () => boolean
	) {}

	/** 选区变了（或设置刚改完）就重算：开关关着、没选中、选中内容里没图片都清空这一格 */
	update(selectionText: string): void {
		this.write(this.isEnabled() ? formatSelectionImageCount(countImageRefs(selectionText)) : '');
	}

	/**
	 * 只在文案真的变了才写 DOM。
	 * 选区变化很频繁（打字时每敲一下、每点一下鼠标都会走这里），
	 * 而状态栏大部分时间是空的 —— 没必要把同一个空格子反复清一遍。
	 */
	private write(text: string): void {
		if (text === this.current) return;
		this.current = text;
		this.el.setText(text);
	}
}
