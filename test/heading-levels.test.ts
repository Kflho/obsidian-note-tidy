/**
 * 标题级别整理（src/text/heading-levels.ts）
 *
 * 运行：npm test
 *
 * 覆盖四件事：
 *   1. **子标题与父标题恰好差一级**：跳级的压平（`# → ####` 变 `# → ##`），
 *      同级保持同级，回退时回到正确的父级；
 *   2. **同时改多个标题要并行算**：新级别全部从**原始**级别一次算出，
 *      不拿"上一个标题的新级别"当依据（第 3 组用例专门辨这个：
 *      边改边算会把并列的两节推成父子）；
 *   3. **首个标题保持原级别**：`##` 起头的笔记是接着上一层分级的，不硬掰成 `#`；
 *   4. **保护区与边界**：frontmatter、围栏 / 缩进代码块、`#标签`、引用里的标题、
 *      收尾井号，以及**幂等**。
 */
import { fixHeadingLevels } from "../src/text/heading-levels";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function show(s: string): string {
	return JSON.stringify(s);
}

function check(name: string, actual: string, expected: string): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[期望输出不符] ${name}\n  期望 ${show(expected)}\n  实际 ${show(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

console.log("=== 1. 跳级压平：子标题恰好深一级 ===");
check("1 → 4 压成 1 → 2", fixHeadingLevels("# 甲\n#### 乙"), "# 甲\n## 乙");
check("2 起头 → 5 压成 2 → 3", fixHeadingLevels("## 甲\n##### 乙"), "## 甲\n### 乙");
check("1 → 3 → 6 连跳", fixHeadingLevels("# 甲\n### 乙\n###### 丙"), "# 甲\n## 乙\n### 丙");
check("已经合规的不动", fixHeadingLevels("# 甲\n## 乙\n### 丙"), "# 甲\n## 乙\n### 丙");
check("缩进标题保留缩进", fixHeadingLevels("  ## 甲\n  #### 乙"), "  ## 甲\n  ### 乙");
check("收尾井号保留", fixHeadingLevels("# 甲\n#### 乙 ##"), "# 甲\n## 乙 ##");
check("空标题（只有井号）也整理", fixHeadingLevels("#\n####"), "#\n##");

console.log("=== 2. 同级保持同级、回退回到父级 ===");
check("同级不被推成父子", fixHeadingLevels("# 甲\n### 乙\n### 丙"), "# 甲\n## 乙\n## 丙");
check("回退到父级是兄弟不是父子", fixHeadingLevels("# 甲\n### 乙\n## 丙"), "# 甲\n## 乙\n## 丙");
check("回退两级后重新开子级", fixHeadingLevels("# 甲\n## 乙\n#### 丙\n### 丁"), "# 甲\n## 乙\n### 丙\n### 丁");
check("回到最早的父级", fixHeadingLevels("# 甲\n## 乙\n### 丙\n#### 丁\n# 戊\n#### 己"), "# 甲\n## 乙\n### 丙\n#### 丁\n# 戊\n## 己");

console.log("=== 3. 并行：多个标题同时改 ===");
// 边改边算（拿上一个标题的新级别当依据）会得到 # → ## → ### → ####：
// 第三个标题原本与第二个同级，却因为"上一个已经变成 ##"而被推成子级。
check(
	"同级标题会连着改，都要按原始级别算",
	fixHeadingLevels("# 甲\n### 乙\n### 丙\n##### 丁"),
	"# 甲\n## 乙\n## 丙\n### 丁"
);
check(
	"连续回退时每一步都对着原始树",
	fixHeadingLevels("# 甲\n### 乙\n##### 丙\n## 丁\n#### 戊"),
	"# 甲\n## 乙\n### 丙\n## 丁\n### 戊"
);
check(
	"改的标题越多，结果越不能漂",
	fixHeadingLevels("## 起\n##### 一\n##### 二\n###### 三\n###### 四\n### 五"),
	"## 起\n### 一\n### 二\n#### 三\n#### 四\n### 五"
);

console.log("=== 4. 首个标题保持原级别 ===");
check("### 起头保持不变", fixHeadingLevels("### 甲\n##### 乙"), "### 甲\n#### 乙");
check("###### 起头封顶", fixHeadingLevels("###### 甲\n###### 乙"), "###### 甲\n###### 乙");
check("六级封顶不越界", fixHeadingLevels("# 甲\n## 乙\n### 丙\n#### 丁\n##### 戊\n###### 己\n###### 庚"), "# 甲\n## 乙\n### 丙\n#### 丁\n##### 戊\n###### 己\n###### 庚");

console.log("=== 5. 保护区与边界 ===");
check("frontmatter 不动", fixHeadingLevels("---\n# 甲\n---\n# 乙\n### 丙"), "---\n# 甲\n---\n# 乙\n## 丙");
check("围栏代码块不动", fixHeadingLevels("# 甲\n```\n#### 代码\n```\n### 乙"), "# 甲\n```\n#### 代码\n```\n## 乙");
check("缩进代码块不动", fixHeadingLevels("# 甲\n\n    #### 代码"), "# 甲\n\n    #### 代码");
check("#标签行不是标题（不影响层级）", fixHeadingLevels("# 甲\n#标签 #乙\n#### 丙"), "# 甲\n#标签 #乙\n## 丙");
check("标签行不算标题：首个真标题仍是基准", fixHeadingLevels("#甲 #乙\n#### 丙"), "#甲 #乙\n#### 丙");
check("引用里的标题不动", fixHeadingLevels("# 甲\n> #### 引用里的标题\n### 乙"), "# 甲\n> #### 引用里的标题\n## 乙");
check("分隔线不动", fixHeadingLevels("# 甲\n---\n### 乙"), "# 甲\n---\n## 乙");
check("没有标题时原样返回", fixHeadingLevels("正文\n\n- 列表"), "正文\n\n- 列表");
check("空内容原样返回", fixHeadingLevels(""), "");

console.log("=== 6. 幂等 ===");
const idempotentCases = [
	"# 甲\n#### 乙",
	"# 甲\n### 乙\n### 丙\n##### 丁",
	"### 甲\n##### 乙",
	"# 甲\n## 乙\n#### 丙\n### 丁",
	"---\n# 甲\n---\n# 乙\n### 丙",
	"## 起\n##### 一\n##### 二\n###### 三\n###### 四\n### 五",
];
for (const input of idempotentCases) {
	const once = fixHeadingLevels(input);
	const twice = fixHeadingLevels(once);
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
