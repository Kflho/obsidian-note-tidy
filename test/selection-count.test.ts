/**
 * 状态栏「选中内容的图片张数」测试
 *
 * 运行：npm test
 *
 * "什么算一张图片"由 `src/image/scan.ts` 负责，测试在 test/image-scan.test.ts；
 * 这里只管这一格本身：文案、开关的实时读取、以及"文案没变不重复写 DOM"。
 */
import { SelectionImageCount, formatSelectionImageCount } from "../src/ui/selection-count";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n  ${detail}`);
}

/** 造一个只认 setText 的元素替身（真实状态栏条目也只用这一个方法） */
function createEl(): { el: HTMLElement; text: () => string; writes: () => number } {
	let current = "";
	let writes = 0;
	const el = {
		setText(text: string) {
			current = text;
			writes++;
		},
	};
	return { el: el as unknown as HTMLElement, text: () => current, writes: () => writes };
}

// -------------------------------------------------------------------- 用例
checkEqual("没有图片时留空", formatSelectionImageCount(0), "");
checkEqual("一张", formatSelectionImageCount(1), "🖼 选中 1 张图片");
checkEqual("多张", formatSelectionImageCount(12), "🖼 选中 12 张图片");

const enabled = createEl();
const counter = new SelectionImageCount(enabled.el, () => true);
counter.update("![[图.png]] 与 ![说明](图.png)");
checkEqual("开关开启：显示张数", enabled.text(), "🖼 选中 2 张图片");
counter.update("");
checkEqual("开关开启：没有选中就清空", enabled.text(), "");
counter.update("只有正文");
checkEqual("开关开启：选中内容里没有图片就清空", enabled.text(), "");
counter.update("```\n![[图.png]]\n```");
checkEqual("开关开启：代码块里的不算", enabled.text(), "");

// 打字时选区变化极频繁，文案没变就别再写 DOM
const before = enabled.writes();
counter.update("还是一段没有图片的正文");
counter.update("");
checkEqual("文案没变时不重复写 DOM", enabled.writes(), before);

// 开关是每次实时读取的：面板里关掉之后不用重载插件，下一次刷新就空
let on = true;
const disabled = createEl();
const live = new SelectionImageCount(disabled.el, () => on);
live.update("![[图.png]]");
checkEqual("开关开启时先显示出来", disabled.text(), "🖼 选中 1 张图片");
on = false;
live.update("![[图.png]]");
checkEqual("开关关掉后清空", disabled.text(), "");
checkTrue("关掉后元素文本是空串（状态栏那一格不占地方）", disabled.text() === "", `实际 ${JSON.stringify(disabled.text())}`);

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
