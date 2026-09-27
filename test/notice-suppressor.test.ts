/**
 * 批量期间的通知屏蔽（`src/ui/notice-suppressor.ts`）
 *
 * 运行：npm test
 *
 * 盯四件事：
 *   1. 屏蔽：批量一开始 body 上就有 `suppress-notices`，批量期间冒出来的通知补隐藏类
 *   2. **收尾不许拖**：结果通知必须**当场**弹出来（v1.3.12 修的就是"为了等旧通知过期，
 *      把每条汇总通知都晚 5 秒"）
 *   3. 旧通知：还挂在页面上的那几条继续藏着，但**不能永久藏**（常驻通知要放出来）
 *   4. 常驻容器 `.notice-container` 绝不加隐藏类（v1.1.4 的坑：加了会连带藏掉之后所有通知）
 */
import { Notice } from "obsidian";
import { NoticeSuppressor } from "../src/ui/notice-suppressor";

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

/** obsidian 替身把弹出来的通知记在 `Notice.messages`（见 test/obsidian-stub.mjs） */
const noticeLog = Notice as unknown as { messages: string[] };

function noticeMessages(): string[] {
	return noticeLog.messages;
}

// ------------------------------------------------------------------ 假 DOM
class FakeClassList {
	private readonly names = new Set<string>();

	constructor(initial: string[] = []) {
		for (const name of initial) this.names.add(name);
	}

	add(name: string): void { this.names.add(name); }
	remove(name: string): void { this.names.delete(name); }
	contains(name: string): boolean { return this.names.has(name); }
}

interface FakeElement {
	nodeType: number;
	classList: FakeClassList;
}

function elementOf(className: string): FakeElement {
	return { nodeType: 1, classList: new FakeClassList(className ? className.split(" ") : []) };
}

/** 假 MutationObserver：只记住"谁在观察"，由测试自己喂 mutation */
class FakeMutationObserver {
	static instances: FakeMutationObserver[] = [];
	observed = false;
	disconnected = false;
	private readonly callback: (mutations: Array<{ addedNodes: unknown[] }>) => void;

	constructor(callback: (mutations: Array<{ addedNodes: unknown[] }>) => void) {
		this.callback = callback;
		FakeMutationObserver.instances.push(this);
	}

	observe(): void { this.observed = true; }
	disconnect(): void { this.disconnected = true; }

	/** 模拟"有个节点被加进 DOM" */
	emit(node: unknown): void { this.callback([{ addedNodes: [node] }]); }
}

interface FakeDom {
	body: FakeElement;
	/** 现在挂在页面上的通知（查询 `.notice` 返回的就是它们） */
	notices: FakeElement[];
	/** 页面上新冒出来一条通知 */
	addNotice: (className?: string) => FakeElement;
	timers: FakeTimers;
}

interface FakeTimers {
	setTimer: (handler: () => void, ms: number) => number;
	clearTimer: (id: number) => void;
	fireAll: () => void;
	count: () => number;
	lastDelay: () => number;
}

function fakeTimers(): FakeTimers {
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

function installFakeDom(): FakeDom {
	const timers = fakeTimers();
	const body = elementOf("");
	const notices: FakeElement[] = [];
	const document = {
		body,
		querySelectorAll: (selector: string) => (selector === ".notice" ? notices.slice() : []),
	};

	const globals = globalThis as unknown as Record<string, unknown>;
	globals.document = document;
	globals.MutationObserver = FakeMutationObserver;
	globals.window = { setTimeout: timers.setTimer, clearTimeout: timers.clearTimer };
	FakeMutationObserver.instances = [];
	noticeLog.messages = [];

	return {
		body,
		notices,
		addNotice: (className = "notice") => {
			const el = elementOf(className);
			notices.push(el);
			return el;
		},
		timers,
	};
}

/**
 * 收工：把假 DOM 撤掉。
 *
 * 测试运行器把每个测试文件都塞进同一个进程，**全局是共享的** —— 留着假 `document`
 * 会让后面加载的模块（比如 CodeMirror 的浏览器探测要读 `document.documentElement.style`）
 * 直接崩掉。这几个都是浏览器全局，Node 里本来就没有，删掉即可。
 */
function uninstallFakeDom(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	delete globals.document;
	delete globals.MutationObserver;
	delete globals.window;
}

// -------------------------------------------------------------------- 用例
function suppressionTests(): void {
	const dom = installFakeDom();
	const suppressor = new NoticeSuppressor();

	suppressor.suppress();
	checkTrue("批量开始：body 上挂上 suppress-notices", dom.body.classList.contains("suppress-notices"));
	const observer = FakeMutationObserver.instances[0];
	checkTrue("批量开始：MutationObserver 在观察", observer !== undefined && observer.observed);

	// 批量期间冒出来的通知：观察者补隐藏类（CSS 之外的第二道）
	const during = dom.addNotice();
	observer?.emit(during);
	checkTrue("批量期间的通知补上隐藏类", during.classList.contains("note-tidy-suppressed"));

	// 常驻容器：绝不能加隐藏类，否则之后所有通知都会消失（v1.1.4）
	const container = elementOf("notice-container");
	observer?.emit(container);
	checkTrue("常驻容器不加隐藏类", !container.classList.contains("note-tidy-suppressed"));

	// 收尾：结果通知必须当场弹出来
	suppressor.restore("🎉 修好了");
	checkTrue("收尾：body 上的类立刻撤掉", !dom.body.classList.contains("suppress-notices"));
	checkTrue("收尾：观察者断开", observer?.disconnected === true);
	checkEqual("收尾：结果通知当场弹出（不等旧通知过期）", noticeMessages(), ["🎉 修好了"]);
	checkTrue("收尾：还没过期的旧通知继续藏着", during.classList.contains("note-tidy-suppressed"));

	// 旧通知到期自然消失；万一有不自动消失的，保险定时器也要把它放出来
	checkEqual("收尾：给旧通知留了一道保险", dom.timers.count(), 1);
	dom.timers.fireAll();
	checkTrue("旧通知不会被永久藏住", !during.classList.contains("note-tidy-suppressed"));

	// 收尾之后新弹的通知不受影响
	const after = dom.addNotice();
	checkTrue("收尾之后的通知正常显示", !after.classList.contains("note-tidy-suppressed"));

	// 没有旧通知时不留定时器
	const clean = installFakeDom();
	const cleanSuppressor = new NoticeSuppressor();
	cleanSuppressor.suppress();
	cleanSuppressor.restore("");
	checkEqual("没有旧通知就不留保险定时器", clean.timers.count(), 0);
	checkEqual("空消息不弹通知", noticeMessages(), []);

	// 卸载：撤掉屏蔽与观察者，别把 body 上的类与隐藏记号留给下一次加载
	const disposeDom = installFakeDom();
	const disposed = new NoticeSuppressor();
	disposed.suppress();
	const leftover = disposeDom.addNotice();
	FakeMutationObserver.instances[0]?.emit(leftover);
	disposed.dispose();
	checkTrue("卸载：撤掉 body 上的类", !disposeDom.body.classList.contains("suppress-notices"));
	checkTrue("卸载：旧通知的隐藏类也撤掉", !leftover.classList.contains("note-tidy-suppressed"));
	checkTrue("卸载：观察者断开", FakeMutationObserver.instances[0]?.disconnected === true);
	checkEqual("卸载：不留保险定时器", disposeDom.timers.count(), 0);
}

// -------------------------------------------------------------------- 运行
console.log("=== 屏蔽与收尾 ===");
suppressionTests();
uninstallFakeDom();

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
