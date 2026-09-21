/**
 * 空格排版测试（排版格式：中文 / 英文 / 数字 / 公式 / 标点之间的距离）
 *
 * 运行：npm test
 *
 * 分四级保证：
 *   1. 期望输出（golden）—— 八条规则逐条钉死
 *   2. 安全边界 —— frontmatter、代码块（围栏与缩进）、`$$…$$`、行内代码、
 *      双链与链接、URL、HTML 标签、%%注释%%、#标签 内部一个字符都不动
 *   3. 开关生效 —— 每条规则关闭后确实不动；全部关闭时整篇跳过
 *   4. 严格幂等 —— 排好版的内容再跑一次不变（否则每次保存都会重写文件）
 */
import { DEFAULT_SPACING_OPTIONS, fixSpacing } from "../src/spacing";
import type { SpacingOptions } from "../src/spacing";

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

/** 一次检查同时覆盖"结果正确"与"幂等"两件事 */
function caseCheck(name: string, input: string, expected: string, options: SpacingOptions = DEFAULT_SPACING_OPTIONS): void {
	const once = fixSpacing(input, options);
	check(name, once, expected);
	check(`${name}（再跑一次不变）`, fixSpacing(once, options), once);
}

// ------------------------------------------------------------ 1. 八条规则
function ruleTests(): void {
	// 规则 1：中文 ↔ 英文
	caseCheck("中英：补空格", "用anki卡片记笔记", "用 anki 卡片记笔记");
	caseCheck("中英：已经空开的保持一个", "用  anki   卡片", "用 anki 卡片");
	caseCheck("中英：两侧同时补", "中文English混排", "中文 English 混排");
	caseCheck("中英：英文单词整体处理", "程序用JavaScript写", "程序用 JavaScript 写");
	caseCheck("中英：行内代码与英文等价", "用`code`标记", "用 `code` 标记");
	caseCheck("中英：双链与英文等价", "见[[备注]]内容", "见 [[备注]] 内容");
	caseCheck("中英：markdown 链接与英文等价", "见[备注](https://a.com/x)内容", "见 [备注](https://a.com/x) 内容");
	caseCheck(
		"中英：关闭后不动",
		"用anki卡片记笔记",
		"用anki卡片记笔记",
		{ ...DEFAULT_SPACING_OPTIONS, cjkLatin: "keep" }
	);

	// 规则 2：中文 ↔ 数字（按笔记规则：不留空格）
	caseCheck("中数：删掉已有空格", "第 3 章 的内容", "第3章 的内容");
	caseCheck("中数：本来就贴在一起的不动", "最多记6个任务", "最多记6个任务");
	caseCheck("中数：日期同样处理", "2024 年 1 月 5 日", "2024年1月5日");
	caseCheck(
		"中数：改成空一个字宽",
		"第3章",
		"第 3 章",
		{ ...DEFAULT_SPACING_OPTIONS, cjkDigit: "space" }
	);
	caseCheck(
		"中数：保持原样",
		"第 3 章",
		"第 3 章",
		{ ...DEFAULT_SPACING_OPTIONS, cjkDigit: "keep" }
	);

	// 规则 3：英文 ↔ 数字（默认不动）
	caseCheck("英数：默认拆不开 GPT4", "GPT4 与 3D 打印", "GPT4 与 3D 打印");
	caseCheck("英数：默认不动版本号", "版本 v1.2.2 更新", "版本 v1.2.2 更新");
	caseCheck(
		"英数：开启后补空格",
		"GPT4",
		"GPT 4",
		{ ...DEFAULT_SPACING_OPTIONS, latinDigit: "space" }
	);
	caseCheck("连写：含字母的连写按英文单词处理", "用GPT4写代码", "用 GPT4 写代码");
	caseCheck("连写：型号不被中文规则拆开", "4K 显示器与 3D 打印与 5G 网络", "4K 显示器与 3D 打印与 5G 网络");

	// 规则 4：行内公式 ↔ 文字
	caseCheck("公式：与中文之间补空格", "设$x$为未知数", "设 $x$ 为未知数");
	caseCheck("公式：与英文之间补空格", "记作$x$is the answer", "记作 $x$ is the answer");
	caseCheck("公式：已经空开的保持一个", "设  $x$   为", "设 $x$ 为");
	caseCheck("公式：公式与标点之间不留空格", "设$x$，$y$为", "设 $x$，$y$ 为");
	caseCheck("公式：$ 内侧一个字符都不动", "设$a_{n-1}=b$为", "设 $a_{n-1}=b$ 为");
	caseCheck(
		"公式：关闭后不动",
		"设$x$为未知数",
		"设$x$为未知数",
		{ ...DEFAULT_SPACING_OPTIONS, mathText: "keep" }
	);

	// 强调标记（**粗体**、==高亮==…）：标记本身不显示，规则看的是它包住的内容
	caseCheck("强调：粗体与公式之间补空格", "**可逆矩阵**$P$", "**可逆矩阵** $P$");
	caseCheck("强调：公式与粗体之间补空格", "$P$**粗体**", "$P$ **粗体**");
	caseCheck("强调：高亮与公式", "==高亮==$x$", "==高亮== $x$");
	caseCheck("强调：删除线与公式", "~~删除~~$x$", "~~删除~~ $x$");
	caseCheck("强调：斜体与公式", "*斜体*$x$", "*斜体* $x$");
	caseCheck("强调：下划线与公式", "__下划线__$x$", "__下划线__ $x$");
	caseCheck("强调：中文与粗体英文", "中文**English**中文", "中文 **English** 中文");
	caseCheck("强调：中文与粗体英文词", "用**anki**记笔记", "用 **anki** 记笔记");
	caseCheck("强调：公式包在粗体里", "**$x$**中文", "**$x$** 中文");
	caseCheck("行内代码：与公式之间补空格", "`代码`$x$", "`代码` $x$");
	caseCheck(
		"整句回归：粗体夹在公式与正文之间",
		"设$A$是一个$n$阶方阵。如果存在一个**可逆矩阵**$P$和一个**对角矩阵**$Λ$（主对角线外全为0）",
		"设 $A$ 是一个 $n$ 阶方阵。如果存在一个**可逆矩阵** $P$ 和一个**对角矩阵** $Λ$（主对角线外全为0）"
	);

	// 规则 5：全角标点两侧不留空格
	caseCheck("全角标点：逗号前", "中文 ，内容", "中文，内容");
	caseCheck("全角标点：句号前", "内容 。", "内容。");
	caseCheck("全角标点：标点后", "中文， 内容", "中文，内容");
	caseCheck("全角标点：两侧都有", "中文 ， 内容", "中文，内容");
	caseCheck("全角标点：括号内侧", "中文（ 内容 ）", "中文（内容）");
	caseCheck("全角标点：书名号前不留空格", "如 《书》 等", "如《书》等");
	caseCheck("全角标点：书名号内侧保留专有名词空格", "《新 吊带袜天使》《a子计划》", "《新 吊带袜天使》《a子计划》");
	caseCheck("全角标点：引号两侧不动", "他说 “你好” 。", "他说 “你好”。");
	caseCheck(
		"全角标点：关闭后不动",
		"中文 ，内容 。",
		"中文 ，内容 。",
		{ ...DEFAULT_SPACING_OPTIONS, fullPunct: false }
	);

	// 规则 6：半角标点前不留空格、后空一格
	caseCheck("半角标点：逗号后补空格", "word,word", "word, word");
	caseCheck("半角标点：逗号前删空格", "word , word", "word, word");
	caseCheck("半角标点：句号与感叹号", "Hello.World!Yes", "Hello. World! Yes");
	caseCheck("半角标点：冒号后补空格", "key:value", "key: value");
	caseCheck("半角标点：小数点本身不动", "圆周率 3.14 的值", "圆周率3.14的值");
	caseCheck("半角标点：版本号不动", "1.2.2更新", "1.2.2更新");
	caseCheck("半角标点：时间不动", "12:30开会", "12:30开会");
	caseCheck("半角标点：省略号不动", "等等...内容", "等等...内容");
	caseCheck(
		"半角标点：关闭后不动",
		"word,word",
		"word,word",
		{ ...DEFAULT_SPACING_OPTIONS, halfPunct: false }
	);

	// 规则 7：括号内侧不留空格
	caseCheck("括号：内侧删空格", "( x )", "(x)");
	caseCheck("括号：外侧不动", "word ( x )", "word (x)");
	caseCheck("括号：本来就没有空格", "f(x)", "f(x)");
	caseCheck(
		"括号：关闭后不动",
		"( x )",
		"( x )",
		{ ...DEFAULT_SPACING_OPTIONS, bracketInner: false }
	);

	// 规则 8：数字 ↔ 单位（默认关闭）
	caseCheck("单位：默认不动", "100kg", "100kg");
	caseCheck("单位：开启后补空格", "100kg", "100 kg", { ...DEFAULT_SPACING_OPTIONS, digitUnit: true });
	caseCheck("单位：温度符号", "25℃", "25 ℃", { ...DEFAULT_SPACING_OPTIONS, digitUnit: true });
	caseCheck("单位：度分号写法", "20°C", "20 °C", { ...DEFAULT_SPACING_OPTIONS, digitUnit: true });
	caseCheck("单位：小数", "1.5m", "1.5 m", { ...DEFAULT_SPACING_OPTIONS, digitUnit: true });
	caseCheck("单位：百分号不算单位", "50%", "50%", { ...DEFAULT_SPACING_OPTIONS, digitUnit: true });
	caseCheck("单位：型号不算单位", "4K 显示器与 3D 打印与 5G", "4K 显示器与 3D 打印与 5G", {
		...DEFAULT_SPACING_OPTIONS,
		digitUnit: true,
	});
}

