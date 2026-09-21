/**
 * 智能公式测试（正文里的数学符号自动包 `$…$`）
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 笔记里的真实写法逐条钉死：`矩阵 A`、`矩阵A`、`n维`、`V(F)`、
 *      整段算式 `x = 0`、希腊字母
 *   2. 安全边界 —— 英文散文、长单词、缩写、盘符路径、型号、命名约定、代码块 / 链接 /
 *      标签 / 已有公式内部都不许动
 *   3. 开关 —— 关掉后一个字都不改
 *   4. 严格幂等 —— 包好的公式再跑一次不会被包第二层
 */
import { DEFAULT_TEXT_MATH_OPTIONS, wrapPlainMath } from "../src/text-math";

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

/** 一次检查同时覆盖"结果正确"与"幂等" */
function caseCheck(name: string, input: string, expected: string): void {
	const once = wrapPlainMath(input, DEFAULT_TEXT_MATH_OPTIONS);
	check(name, once, expected);
	check(`${name}（再跑一次不变）`, wrapPlainMath(once, DEFAULT_TEXT_MATH_OPTIONS), once);
}

/** 期望"原样不动"的用例 */
function keepCheck(name: string, input: string): void {
	caseCheck(name, input, input);
}

// ------------------------------------------------------------ 1. 该包的
function goldenTests(): void {
	// 单个字母与中文相邻
	caseCheck("矩阵 A：中文两侧", "矩阵 A 中最高阶非零子式的阶数，称为 A 的秩", "矩阵 $A$ 中最高阶非零子式的阶数，称为 $A$ 的秩");
	caseCheck("矩阵A：没有空格", "设矩阵A可逆", "设矩阵$A$可逆");
	caseCheck("量词：n维 / n 阶 / n 次", "在n维空间里，n 阶方阵要乘 n 次", "在$n$维空间里，$n$ 阶方阵要乘 $n$ 次");
	caseCheck("多个单字母：各自成块", "向量 x 与向量 y 垂直", "向量 $x$ 与向量 $y$ 垂直");
	caseCheck("向量组：字母夹在中文里", "若向量组 a 线性无关，且可由向量组 b 线性表示", "若向量组 $a$ 线性无关，且可由向量组 $b$ 线性表示");
	caseCheck("中文标点也能当锚点", "记为 V(F), 也称 V(F) 为 n 维线性空间", "记为 $V(F)$, 也称 $V(F)$ 为 $n$ 维线性空间");
	caseCheck("没有语境的单字母不动", "则 a 为 x 在基下的坐标", "则 a 为 x 在基下的坐标");

	// 字母 + 括号参数
	caseCheck("a(b)：用户给的例子", "有 a(b) 成立", "有 $a(b)$ 成立");
	caseCheck("V(F)：线性空间", "线性空间 V(F) 中的向量组称为 V(F) 的一个基", "线性空间 $V(F)$ 中的向量组称为 $V(F)$ 的一个基");
	caseCheck("T(x)：函数调用", "存在 T(x) 使得 T(x) = 0", "存在 $T(x)$ 使得 $T(x) = 0$");

	// 整段算式一起包（不能只包字母，留下 = 0 在公式外面）
	caseCheck("算式：x = 0", "且 x = 0时，恒有 V(x) = 0，对于", "且 $x = 0$时，恒有 $V(x) = 0$，对于");
	caseCheck("算式：x = Tz", "1. x = Tz：x 为原状态，z 为新状态", "1. $x = Tz$：$x$ 为原状态，z 为新状态");
	caseCheck("算式：多字符变量乘积与希腊字母", "有关系 Ax = λx 成立", "有关系 $Ax = \\lambda x$ 成立");
	caseCheck("算式：带数字", "取 k = 3 时成立", "取 $k = 3$ 时成立");
	caseCheck("算式：比较符号", "若 x > 0 则正定", "若 $x > 0$ 则正定");
	caseCheck("算式：小数", "误差 x = 1.5 之内", "误差 $x = 1.5$ 之内");
	caseCheck("算式：逗号分隔", "设 a, b ∈ F 都为非零元", "设 $a, b \\in F$ 都为非零元");
	caseCheck("算式：中文标点在段的中间", "记为 V(F), 也称 V(F) 为 n 维线性空间", "记为 $V(F)$, 也称 $V(F)$ 为 $n$ 维线性空间");

	// 希腊字母 → LaTeX 命令
	caseCheck("希腊字母：小写", "特征值 λ 对应特征向量", "特征值 $\\lambda$ 对应特征向量");
	caseCheck("希腊字母：大写", "对于 Λ 来说", "对于 $\\Lambda$ 来说");
	caseCheck("希腊字母：算式里也换", "有 ε > 0 存在", "有 $\\epsilon > 0$ 存在");
}

