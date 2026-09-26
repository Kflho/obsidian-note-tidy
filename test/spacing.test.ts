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
import { DEFAULT_SPACING_OPTIONS, fixSpacing } from "../src/text/spacing";
import type { SpacingOptions } from "../src/text/spacing";

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

// ------------------------------------------------------------ 1. 十条规则
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

	// 规则 9：章节 / 课次 / 附录这类标题标记与标题内容之间（文字格式 / 中文 1）
	caseCheck("标题：章 + 内容", "第一章矩阵", "第一章 矩阵");
	caseCheck("标题：后面还有正文", "第一章矩阵的运算", "第一章 矩阵的运算");
	caseCheck("标题：课", "第一课五十音", "第一课 五十音");
	caseCheck("标题：节", "第二节向量", "第二节 向量");
	caseCheck("标题：篇", "第一篇绪论", "第一篇 绪论");
	caseCheck("标题：阿拉伯数字序号", "第1章矩阵", "第1章矩阵");
	caseCheck("标题：序号两侧的空格归中数规则", "第 3 章矩阵", "第3章矩阵");
	caseCheck("标题：已经空开的不动", "第一章 矩阵", "第一章 矩阵");
	caseCheck("标题：已经空开的多格也不收", "第一章  矩阵", "第一章  矩阵");
	caseCheck("标题：后面是标点时不补", "第一章：矩阵", "第一章：矩阵");
	caseCheck("标题：后面是顿号时不补", "第一章、矩阵", "第一章、矩阵");
	caseCheck("标题：后面是开括号时不补", "第一章（矩阵）", "第一章（矩阵）");
	caseCheck("标题：标记后面没有内容时不补", "第一章", "第一章");
	caseCheck("标题：行首只有标记时不补", "# 第一章", "# 第一章");
	caseCheck("标题：标题行照常处理", "# 第一章矩阵", "# 第一章 矩阵");
	caseCheck("标题：句中出现也补（正文里的引用）", "见第一章矩阵部分", "见第一章 矩阵部分");
	caseCheck("标题：一行里两处标记", "第一章矩阵 和 第二章向量", "第一章 矩阵 和 第二章 向量");
	caseCheck("标题：附录 + 字母序号", "附录A矩阵", "附录A 矩阵");
	caseCheck("标题：附录 + 数字序号", "附录1矩阵", "附录1 矩阵");
	caseCheck("标题：附录 + 汉字序号", "附录一矩阵", "附录一 矩阵");
	caseCheck("标题：附录与序号之间空开的收掉", "附录 A 矩阵", "附录A 矩阵");
	caseCheck("标题：附录后面的公式与英文照常", "附录A矩阵的$A$", "附录A 矩阵的 $A$");
	caseCheck("标题：不写序号的附录认不出来（不猜）", "附录矩阵", "附录矩阵");
	caseCheck("标题：附录 + 序号但没有内容时不补", "附录A", "附录A");
	caseCheck("标题：附录 + 序号单独一行时不收词距", "附录 A", "附录 A");
	caseCheck("标题：句子里的「的」说明那是正文（不补）", "第一章的用法", "第一章的用法");
	caseCheck("标题：句中的附录不算标记", "附录里的内容", "附录里的内容");
	caseCheck("标题：附录和正文不算标记", "附录和第一章", "附录和第一章");
	caseCheck(
		"标题：关闭后不动",
		"第一章矩阵",
		"第一章矩阵",
		{ ...DEFAULT_SPACING_OPTIONS, chapterTitle: false }
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
	// 括号外侧也不留空格（英文符号 3「括号前后都没有空格」，就是 `f(x)` 那种函数写法）
	caseCheck("括号：外侧也贴紧", "中文 ( x )", "中文(x)");
	caseCheck("括号：中文与括号之间贴紧", "中文 (说明) 与 中文 （说明）", "中文(说明)与 中文（说明）");
	caseCheck("括号：函数写法", "f (x) 与 g( x )", "f(x)与 g(x)");
	// 英文句子里括号两侧是英文词距，外侧保留
	caseCheck("括号：英文句的外侧保留", "See the appendix (page 3).", "See the appendix (page 3).");
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

	// 链接与地址：整段一个字符都不动（2026-09 全库实测报的 bug —— 磁力链接被当成正文排版）
	caseCheck(
		"磁力链接内部不动",
		"下载：magnet:?xt=urn:btih:7947d6cdb83a537fc29e9032d2cd2660eacbea25&dn=%5BQueen%20Blade%5D&xl=3353074364",
		"下载：magnet:?xt=urn:btih:7947d6cdb83a537fc29e9032d2cd2660eacbea25&dn=%5BQueen%20Blade%5D&xl=3353074364"
	);
	caseCheck(
		"ed2k 与 data 与 mailto 内部不动",
		"见 ed2k://|file|abc.mkv|123456|/ 与 data:text/plain;base64,SGVsbG8= 与 mailto:someone@example.com 三个",
		"见 ed2k://|file|abc.mkv|123456|/ 与 data:text/plain;base64,SGVsbG8= 与 mailto:someone@example.com 三个"
	);
	caseCheck(
		"裸域名与文件名内部不动",
		"见 www.bilibili.com/video/BV1xx?p=1 与 main.ts 与 data.json",
		"见 www.bilibili.com/video/BV1xx?p=1 与 main.ts 与 data.json"
	);
	caseCheck("邮箱与主机端口内部不动", "someone@example.com 与 localhost:8080 两个", "someone@example.com 与 localhost:8080 两个");
	caseCheck("HTML 实体内部不动", "见 &amp; 与 &nbsp; 两个", "见 &amp; 与 &nbsp; 两个");
	// 反过来：英文句子里的句号照旧排（域名规则只认小写 + 两个字母以上的顶层域名）
	caseCheck("英文句号照旧", "Hello.World!Yes", "Hello. World! Yes");

	// 列表标记与表格：结构字符不参与规则
	caseCheck("列表标记不动", "- 项目一\n1. 项目二", "- 项目一\n1. 项目二");
	caseCheck("表格分隔行不动", "| --- | --- |", "| --- | --- |");
	// 表格里的空格是对齐用的，整行跳过（`|` 是单元格分隔符，不是正文符号）
	caseCheck(
		"表格：对齐填充原样保留",
		["| -     | 完成情况 | 完成情况 | 总结  |", "| ----- | ---- | ---- | --- |", "| 日期\\分类 | 卫生   | 健康   | -   |"].join("\n"),
		["| -     | 完成情况 | 完成情况 | 总结  |", "| ----- | ---- | ---- | --- |", "| 日期\\分类 | 卫生   | 健康   | -   |"].join("\n")
	);
	// 没有分隔行的 `|` 行不是表格（`|：单独一个 |` 是在讲符号本身），照常排版
	caseCheck("表格：单行 `|` 不是表格", "4. 运算符号\n\t|：单独一个 | 左右要加空格", "4. 运算符号\n\t|：单独一个|左右要加空格");

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
		halfToFullPunct: false,
		symbolPad: false,
		chapterTitle: false,
	};
	caseCheck("全部关闭时不动", "用anki卡片 ，( x ) 的 3 章", "用anki卡片 ，( x ) 的 3 章", allOff);
}

