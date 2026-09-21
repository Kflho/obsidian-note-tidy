import { Notice } from 'obsidian';

/**
 * 通知屏蔽（从 main.ts 抽出）。
 *
 * 批量操作时 Obsidian 会为每一次改名 / 改链接弹一条 "已修改 N 条链接"，
 * 整库跑下来能刷上百条。这里在批量期间把通知藏起来，结束后再恢复并只弹一条汇总。
 *
 * 双层策略：
 * 1. body 上加 `suppress-notices`，styles.css 里按选择器隐藏 —— 零延迟，无闪烁
 * 2. MutationObserver 兜底 —— 给 CSS 漏掉的弹窗元素补一个 `note-tidy-suppressed` 类
 *
 * 一律用 class 而不是内联样式：内联样式恢复时若没清干净，会永久藏掉
 * 通知容器，连带其它插件（如 Image Converter）的弹窗一起消失（见 v1.1.4）。
 */

/** 兜底隐藏用的类名，见 styles.css */
const SUPPRESSED_CLASS = 'note-tidy-suppressed';

/** 恢复延迟：等被屏蔽的刷屏弹窗自然过期（Obsidian 默认 notice 时长）再解除 */
const RESTORE_DELAY_MS = 5000;

/**
 * 判断一个 DOM 节点是不是元素节点。
 *
 * 不用 `node instanceof HTMLElement`：弹出窗口（popout）有自己的一套 DOM
 * 构造器，跨窗口判断会得到 false。Obsidian 给 Node 打了 `instanceOf()` 补丁，
 * 就是用来跨窗口安全判定的；老版本 App 没有这个补丁时退回 nodeType 判断。
 */
function isElementNode(node: Node): node is HTMLElement {
	if (typeof node.instanceOf === 'function') {
		return node.instanceOf(HTMLElement);
	}
	return node.nodeType === 1; // Node.ELEMENT_NODE
}

export class NoticeSuppressor {
	private observer: MutationObserver | null = null;
	private suppressedElements: Set<HTMLElement> = new Set();
	private restoreTimer: number | null = null;

	/** 开始屏蔽通知（批量操作开始时调用） */
	suppress(): void {
		// 取消上一次尚未触发的恢复定时器，避免前后两次操作竞态
		if (this.restoreTimer !== null) {
			window.clearTimeout(this.restoreTimer);
			this.restoreTimer = null;
		}
		const hadClass = document.body.classList.contains('suppress-notices');
		document.body.classList.add('suppress-notices');
		console.debug('[ImageTransfer] suppressNotices called, body had class:', hadClass);

		if (!this.observer) {
			console.debug('[ImageTransfer] Creating MutationObserver');
			this.observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					const nodes = Array.from(mutation.addedNodes);
					for (const node of nodes) {
						if (isElementNode(node)) {
							const classes = Array.from(node.classList);
							if (classes.some(c => c.includes('notice'))) {
								console.debug('[ImageTransfer] MutationObserver hiding:', classes.join(' '));
								node.classList.add(SUPPRESSED_CLASS);
								this.suppressedElements.add(node);
							}
						}
					}
				}
			});
		}
		this.observer.observe(document.body, { childList: true, subtree: true });
		console.debug('[ImageTransfer] MutationObserver started observing');
	}

	/**
	 * 恢复通知显示：延迟 5 秒等被屏蔽的弹窗过期，再解除屏蔽，最后弹出操作结果。
	 * @param finalMessage 操作结果消息，解除屏蔽后显示；空字符串则不显示
	 */
	restore(finalMessage?: string): void {
		this.restoreTimer = window.setTimeout(() => {
			this.restoreTimer = null;
			document.body.classList.remove('suppress-notices');
			if (this.observer) {
				this.observer.disconnect();
				console.debug('[ImageTransfer] MutationObserver disconnected');
			}
			// 解除 MutationObserver 加上的隐藏类
			// 否则如果 Observer 捕获到了 .notice-container 等持久容器，
			// 它会一直带着隐藏类，导致其他插件（如 Image Converter）的弹窗也消失
			for (const el of this.suppressedElements) {
				el.classList.remove(SUPPRESSED_CLASS);
			}
			this.suppressedElements.clear();

			if (finalMessage) {
				new Notice(finalMessage);
			}
		}, RESTORE_DELAY_MS);
	}
}
