import { Notice } from 'obsidian';

/**
 * 通知屏蔽（从 main.ts 抽出）。
 *
 * 批量操作时 Obsidian 会为每一次改名 / 改链接弹一条 "已修改 N 条链接"，
 * 整库跑下来能刷上百条。这里在批量期间把通知藏起来，结束后再恢复并只弹一条汇总。
 *
 * 三层，各管一段：
 * 1. body 上加 `suppress-notices`，styles.css 里按选择器隐藏 —— 零延迟，无闪烁
 * 2. MutationObserver 兜底 —— 给 CSS 漏掉的弹窗元素补一个 `note-tidy-suppressed` 类
 * 3. **收尾时把"还在页面上的旧通知"逐条打上同一个类，再立刻撤掉 body 上的类** ——
 *    结果通知因此可以**马上**弹出来（旧通知里没到期的那几条继续藏着，到期自己消失）
 *
 * 第 3 条是 v1.3.12 改的：以前是"等 5 秒让旧通知自然过期，再撤屏蔽、再弹结果"，
 * 于是每条批量任务的汇总通知都要**晚 5 秒**才出现 —— 用户看到的是"点完了没反应"。
 * 结果通知不该为旧通知陪跑。
 *
 * 一律用 class 而不是内联样式：内联样式恢复时若没清干净，会永久藏掉
 * 通知容器，连带其它插件（如 Image Converter）的弹窗一起消失（见 v1.1.4）。
 */

/** 兜底隐藏用的类名，见 styles.css */
const SUPPRESSED_CLASS = 'note-tidy-suppressed';

/**
 * 收尾后旧通知最多再藏这么久。
 *
 * 默认通知 4 秒自动消失、消失时元素一起摘掉，正常等不到这个时间；这道保险是给
 * "不自动消失"的通知留的活路 —— 一次批量不该让别的插件的常驻提示永久消失。
 */
const LEFTOVER_HIDE_MS = 6000;

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
	private suppressedElements: Set<Element> = new Set();
	private leftoverTimer: number | null = null;

	/** 开始屏蔽通知（批量操作开始时调用） */
	suppress(): void {
		document.body.classList.add('suppress-notices');

		if (!this.observer) {
			this.observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					const nodes = Array.from(mutation.addedNodes);
					for (const node of nodes) {
						// 只认通知本身（`.notice`）：`.notice-container` 是**常驻**的那个壳，
						// 给它加隐藏类会连带藏掉之后所有通知（v1.1.4 的坑）
						if (isElementNode(node) && node.classList.contains('notice')) {
							node.classList.add(SUPPRESSED_CLASS);
							this.suppressedElements.add(node);
						}
					}
				}
			});
		}
		this.observer.observe(document.body, { childList: true, subtree: true });
	}

	/**
	 * 恢复通知显示：**立刻**撤掉屏蔽、弹出操作结果。
	 *
	 * @param finalMessage 操作结果消息，空字符串则不显示
	 */
	restore(finalMessage?: string): void {
		this.release();
		if (finalMessage) {
			new Notice(finalMessage);
		}
	}

	/** 插件卸载：撤掉屏蔽与观察者，别把 body 上的类与隐藏记号留给下一次加载 */
	dispose(): void {
		this.cancelLeftoverTimer();
		this.releaseBody();
		this.unhideLeftovers();
	}

	/**
	 * 撤掉屏蔽：此刻还挂在页面上的旧通知逐条打上隐藏类，剩下的立刻放开。
	 *
	 * 两步在同一个任务里跑完，中间没有重绘 —— 旧通知不会闪一下再消失。
	 */
	private release(): void {
		this.releaseBody();
		this.hideLeftovers();
	}

	/** 撤掉 body 上的类与观察者（旧通知怎么处理由调用方决定） */
	private releaseBody(): void {
		document.body.classList.remove('suppress-notices');
		if (this.observer) {
			this.observer.disconnect();
			this.observer = null;
		}
	}

	/** 把"此刻还在页面上"的通知藏住（它们自己到期消失，不必我们清理） */
	private hideLeftovers(): void {
		this.cancelLeftoverTimer();
		this.unhideLeftovers();

		const leftovers = Array.from(document.querySelectorAll('.notice'));
		for (const el of leftovers) {
			el.classList.add(SUPPRESSED_CLASS);
			this.suppressedElements.add(el);
		}
		if (leftovers.length === 0) return;

		this.leftoverTimer = window.setTimeout(() => {
			this.leftoverTimer = null;
			this.unhideLeftovers();
		}, LEFTOVER_HIDE_MS);
	}

	private cancelLeftoverTimer(): void {
		if (this.leftoverTimer === null) return;
		window.clearTimeout(this.leftoverTimer);
		this.leftoverTimer = null;
	}

	private unhideLeftovers(): void {
		for (const el of this.suppressedElements) {
			el.classList.remove(SUPPRESSED_CLASS);
		}
		this.suppressedElements.clear();
	}
}