// -------------------------------------------- 2.5 半角标点、NBSP、空白行
function punctuationTests(): void {
	// 半角标点转全角：紧跟在中文后面才换
	caseCheck("全角化：冒号", "对角矩阵主对角线上的元素: $A$ 的**特征值**", "对角矩阵主对角线上的元素：$A$ 的**特征值**");
	caseCheck("全角化：逗号", "中文,中文", "中文，中文");
	caseCheck("全角化：分号与感叹号与问号", "中文;中文!中文?中文", "中文；中文！中文？中文");
	caseCheck("全角化：英文语境不动", "word:word, word! yes?", "word: word, word! yes?");
	caseCheck("全角化：数字语境不动", "时间 12:30 的记录", "时间12:30的记录");
	caseCheck("全角化：小数点不动", "圆周率 3.14 的值", "圆周率3.14的值");
	// 括号外侧本来就贴紧（`V(x)` 这种函数写法），所以这里的 `)` 也不跟中文留空
	caseCheck("全角化：函数括号贴紧", "设 V(x) 为 n 维矢量", "设 V(x)为 n 维矢量");
	caseCheck("全角化：书名号引号内部不动", "《书名, 副标题》与“引用: 内容”", "《书名, 副标题》与“引用: 内容”");
	caseCheck("全角化：行内代码与链接内部不动", "见 `a,b:c` 与 [标题](https://a.com/b,c)", "见 `a,b:c` 与 [标题](https://a.com/b,c)");
	caseCheck(
		"全角化：关闭后不动",
		"元素: $A$",
		"元素: $A$",
		{ ...DEFAULT_SPACING_OPTIONS, halfToFullPunct: false }
	);

	// 句级判定：标点左边的公式 / 字母不算数，得看整句语言（用户实测报的那句）
	caseCheck(
		"全角化：公式后面的逗号（右邻是中文）",
		"由于四容水箱结构特殊，建立子系统后没有 $M_{ij}$, 且 $H_i = 0$ 故粗定位和精定位均无法实现。",
		"由于四容水箱结构特殊，建立子系统后没有 $M_{ij}$，且 $H_i = 0$ 故粗定位和精定位均无法实现。"
	);
	caseCheck("全角化：公式之间的逗号（整句以中文为主）", "即 $A$, $B$ 与 $C$ 三个", "即 $A$，$B$ 与 $C$ 三个");
	caseCheck("全角化：分号与感叹号紧跟公式", "$A$; 说明!真的?", "$A$；说明！真的？");
	caseCheck("全角化：字母后面的冒号", "参数 A: 说明", "参数 A：说明");
	caseCheck("全角化：公式后直接接中文", "$A$,且$B$", "$A$，且 $B$");
	caseCheck(
		"全角化：英文句子不动",
		"in the equation $A$, and $B$, see also the appendix",
		"in the equation $A$, and $B$, see also the appendix"
	);
	caseCheck(
		"全角化：数字后面的标点不动（空格按中文↔数字规则收紧）",
		"数值 1,000 与时间 12:30 都要保留",
		"数值1,000与时间12:30都要保留"
	);
	caseCheck(
		"全角化：聊天记录头部不动",
		"张三: 2024/01/05 14:30:25",
		"张三: 2024/01/05 14:30:25"
	);
	caseCheck("全角化：LaTeX 空格符号里的逗号不动", "写作 x\\, dr 与 $a\\,b$ 的形式", "写作 x\\, dr 与 $a\\,b$ 的形式");
	caseCheck(
		"全角化：半角括号里的逗号不动",
		"输入：`ablate_subsets`（(mod, k) 列表）",
		"输入：`ablate_subsets`（(mod, k)列表）"
	);
	// 罗列标点自身：`/` 只是分隔符（标记命名 5 的"或、别名"本来就不加空格），
	// 标点与标点之间也贴紧 —— 空格只用来分隔不同语言的内容（英文符号 1 的"后空一格"
	// 只在后面是西文内容时才留）
	caseCheck(
		"全角化：罗列标点自身时不换（标点之间贴紧）",
		"1. ,/./!/?/:：后面有空格",
		"1. ,/./!/?/:：后面有空格"
	);
	caseCheck(
		"全角化：罗列标点自身时不换（多打的空格收掉）",
		"1. , /. /! /? /:：后面有空格",
		"1. ,/./!/?/:：后面有空格"
	);
	caseCheck("全角化：被提到的符号不换（符号：解释）", "如, ：后面有空格", "如,：后面有空格");
	caseCheck("全角化：半角冒号被提到时不换", ": ：后面有空格", ":：后面有空格");

	// 反向：英文语境里的全角标点换半角（什么语境用什么标点）
	caseCheck(
		"半角化：英文句子里的全角标点（括号与冒号不收）",
		"This is a sentence。Then another，with（parens）！And a colon：yes？",
		"This is a sentence. Then another, with（parens）! And a colon：yes?"
	);
	caseCheck("半角化：公式之间的全角逗号", "the values are $A$，$B$ and $C$。", "the values are $A$, $B$ and $C$.");
	caseCheck(
		"半角化：中文句里的全角标点不动",
		"中文说明。Then an English line, here. 中文继续。",
		"中文说明。Then an English line, here. 中文继续。"
	);
	caseCheck(
		"半角化：半中半英的行不动（拿不准就不换）",
		"An English line with 中文 words，and，punctuation。",
		"An English line with 中文 words，and，punctuation。"
	);
	caseCheck("半角化：英文句里全角标点两侧的空格保留", "see 《book title》 and end", "see 《book title》 and end");
	caseCheck(
		"半角化：书名号本身不换",
		"- [ ] strang《introduction to linear algebra》",
		"- [ ] strang《introduction to linear algebra》"
	);
	// 判定用"词数"而不是字母数：标识符一大把的中文行仍是中文
	caseCheck(
		"半角化：标识符很多的中文行不动",
		"依赖：create_controlled_system，calculate_lqr，create_noise_v2（utils/）",
		"依赖：create_controlled_system，calculate_lqr，create_noise_v2（utils/）"
	);
	caseCheck(
		"半角化：中文行里的英文术语小标题不动",
		"2. data：",
		"2. data："
	);

	// NBSP（U+00A0）：看起来像空格，规则必须看得见它
	caseCheck("NBSP：公式两侧统一成普通空格", "设\u00A0$A$\u00A0是一个\u00A0$n$\u00A0阶方阵", "设 $A$ 是一个 $n$ 阶方阵");
	caseCheck("NBSP：中英文之间统一成普通空格", "用\u00A0anki\u00A0卡片", "用 anki 卡片");
	caseCheck("NBSP：规则不管的位置原样保留", "新\u00A0吊带袜天使", "新\u00A0吊带袜天使");

	// 只有空白的行：统一成真正的空行
	caseCheck("空白行：Tab 清掉", ["香蕉", "\t\t", "苹果"].join("\n"), ["香蕉", "", "苹果"].join("\n"));
	caseCheck("空白行：NBSP 也清掉", ["香蕉", "\u00a0", "苹果"].join("\n"), ["香蕉", "", "苹果"].join("\n"));
	caseCheck("空白行：代码块里不动", ["```", "\t", "```"].join("\n"), ["```", "\t", "```"].join("\n"));
}

