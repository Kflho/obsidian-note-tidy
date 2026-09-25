/**
 * 接管 Ctrl+C（可选项）的按键判定测试
 *
 * 运行：npm test
 *
 * 真正"复制了什么"要 Obsidian 里才验得了（进程、剪贴板都在那边），
 * 这里守住最容易出错的一环：**什么时候该抢这个键**——只有正正经经的复制快捷键才算，
 * 带别的修饰键、输入法组词、macOS 的 ⌘C 各有各的答案。
 */
import { isCopyShortcut } from "../src/ui/copy-shortcut";
import type { CopyKeyEvent } from "../src/ui/copy-shortcut";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

/** 造一个按键事件替身（只用到这几个字段） */
function key(keyName: string, modifiers: Partial<CopyKeyEvent> = {}): CopyKeyEvent {
	return {
		key: keyName,
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		shiftKey: false,
		...modifiers,
	};
}

// -------------------------------------------------------------------- 用例
checkEqual("Ctrl+C 算", isCopyShortcut(key("c", { ctrlKey: true })), true);
checkEqual("macOS 的 ⌘C 算", isCopyShortcut(key("c", { metaKey: true })), true);
checkEqual("大写 C（按住 Shift 之外的来源）也认", isCopyShortcut(key("C", { ctrlKey: true })), true);

checkEqual("Ctrl+Shift+C 不算（那是别的命令）", isCopyShortcut(key("c", { ctrlKey: true, shiftKey: true })), false);
checkEqual("Ctrl+Alt+C 不算", isCopyShortcut(key("c", { ctrlKey: true, altKey: true })), false);
checkEqual("只按 C 不算", isCopyShortcut(key("c")), false);
checkEqual("Ctrl+V 不算", isCopyShortcut(key("v", { ctrlKey: true })), false);
checkEqual("Ctrl+X 不算", isCopyShortcut(key("x", { ctrlKey: true })), false);
checkEqual("输入法组词中的 Ctrl+C 不算（那是输入法在用）",
	isCopyShortcut(key("c", { ctrlKey: true, isComposing: true })), false);
checkEqual("空 key 不算", isCopyShortcut(key("", { ctrlKey: true })), false);

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