// ------------------------------------------------------------ 2. 不该动的
function safetyTests(): void {
	// 英文散文：没有中文锚点
	keepCheck("英文散文里的字母", "the value x is unknown");
	keepCheck("英文句子里的 a", "a matrix is defined as a function");
	keepCheck("英文书名", "- [ ] strang《introduction to linear algebra》");
	keepCheck("专有名词", "将矩阵变换为 Jordan 标准型");

	// 缩写、路径、型号、命名约定
	keepCheck("缩写 e.g.", "例如 e.g. 矩阵，i.e. 向量");
	keepCheck("盘符与路径", "文件在 C:\\data\\note.md 里");
	keepCheck("扩展名", "入口是 main.ts 与 p.js");
	keepCheck("型号 A4", "用 A4 纸打印");
	keepCheck("命名约定 Q_inv", "记作 Q_inv 与 x^2 与 a_ij 与 Δ_i > 0");
	keepCheck("专有名词后缀", "C 语言 / D 盘 / A 股 / B 站 / X 光 / O 型血");

	// 全库实测逼出来的几条：只按"紧挨中文"判定时这些全都会中招
	keepCheck("两字母缩写不是变量", "由 AI 组装，用 QQ 发送，pg 01 与 tv 都要加空格");
	keepCheck("占位命名 xx", "写 xx 条件而不是判据，xx 原则适用于任何领域");
	keepCheck("分条标签 (a)(b)", "**(a) 分块对角**；**(b) 传感器分布**");
	keepCheck("任务复选框", ["- [x] 已完成", "\t- [ ] 未完成"].join("\n"));
	keepCheck("书名号内部", "如《新 吊带袜天使》《a子计划》等");
	caseCheck("两个字母的连写要有算式才算", "流水线 A+B+C 里的 AI 模块与 ab 都算，单独的 AI 不算", "流水线 $A+B+C$ 里的 AI 模块与 ab 都算，单独的 AI 不算");
	keepCheck("列表标记", ["a. 第一项", "b) 第二项", "1. 第三项", "- 第四项"].join("\n"));
	caseCheck("表格单元格里照常包", ["| 矩阵 A | 向量 b |", "| --- | --- |"].join("\n"), ["| 矩阵 $A$ | 向量 $b$ |", "| --- | --- |"].join("\n"));

	// 保护区
	keepCheck("frontmatter", ["---", "title: 矩阵 A", "---"].join("\n"));
	keepCheck("围栏代码块", ["```sh", "A=1 # 矩阵 A", "```"].join("\n"));
	keepCheck("缩进代码块", ["正文", "", "    A = 1 与 x = 0", ""].join("\n"));
	keepCheck("行内代码", "用 `A = 1` 与 `n 维` 表示");
	keepCheck("双链与链接", "见 [[矩阵 A]] 与 [向量 b](https://a.com/x y)");
	caseCheck("URL 本身与周围单字母都不动", "参考 https://a.com/A=1 与 b 的关系", "参考 https://a.com/A=1 与 b 的关系");
	keepCheck("标签", "#矩阵A 与 #线性代数 内容");
	keepCheck("%%注释%%", "%%矩阵 A 与 x = 0%%");
	caseCheck("HTML 标签属性不动，正文照常", '<div class="A" data-x="1">矩阵 A</div>', '<div class="A" data-x="1">矩阵 $A$</div>');
	keepCheck("已有行内公式", "设 $A$ 是 $n$ 阶方阵，$V(F)$ 与 $x = 0$");
	keepCheck("已有行内显示公式后面的单字母不动（没有数学语境）", "公式：$$V(x) = {x^T}Px$$ 与后面的 A");
	caseCheck(
		"跨行公式块：内部不动，首行前缀照常",
		["设 n 个变量：$$V(x) = a \\\\", "\tp_{11} & p_{12} \\\\", "\t\\end{bmatrix}$$若 A 可逆"].join("\n"),
		["设 $n$ 个变量：$$V(x) = a \\\\", "\tp_{11} & p_{12} \\\\", "\t\\end{bmatrix}$$若 A 可逆"].join("\n")
	);

	// 开关
	check(
		"关闭后一个字都不改",
		wrapPlainMath("矩阵 A 与 n 维与 V(F) 与 λ", { wrapSymbols: false }),
		"矩阵 A 与 n 维与 V(F) 与 λ"
	);
}

// ------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		"矩阵 A 中最高阶非零子式的阶数，称为 A 的秩",
		"设矩阵A可逆，且 x = 0时恒有 V(x) = 0",
		"线性空间 V(F) 中的向量组称为 V(F) 的一个基，记为 $dim\\,V(F) = n$ 也称 V(F) 为 n 维线性空间",
		"特征值 λ 与 Λ 与 ε > 0 与 a, b ∈ F",
		"- [ ] strang《introduction to linear algebra》 与 C:\\data\\note.md",
		["---", "title: 矩阵 A 与 x = 0", "---", "", "```", "A = 1 与 n 维", "```"].join("\n"),
		["设 n 个变量：$$V(x) = a \\\\", "\tp_{11} & p_{12} \\\\", "\t\\end{bmatrix}$$若 A 可逆"].join("\n"),
	];

	for (const input of inputs) {
		const once = wrapPlainMath(input, DEFAULT_TEXT_MATH_OPTIONS);
		const twice = wrapPlainMath(once, DEFAULT_TEXT_MATH_OPTIONS);
		checkTrue("幂等失败", once === twice, `  输入 ${show(input)}\n  一次 ${show(once)}\n  二次 ${show(twice)}`);
	}
	console.log(`智能公式幂等：${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 该包的 ===");
goldenTests();

console.log("=== 2. 不该动的 ===");
safetyTests();

console.log("=== 3. 幂等 ===");
idempotencyTests();

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