// ------------------------------------------------------------ 2. 安全边界
function safetyTests(): void {
	// frontmatter：缩进与冒号都是语法
	const frontmatter = ["---", "tags:", "  - 标签", "title: 中文English", "---"].join("\n");
	caseCheck("frontmatter 不动", frontmatter, frontmatter);

	// 围栏代码块
	const fenced = ["```sh", "#注释 中文English", "echo  1.2.2", "```"].join("\n");
	caseCheck("围栏代码块不动", fenced, fenced);

	// 缩进代码块（4 个空格，前面是空行）
	const indented = ["正文", "", "    中文English  ,x", ""].join("\n");
	caseCheck("缩进代码块不动", indented, indented);

	// $$ 公式行整行跳过
	const display = ["$$", "a_{n-1}=b ,c", "$$"].join("\n");
	caseCheck("$$ 公式块不动", display, display);
	caseCheck("单行 $$ 公式不动", "$$a_{n-1}=b$$", "$$a_{n-1}=b$$");

	// 行内代码、URL、标签、注释、HTML 标签内部不动
	caseCheck("行内代码内部不动", "`中文English,  x`", "`中文English,  x`");
	caseCheck("URL 内部不动", "https://a.com/中文English?x=1.2.2", "https://a.com/中文English?x=1.2.2");
	caseCheck("标签内部不动", "#标签内容", "#标签内容");
	caseCheck("%%注释%%内部不动", "%%中文English,x%%", "%%中文English,x%%");
	caseCheck("HTML 标签属性不动", '<div class="中文English,x">', '<div class="中文English,x">');

	// 列表标记与表格：结构字符不参与规则
	caseCheck("列表标记不动", "- 项目一\n1. 项目二", "- 项目一\n1. 项目二");
	caseCheck("表格分隔行不动", "| --- | --- |", "| --- | --- |");

	// 行尾空白（Markdown 硬换行）保留
	caseCheck("行尾硬换行保留", "中文English  ", "中文 English  ");

	// 行首缩进原样保留（这一行前面不是空行，不会被当成缩进代码块）
	caseCheck("行首缩进保留", "正文\n\t中文English", "正文\n\t中文 English");

	// 中文与中文之间的空格不删（可能是《新 吊带袜天使》这类专有名词写法）
	caseCheck("中文之间的空格不动", "新 吊带袜天使", "新 吊带袜天使");

	// 数学运算符不加空格（ctrl+c 这类快捷键不能被拆）
	caseCheck("运算符不动", "按 ctrl+c 复制", "按 ctrl+c 复制");

	// 强调标记本身不能被拆坏：空格只能加在标记外面，不能插进 `**` 与文字之间
	caseCheck("强调：标记本身不动", "**粗体**", "**粗体**");
	caseCheck("强调：标记外已有空格时不动", "中文 **粗体** 中文", "中文 **粗体** 中文");
	caseCheck("强调：英文里的星号不动", "a**b**c", "a**b**c");
	caseCheck("强调：不成对的星号不动（乘号）", "x*y 与 a*b*c", "x*y 与 a*b*c");
	caseCheck("强调：粗体里的英文照常排", "**中文English混排**", "**中文 English 混排**");

	// 全部规则关闭：整篇跳过
	const allOff: SpacingOptions = {
		cjkLatin: "keep",
		cjkDigit: "keep",
		latinDigit: "keep",
		mathText: "keep",
		fullPunct: false,
		halfPunct: false,
		bracketInner: false,
		digitUnit: false,
	};
	caseCheck("全部关闭时不动", "用anki卡片 ，( x ) 的 3 章", "用anki卡片 ，( x ) 的 3 章", allOff);
}

