/**
 * 列表序号整理（src/text/list-numbering.ts）
 *
 * 运行：npm test
 *
 * 覆盖四件事：
 *   1. **首项不是 1 → 整段重排**（`3. 4. 5.` → `1. 2. 3.`），分隔符、编号后的空白、
 *      内容一个字都不动；
 *   2. **首项已经是 1 的一律不动** —— `1. 1. 1.`、`1. 5. 9.` 都是作者故意写的形态；
 *   3. **列表边界**：空行不断列表、段落切断列表、嵌套列表各自从 1、懒续行不算新列表、
 *      frontmatter / 代码块 / 表格行一律当边界；
 *   4. **幂等**：整理过的内容再跑一次不会有任何变化。
 */
import { fixListNumbers } from "../src/text/list-numbering";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function show(s: string): string {
	return JSON.stringify(s);
}

function check(name: string, actual: string, expected: string): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[期望输出不符] ${name}\n  输入 ${show(expected)}\n  实际 ${show(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

console.log("=== 1. 首项不是 1：整段从 1 起重排 ===");
check("3/4/5 → 1/2/3", fixListNumbers("3. 甲\n4. 乙\n5. 丙"), "1. 甲\n2. 乙\n3. 丙");
check("单项列表 7 → 1", fixListNumbers("7. 只有一项"), "1. 只有一项");
check("0 开头 → 1 开头", fixListNumbers("0. 甲\n1. 乙"), "1. 甲\n2. 乙");
check("括号分隔符保留", fixListNumbers("2) 甲\n3) 乙"), "1) 甲\n2) 乙");
check("编号后的多个空格保留", fixListNumbers("4.    甲\n5.    乙"), "1.    甲\n2.    乙");
check("内容一字不动", fixListNumbers("9. `code` 与 $x$ 和 [[链接]]"), "1. `code` 与 $x$ 和 [[链接]]");
check("十项以上不加前导零", fixListNumbers("2. 1\n3. 2\n4. 3\n5. 4\n6. 5\n7. 6\n8. 7\n9. 8\n10. 9\n11. 10\n12. 11"), "1. 1\n2. 2\n3. 3\n4. 4\n5. 5\n6. 6\n7. 7\n8. 8\n9. 9\n10. 10\n11. 11");
check("引用里的列表", fixListNumbers("> 3. 甲\n> 4. 乙"), "> 1. 甲\n> 2. 乙");
check("多级引用里的列表", fixListNumbers("> > 5. 甲\n> > 6. 乙"), "> > 1. 甲\n> > 2. 乙");

console.log("=== 2. 首项已经是 1：一律不动 ===");
check("1/2/3 不变", fixListNumbers("1. 甲\n2. 乙\n3. 丙"), "1. 甲\n2. 乙\n3. 丙");
check("全写 1 不变（靠 Markdown 自动递增）", fixListNumbers("1. 甲\n1. 乙\n1. 丙"), "1. 甲\n1. 乙\n1. 丙");
check("1/5/9 不变（作者自己的节奏）", fixListNumbers("1. 甲\n5. 乙\n9. 丙"), "1. 甲\n5. 乙\n9. 丙");
check("单项 1 不变", fixListNumbers("1. 只有一项"), "1. 只有一项");

console.log("=== 3. 列表边界 ===");
check("空行不断列表（松列表）", fixListNumbers("2. 甲\n\n3. 乙"), "1. 甲\n\n2. 乙");
check("空行后的段落切断列表：两个列表各自从 1", fixListNumbers("2. 甲\n\n正文\n\n3. 乙"), "1. 甲\n\n正文\n\n1. 乙");
check("嵌套列表各自从 1", fixListNumbers("2. 父\n\t3. 子\n\t4. 子二\n5. 父二"), "1. 父\n\t1. 子\n\t2. 子二\n2. 父二");
check("懒续行不切断", fixListNumbers("3. 甲\n续行\n4. 乙"), "1. 甲\n续行\n2. 乙");
check("子列表结束后父列表继续编号", fixListNumbers("2. 父\n\t9. 子\n3. 父二"), "1. 父\n\t1. 子\n2. 父二");
check("同一层但引用深度不同算两个列表", fixListNumbers("3. 甲\n> 9. 乙"), "1. 甲\n> 1. 乙");

console.log("=== 4. 保护区 ===");
check("frontmatter 不动", fixListNumbers("---\ntitle: 3. 甲\n---\n3. 乙"), "---\ntitle: 3. 甲\n---\n1. 乙");
check("围栏代码块不动", fixListNumbers("```\n3. 代码\n```\n3. 正文"), "```\n3. 代码\n```\n1. 正文");
check("缩进代码块不动", fixListNumbers("正文\n\n    3. 代码"), "正文\n\n    3. 代码");
check("表格行不算列表", fixListNumbers("| 3. 甲 | 乙 |\n| --- | --- |"), "| 3. 甲 | 乙 |\n| --- | --- |");
check("代码块切断列表：前后两个列表各自从 1", fixListNumbers("3. 甲\n\n```\n3. 代码\n```\n\n4. 乙"), "1. 甲\n\n```\n3. 代码\n```\n\n1. 乙");

console.log("=== 5. 不是列表的行 ===");
check("无序列表不动", fixListNumbers("- 甲\n- 乙"), "- 甲\n- 乙");
check("正文不动", fixListNumbers("正文里出现 3. 甲 这种写法"), "正文里出现 3. 甲 这种写法");
check("版本号不算列表项", fixListNumbers("1.2 版本说明"), "1.2 版本说明");
check("编号后没有空白不算列表项", fixListNumbers("3.甲"), "3.甲");
check("时间不算列表项", fixListNumbers("12:30 开会"), "12:30 开会");
check("空内容原样返回", fixListNumbers(""), "");

console.log("=== 6. 幂等 ===");
const idempotentCases = [
	"3. 甲\n4. 乙\n5. 丙",
	"2. 父\n\t3. 子\n\t4. 子二\n5. 父二",
	"2. 甲\n\n正文\n\n3. 乙",
	"---\ntitle: 3. 甲\n---\n3. 乙",
	"1. 甲\n1. 乙",
	"> 3. 甲\n> 4. 乙",
];
for (const input of idempotentCases) {
	const once = fixListNumbers(input);
	const twice = fixListNumbers(once);
	checkTrue(`幂等：${show(input)}`, once === twice, `第一次 ${show(once)}\n  第二次 ${show(twice)}`);
}

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