// -------------------------------------------- 2.6 同一行里的 `$$…$$`
function displayMathLineTests(): void {
	// 成对的 `$$…$$` 不是区块：整行照常排版，公式整体跳过
	caseCheck(
		"行内 $$：列表标记与公式两侧都补空格",
		"1.矩阵指数$e^{At}$是一个无穷级数：$$e^{At} = I + At$$",
		"1. 矩阵指数 $e^{At}$ 是一个无穷级数：$$e^{At} = I + At$$"
	);
	caseCheck("行内 $$：前后补空格", "在n维空间中有：$$\\lVert{x}\\rVert = 1$$后面", "在 n 维空间中有：$$\\lVert{x}\\rVert = 1$$ 后面");
	caseCheck("行内 $$：公式内部一个字符都不动", "$$a_{n-1}=b ,c$$", "$$a_{n-1}=b ,c$$");

	// 跨行区块：起始行 `$$` 之前的正文要排，中间行整行是代码，结束行 `$$` 之后要排
	caseCheck(
		"跨行 $$：首行前缀照排、中间行不动、末行后缀照排",
		["设n个变量：$$V(x) = {x^T}Px \\\\", "\tp_{11} & p_{12} ,x \\\\", "\t\\end{bmatrix}$$若$p_{ij} = p_{ji}$则对称"].join("\n"),
		["设 n 个变量：$$V(x) = {x^T}Px \\\\", "\tp_{11} & p_{12} ,x \\\\", "\t\\end{bmatrix}$$若 $p_{ij} = p_{ji}$ 则对称"].join("\n")
	);
	caseCheck(
		"跨行 $$：未闭合时不当作区块",
		["落单的 $$ 后面照排：中文English", "下一行中文English"].join("\n"),
		["落单的 $$ 后面照排：中文 English", "下一行中文 English"].join("\n")
	);
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
		"1.矩阵指数$e^{At}$是：$$e^{At} = I + At$$",
		["设n个变量：$$V(x) = {x^T}Px \\\\", "\tp_{11} & p_{12} ,x \\\\", "\t\\end{bmatrix}$$若$p_{ij} = p_{ji}$则对称"].join("\n"),
		"设\u00A0$A$\u00A0是一个\u00A0$n$\u00A0阶方阵 与 元素: $A$ 的 3.14 与 12:30",
		["香蕉", "\t\t", "苹果", "\u00a0"].join("\n"),
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

// -------------------------------------------- 2.7 符号自己的空格规则
function symbolTests(): void {
	// 英文符号 1：前不留空格、后空一格
	caseCheck("符号：逗号后补一格", "word,word", "word, word");
	caseCheck("符号：逗号前不留空格", "word , word", "word, word");
	caseCheck("符号：冒号后补一格", "key:value", "key: value");

	// 符号与符号之间也贴紧：空格只分隔不同语言的内容，不用来分隔两个符号
	caseCheck("符号之间：逗号与全角冒号", "如, ：后面有空格", "如,：后面有空格");
	caseCheck("符号之间：半角冒号与全角冒号", ": ：后面有空格", ":：后面有空格");
	caseCheck("符号之间：已经贴紧的不动", ":：后面有空格", ":：后面有空格");
	// 内容与全角标点之间也不留空格（与西文内容之间才谈那一格）
	caseCheck("符号之间：内容与全角冒号仍贴紧", "中文 ：内容", "中文：内容");
	caseCheck("符号之间：公式与全角冒号仍贴紧", "$A$ ：说明", "$A$：说明");
	// 半角标点的"后空一格"在内容旁边都留（英文规则），中文旁那一格也算"语言边界"
	caseCheck("符号之间：逗号后面是西文内容", "word,word", "word, word");
	caseCheck("符号之间：逗号后面是中文（换全角后贴紧）", "中文,中文 与 中文, word", "中文，中文 与 中文，word");

	// 空格只分隔不同语言的内容：`|` `&` `→` 与西文内容之间留一格，与中文、与符号之间贴紧
	caseCheck("符号：竖线与西文内容之间留一格", "$0.00$ |$0.30$", "$0.00$ | $0.30$");
	caseCheck("符号：竖线与中文之间贴紧（已有的空格收掉）", "4. 运算符号\n\t|：单独一个 | 左右要加空格", "4. 运算符号\n\t|：单独一个|左右要加空格");
	caseCheck("符号：箭头与西文内容之间留一格", "A→B 与 C→D", "A → B 与 C → D");
	caseCheck("符号：箭头与中文之间贴紧", "甲→乙 与 甲 → 乙", "甲→乙 与 甲→乙");
	caseCheck("符号：被提到的箭头贴紧", "→：和前后内容间要加空格", "→：和前后内容间要加空格");
	caseCheck("符号：和号与西文内容之间留一格", "A&B 与 Tom & Jerry", "A&B 与 Tom & Jerry");
	caseCheck("符号：和号与中文之间贴紧", "甲&乙 与 甲 & 乙", "甲&乙 与 甲&乙");
	caseCheck("符号：被提到的和号贴紧", "&：前后有内容都要加排版空格", "&：前后有内容都要加排版空格");
	caseCheck("符号：和号在行尾贴紧", "7. 并列：&", "7. 并列：&");
	// 专有名词空格以原有形式为准：单字母缩写里的点与和号不参与规则
	caseCheck("符号：缩写的和号不动", "前期 q&a 与 R&D", "前期 q&a 与 R&D");
	caseCheck("符号：缩写的点不动", "例如 e.g. 与 i.e. 的写法", "例如 e.g. 与 i.e. 的写法");

	// 包裹符号：表示"里面的内容"，本身不算内容 —— 内侧不留空格；里面的符号是"被提到的
	// 符号"，不按自己的规则朝包裹符号要一格
	caseCheck("包裹：括号里的被提到符号不空格", "（→）与（+）与（|）", "（→）与（+）与（|）");
	caseCheck("包裹：括号内侧多余空格收掉", "（ + ）与（ 说明 ）", "（+）与（说明）");
	caseCheck("包裹：引号内侧多余空格收掉", "“ + ”与“ 引文 ”", "“+”与“引文”");
	caseCheck("包裹：书名号内侧多余空格收掉", "《 新 吊带袜天使 》", "《新 吊带袜天使》");
	caseCheck("包裹：里面的算式不动", "（a+b）与（a + b）", "（a+b）与（a + b）");
	caseCheck("包裹：外侧按内容规则", "中文（ 说明 ）与 如（+）等", "中文（说明）与 如（+）等");

	// 包裹符号：`||` 贴紧（通用符号 3 的包裹符号子条目）
	caseCheck("符号：包裹符号 || 贴紧", "如（）、||等", "如（）、||等");
	caseCheck("符号：范数外侧留给文字间距规则", "范数 ||x|| 的写法", "范数 ||x|| 的写法");

	// 数学记号里的竖线一个字符都不动（`|` 的"单独一个"不包括它们）
	caseCheck("符号：绝对值贴紧", "函数 |x| 的值", "函数 |x| 的值");
	caseCheck("符号：条件记号贴紧", "P(A|B) 与 x̂_{k|k}", "P(A|B)与 x̂_{k|k}");
	caseCheck("符号：行内公式里的竖线不动", "范数 $\\lVert x\\rVert$ 与 $|f_y|$", "范数 $\\lVert x\\rVert$ 与 $|f_y|$");

	// 通用符号 3：修饰符号前后不加空格
	caseCheck("符号：上标前后不加空格", "x ^ 2", "x^2");
	caseCheck("符号：被提到的上标仍然贴紧", "^：和前后内容间不加空格", "^：和前后内容间不加空格");

	// 英文符号 3：... 前后没有空格
	caseCheck("符号：省略号前后不留空格", "等等 ... 内容", "等等...内容");
	caseCheck("符号：版本号里的点不当标点处理", "版本 v1.2.2 更新", "版本 v1.2.2 更新");
	caseCheck("符号：时间里的冒号不当标点处理", "at 12:30 sharp", "at 12:30 sharp");

	// 通用符号 6、7：`~`、`-` 两边不加空格 —— 靠"不进符号表"实现：不添，也不删作者写的。
	// 所以下面这些行只可能被**别的**规则碰到（例如 `第 1 - 2 章` 里中文↔数字那一格）
	caseCheck("波浪号：两边已有的空格不删", "甲 ~ 乙 与 大约 ~ 五", "甲 ~ 乙 与 大约 ~ 五");
	caseCheck("波浪号：贴紧的也不加空格", "甲~乙 与 约~5个", "甲~乙 与 约~5个");
	caseCheck("波浪号：删除线不受影响", "~~删除线~~ 与 ~~ 空的 ~~", "~~删除线~~ 与 ~~ 空的 ~~");
	caseCheck("连字符：两边不加空格，也不删已有的", "well-known 与 well - known", "well-known 与 well - known");
	caseCheck("连字符：范围里的空格不动（只收中文↔数字那一格）", "第 1 - 2 章", "第1 - 2章");

	// 半角引号也是包裹符号：内侧不留空格；外侧照"分隔语言"办 —— 中文旁贴紧、西文旁留一格
	caseCheck("包裹：半角引号内侧收空格", '他说" 你好 "了', '他说"你好"了');
	caseCheck("包裹：半角引号里的符号贴紧", '写作 " + " 与 "+" 两种', '写作"+"与"+"两种');
	caseCheck("包裹：半角引号外侧在中文旁贴紧", '他说 "你好" 了', '他说"你好"了');
	caseCheck("包裹：半角引号外侧在西文旁留一格", 'He said "hello" loudly', 'He said "hello" loudly');
	caseCheck("包裹：落单的引号不动", '2" 的管子', '2" 的管子');

	// 英文符号 2：英文中修饰符号与所修饰的词看作整体 —— 周围那一格是**英文自带的词距**，保留；
	// 中文侧那条写的是「包裹符号内外均没有空格」（通用符号 3 的子条目），中文旁本来就贴紧。
	// 两句话说的是同一件事的两面：修饰符号自己不添空格，也不删语言自带的词距
	caseCheck("英文修饰：修饰符号与词看作整体，词距保留", 'he is the "man"', 'he is the "man"');
	caseCheck("英文修饰：漏了词距会补上", 'he is the"man"', 'he is the "man"');
	caseCheck("英文修饰：多个修饰符号互不影响", 'he is the "man" and "woman"', 'he is the "man" and "woman"');
	caseCheck("英文修饰：同一个词在中文旁贴紧", '他说 "你好" 了', '他说"你好"了');
	caseCheck("英文修饰：中文旁的括号贴紧", "he said 你好 (nihao)", "he said 你好(nihao)");
	caseCheck("英文修饰：英文旁的括号保留词距", "the (page 3) note", "the (page 3) note");

	// 关闭后回到旧行为（「全角标点前不留空格」会把符号后面那一格吃掉）
	caseCheck(
		"符号：关闭后回到旧行为",
		"如, ：后面有空格 | ：单独一个",
		"如,：后面有空格 |：单独一个",
		{ ...DEFAULT_SPACING_OPTIONS, symbolPad: false }
	);
	caseCheck(
		"符号：半角标点规则关闭后 `,` 不再补空格",
		"word,word",
		"word,word",
		{ ...DEFAULT_SPACING_OPTIONS, halfPunct: false }
	);
	caseCheck(
		"符号：半角标点规则关闭后 `：` 仍然前不留空格",
		"如, ：",
		"如,：",
		{ ...DEFAULT_SPACING_OPTIONS, halfPunct: false }
	);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 八条规则 ===");
ruleTests();

console.log("=== 2. 安全边界 ===");
safetyTests();

console.log("=== 3. 半角标点 / NBSP / 空白行 ===");
punctuationTests();

console.log("=== 3.5 符号自己的空格规则 ===");
symbolTests();

console.log("=== 4. 同一行里的 $$…$$ ===");
displayMathLineTests();

console.log("=== 5. 幂等 ===");
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