// ------------------------------------------------------------ 3. 幂等
function idempotencyTests(): void {
	const inputs: string[] = [
		"用anki卡片记笔记 ， 第 3 章 的 内容",
		"设  $a_{n-1}=b$  为未知数 ，$x$与$y$",
		"《新 吊带袜天使》 与 ( x ) 与 [链接](https://a.com/b?c=1.2)",
		["---", "tags: [中文English]", "---", "", "正文 100kg 与 3D 打印"].join("\n"),
		["```", "中文English", "```", "", "行内 `代码English` 与 #标签内容"].join("\n"),
		["$$", "x=1 ,y", "$$", "", "公式外面 $x$ 的文字"].join("\n"),
		"| 中文English | 1.2.2 |",
		"中文English",
		"",
		"设$A$是一个$n$阶方阵。如果存在一个**可逆矩阵**$P$和一个**对角矩阵**$Λ$（主对角线外全为0）",
		"**粗体**$x$与$y$**粗体** 与 ==高亮==$z$ 与 ~~删除~~$w$ 与 *斜体*$v$",
		"中文**English**中文 与 2*3 与 a*b*c 与 snake_case_name$P$",
	];

	const combos: SpacingOptions[] = [
		DEFAULT_SPACING_OPTIONS,
		{ ...DEFAULT_SPACING_OPTIONS, cjkLatin: "keep" },
		{ ...DEFAULT_SPACING_OPTIONS, cjkDigit: "space" },
		{ ...DEFAULT_SPACING_OPTIONS, cjkDigit: "keep" },
		{ ...DEFAULT_SPACING_OPTIONS, latinDigit: "space" },
		{ ...DEFAULT_SPACING_OPTIONS, mathText: "keep" },
		{ ...DEFAULT_SPACING_OPTIONS, fullPunct: false, halfPunct: false },
		{ ...DEFAULT_SPACING_OPTIONS, bracketInner: false, digitUnit: true },
		{
			...DEFAULT_SPACING_OPTIONS,
			cjkDigit: "space",
			latinDigit: "space",
			digitUnit: true,
		},
	];

	for (const options of combos) {
		for (const input of inputs) {
			const once = fixSpacing(input, options);
			const twice = fixSpacing(once, options);
			checkTrue(
				"幂等失败",
				once === twice,
				`  输入 ${show(input)}\n  一次 ${show(once)}\n  二次 ${show(twice)}`
			);
		}
	}
	console.log(`空格排版幂等：${combos.length} 种设置 × ${inputs.length} 个用例`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 八条规则 ===");
ruleTests();

console.log("=== 2. 安全边界 ===");
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
