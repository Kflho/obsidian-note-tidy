/**
 * 聊天记录排版引擎测试
 *
 * 运行：npm test
 *
 * 分三级保证：
 *   1. 期望输出（golden）—— 把文档化的排版行为钉死
 *   2. 严格幂等 —— 真实用例在任意设置组合下，执行一次即到不动点
 *   3. 病态输入 —— 允许一次以上收敛，但必须有限收敛、不丢内容、不长空行
 *
 * 第 3 级针对的是刻意构造的对抗性输入（如 `[图片]:` 这类无法解析的伪用户名
 * 搭配纯时分秒时间戳）：这类输入旧版同样无法一次到底，但绝不允许无限增长或丢字。
 */
import { formatChatLog, looksLikeChatLog, DEFAULT_CHAT_LOG_OPTIONS, resolveIndent } from "../src/text/chat-log";
import type { ChatLogOptions, ChatIndent, ChatImageOrder } from "../src/text/chat-log";

const IMG = "![[Pasted image 20240101120000.png]]";
const IMG2 = "![[Pasted image 20240101120500.png]]";

// ------------------------------------------------------- 真实用例（要求严格幂等）
const CASES: Array<[string, string]> = [
	["readme示例", "张三 2024/1/5 14:30:25你好，文件收到了吗"],
	["姓名与正文换行", "张三 2024/1/5 14:30:25\n你好，文件收到了吗"],
	["姓名带冒号", "张三: 2024/1/5 14:30:25\n你好，文件收到了吗"],
	["姓名独占一行", "张三\n2024/1/5 14:30:25\n你好，文件收到了吗"],
	["多条消息", "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的"],
	["源文有空行", "张三 2024/1/5 14:30:25\n你好\n\n李四 2024/1/5 14:31:02\n在的"],
	["源文多空行", "张三 2024/1/5 14:30:25\n你好\n\n\n\n李四 2024/1/5 14:31:02\n在的"],
	["纯时间戳", "张三 14:30:25\n你好"],
	["前后有笔记", "# 记录\n\n张三 2024/1/5 14:30:25\n你好\n\n## 笔记\n补充说明"],
	["空行结束聊天区", "张三 2024/1/5 14:30:25\n你好\n\n这是笔记，不应被缩进"],
	["正文含图片", "张三 2024/1/5 14:30:25\n你好\n" + IMG + "\n\n笔记"],
	["图片在前", "张三 2024/1/5 14:30:25\n" + IMG + "\n你好\n\n笔记"],
	["图文同行", "张三 2024/1/5 14:30:25\n你好 " + IMG + "\n\n笔记"],
	["图文同行_图在前", "张三 2024/1/5 14:30:25\n" + IMG + " 你好\n\n笔记"],
	["Markdown图片结尾", "张三 2024/1/5 14:30:25\n你好\n![外链](D:\\pic\\a.png)\n李四 2024/1/5 14:31:00\n在的\n\n笔记"],
	["纯图片消息", "张三 2024/1/5 14:30:25\n" + IMG + "\n李四 2024/1/5 14:31:00\n" + IMG2 + "\n\n笔记"],
	["空正文", "张三 2024/1/5 14:30:25\n李四 2024/1/5 14:31:00\n你好\n\n笔记"],
	["多行正文", "张三 2024/1/5 14:30:25\n第一行\n第二行\n第三行\n\n笔记"],
	["末条多行无尾空行", "张三 2024/1/5 14:30:25\n第一行\n第二行"],
	["已排版tab", "张三: 2024/01/05 14:30:25\n\t你好，文件收到了吗\n"],
	["已排版无缩进", "张三: 2024/01/05 14:30:25\n你好，文件收到了吗\n"],
	["已排版多条", "张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"],
	["已排版含图", "张三: 2024/01/05 14:30:25\n\t" + IMG + "\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"],
	["头部行带坏缩进", "张三 2024/1/5 14:30:25\n你好\n\n \t李四 2024/1/5 14:31:02\n在的"],
	["CRLF换行", "张三 2024/1/5 14:30:25\r\n你好\r\n"],
	["日期补零", "张三 2024-1-5 9:05:03\n你好"],
	["两位年份", "张三 24/1/5 14:30:25\n你好"],
	["无时间戳", "这是一段普通笔记，没有任何时间戳。"],
	["空文本", ""],
	["连续空行", "张三 2024/1/5 14:30:25\n\n\n你好\n\n\n笔记"],
	["空行加不可解析姓名", "张三 2024/1/5 14:30:25\n\n[图片] 2024/1/5 14:30:25"],
	["方括号姓名", "[图片] 2024/1/5 14:30:25\n你好\n[图片] 2024/1/5 14:31:00\n在的"],
	// QQ 直接粘贴的常见形态：整段消息写在同一行，消息之间只有一个空格
	["同行消息_空格分隔", "张三: 2024/1/5 14:30:25 你好 李四: 2024/1/5 14:31:02 在的"],
	["同行消息_含图", `张三: 2024/1/5 14:30:25 ${IMG} 李四: 2024/1/5 14:31:02 你好`],
	["同行消息_前一条紧贴", "张三: 2024/1/5 14:30:25你好  李四: 2024/1/5 14:31:02在的"],
	// 粘贴顺序与时间戳不一致（相邻消息排序的用例）
	["相邻消息_倒序粘贴", `张三 2024/1/5 14:31:02\n${IMG}${IMG2}\n李四 2024/1/5 14:30:25\n你好`],
	["相邻消息_倒序粘贴_纯文字", "张三 2024/1/5 14:31:02\n在的\n李四 2024/1/5 14:30:25\n你好"],
	["相邻消息_倒序粘贴_三条", "张三 2024/1/5 14:33:00\n第三条\n李四 2024/1/5 14:32:00\n第二条\n王五 2024/1/5 14:30:25\n第一条"],
	["相邻消息_倒序_中间夹正文", `张三 2024/1/5 14:31:02\n${IMG}\n\n# 记录\n李四 2024/1/5 14:30:25\n你好`],
	["相邻消息_倒序_无日期", "张三 14:31:02\n在的\n李四 14:30:25\n你好"],
	["相邻消息_倒序_末条正文截断", "张三 2024/1/5 14:31:02\n在的\n李四 2024/1/5 14:30:25\n第一行\n第二行"],
	// @ 提及（开了开关才删；关着时原样保留，两种设置都要幂等）
	["提及_开头", "张三 2024/1/5 14:30:25\n@徐晃何许人也 这才叫邪恶反派"],
	["提及_行中行尾", "张三 2024/1/5 14:30:25\n你说的对 @张三 就是这样\n你好 @李四"],
	["提及_整行", "张三 2024/1/5 14:30:25\n@张三\n第三行\n@李四 @王五 大家好\n\n"],
	["提及_邮箱与全角", "张三 2024/1/5 14:30:25\n发到 foo@bar.com 就行\n＠张三 大家好"],
	// 作者自己接在消息下面写的顶格内容（历史 bug：被卷进消息正文重新缩进）
	["正文_顶格行截断", "张三 2024/1/5 14:30:25\n你好\n\t作者自己的话\n06集\n\n笔记"],
	["正文_顶格行截断_多行", "张三 2024/1/5 14:30:25\n第一行\n\t第二行\n06集\n\t内容\n\n笔记"],
];

// -------------------------------------------------------------- 确定性 fuzz
let seed = 20240105;
function rnd(): number {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
	return arr[Math.floor(rnd() * arr.length)] as T;
}

const NAMES = ["张三", "李四", "王五", "[图片]", "user_1", "小明"];
const STAMPS = ["2024/1/5 14:30:25", "2024-01-05 14:30:25", "2024/1/5 14:30:25", "14:30:25", "24/1/5 14:30:25"];
const BODIES = ["你好", "在吗？", IMG, IMG2, "图片 " + IMG, IMG + " 说明", "第一行\n第二行", "", "多行\n内容\n第三行"];
const NOISE = ["", "", "", "# 标题", "普通笔记内容", "![外链](D:\\pic\\a.png)"];
const FUZZ_CASES: Array<[string, string]> = [];

function fuzzCase(): string {
	let s = "";
	const blocks = 1 + Math.floor(rnd() * 3);
	for (let b = 0; b < blocks; b++) {
		s += pick(NOISE) + "\n";
		const msgs = 1 + Math.floor(rnd() * 3);
		// 四分之一的块按 QQ 直接粘贴的形态生成：整段消息写在同一行、消息之间只有一个空格
		const oneLine = rnd() < 0.25;
		for (let i = 0; i < msgs; i++) {
			s += (i > 0 && oneLine ? " " : "") + pick(NAMES) + (rnd() < 0.5 ? " " : ": ") + pick(STAMPS);
			const lines = 1 + Math.floor(rnd() * 2);
			for (let j = 0; j < lines; j++) {
				s += (j === 0 && oneLine ? " " : "\n") + pick(BODIES);
			}
			if (!oneLine) s += "\n";
		}
		s += pick(["", "", "\n"]);
	}
	return s;
}

for (let i = 0; i < 120; i++) {
	FUZZ_CASES.push(["fuzz#" + i, fuzzCase()]);
}

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

// ------------------------------------------------------------ 1. golden 测试
const D = DEFAULT_CHAT_LOG_OPTIONS;
function opts(patch: Partial<ChatLogOptions>): ChatLogOptions {
	return { ...D, ...patch };
}

function goldenTests(): void {
	const SIMPLE = "张三 2024/1/5 14:30:25\n你好，文件收到了吗";
	const BODY = "\t你好，文件收到了吗\n";

	check("默认设置", formatChatLog(SIMPLE, D), `张三: 2024/01/05 14:30:25\n${BODY}`);
	check("隐藏时间", formatChatLog(SIMPLE, opts({ showTime: false })), `张三: 2024/01/05\n${BODY}`);
	check("隐藏日期", formatChatLog(SIMPLE, opts({ showDate: false })), `张三: 14:30:25\n${BODY}`);
	check("隐藏用户名", formatChatLog(SIMPLE, opts({ showUsername: false })), `2024/01/05 14:30:25\n${BODY}`);
	check(
		"隐藏用户名与日期",
		formatChatLog(SIMPLE, opts({ showUsername: false, showDate: false })),
		`14:30:25\n${BODY}`
	);
	check(
		"头部信息全关",
		formatChatLog(SIMPLE, opts({ showUsername: false, showDate: false, showTime: false })),
		"\t你好，文件收到了吗\n"
	);
	check("不缩进", formatChatLog(SIMPLE, opts({ indent: "" })), "张三: 2024/01/05 14:30:25\n你好，文件收到了吗\n");
	check("两空格缩进", formatChatLog(SIMPLE, opts({ indent: "  " })), "张三: 2024/01/05 14:30:25\n  你好，文件收到了吗\n");
	check("四空格缩进", formatChatLog(SIMPLE, opts({ indent: "    " })), "张三: 2024/01/05 14:30:25\n    你好，文件收到了吗\n");

	// 图文顺序
	const IMGCASE = `张三 2024/1/5 14:30:25\n你好\n${IMG}\n\n笔记`;
	const IMGCASE_REV = `张三 2024/1/5 14:30:25\n${IMG}\n你好\n\n笔记`;
	const HEAD = "张三: 2024/01/05 14:30:25\n";
	check("图片保持原顺序", formatChatLog(IMGCASE, D), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check("图片移到上方", formatChatLog(IMGCASE, opts({ imageOrder: "above" })), `${HEAD}\t${IMG}\n\t你好\n\n笔记`);
	check("图片已在下方", formatChatLog(IMGCASE, opts({ imageOrder: "below" })), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check("图片移到下方", formatChatLog(IMGCASE_REV, opts({ imageOrder: "below" })), `${HEAD}\t你好\n\t${IMG}\n\n笔记`);
	check(
		"图文同行_图片下移",
		formatChatLog(`张三 2024/1/5 14:30:25\n${IMG} 你好\n\n笔记`, opts({ imageOrder: "below" })),
		`${HEAD}\t你好\n\t${IMG}\n\n笔记`
	);
	check(
		"纯图片消息不重排",
		formatChatLog(`张三 2024/1/5 14:30:25\n${IMG}\n\n笔记`, opts({ imageOrder: "above" })),
		`${HEAD}\t${IMG}\n\n笔记`
	);

	// 空行：源文里消息之间的空行归「消息之间插入空行」总开关管（默认关 ⇒ 收掉）
	const TWO = "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的";
	const TWO_BLANK = "张三 2024/1/5 14:30:25\n你好\n\n李四 2024/1/5 14:31:02\n在的";
	const TWO_COMPACT = "张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n";
	const TWO_ONE_BLANK = "张三: 2024/01/05 14:30:25\n\t你好\n\n李四: 2024/01/05 14:31:02\n\t在的\n";
	check("相邻消息_默认不留空行", formatChatLog(TWO, D), TWO_COMPACT);
	check("源文空行被收掉", formatChatLog(TWO_BLANK, D), TWO_COMPACT);
	check(
		"源文多空行也收掉",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n\n\n\n李四 2024/1/5 14:31:02\n在的", D),
		TWO_COMPACT
	);
	check("开关打开_源文没空行也留一行", formatChatLog(TWO, opts({ blankLineBetweenMessages: true })), TWO_ONE_BLANK);
	check("开关打开_源文空行收成一行", formatChatLog(TWO_BLANK, opts({ blankLineBetweenMessages: true })), TWO_ONE_BLANK);
	check(
		"开关打开_有头部信息也留一行",
		formatChatLog(TWO, { ...D, blankLineBetweenMessages: true }),
		TWO_ONE_BLANK
	);

	// 空行：头部信息全关时可选择插入空行
	const ALL_OFF = opts({ showUsername: false, showDate: false, showTime: false });
	check("全关_不插空行", formatChatLog(TWO, ALL_OFF), "\t你好\n\t在的\n");
	check("全关_插空行", formatChatLog(TWO, { ...ALL_OFF, blankLineBetweenMessages: true }), "\t你好\n\n\t在的\n");
	check(
		"全关_插空行_三条消息",
		formatChatLog(`${TWO}\n王五 2024/1/5 14:32:00\n再见`, { ...ALL_OFF, blankLineBetweenMessages: true }),
		"\t你好\n\n\t在的\n\n\t再见\n"
	);
	check(
		"全关_源文已有空行不重复插",
		formatChatLog(TWO_BLANK, { ...ALL_OFF, blankLineBetweenMessages: true }),
		"\t你好\n\n\t在的\n"
	);
	// 开关现在是总开关：有头部信息时同样管用（旧版只对"头部全关"生效）
	check("有头部信息时插空行设置也生效", formatChatLog(TWO, { ...D, blankLineBetweenMessages: true }), TWO_ONE_BLANK);
	check("有头部信息时源文空行同样收掉", formatChatLog(TWO_BLANK, D), TWO_COMPACT);
	check(
		"全关_插空行_末条笔记不缩进",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的\n\n笔记", {
			...ALL_OFF,
			blankLineBetweenMessages: true,
		}),
		"\t你好\n\n\t在的\n\n笔记"
	);

	// 空行不应随执行次数增长（历史 bug 的最小复现）
	const GROWTH_OUT = "张三: 2024/01/05 14:30:25\n\n[图片] 2024/1/5 14:30:25";
	check("空行不增长_首次", formatChatLog("张三 2024/1/5 14:30:25\n\n[图片] 2024/1/5 14:30:25", D), GROWTH_OUT);
	check("空行不增长_复跑", formatChatLog(GROWTH_OUT, D), GROWTH_OUT);

	// 头部行自带缩进（" \t李四"）时，那截缩进不该以"纯空白行"的形式留在两条消息之间
	const HEAD_INDENT_RESIDUE = "张三 2024/1/5 14:30:25\n你好\n\n \t李四 2024/1/5 14:31:02\n在的";
	check("头部行缩进不留残渣", formatChatLog(HEAD_INDENT_RESIDUE, D), TWO_COMPACT);
	check("头部行缩进不留残渣_留空行时也只有一行",
		formatChatLog(HEAD_INDENT_RESIDUE, opts({ blankLineBetweenMessages: true })),
		TWO_ONE_BLANK);

	// 同一行的多条消息（消息之间只有一个空格）—— 历史 bug：那截空格已被上一条正文 trim 掉，
	// 而 `substring(start, end)` 在 start > end 时会**交换参数**（slice 才是返回空串），
	// 于是每条消息前都漏出一个"只剩空格"的行，再经空格排版变成真正的空行 ——
	// 用户看到的就是"选了不插空行却仍然有空行"。
	const SAME_LINE = "张三: 2024/1/5 14:30:25 你好 李四: 2024/1/5 14:31:02 在的";
	check(
		"同行消息_默认设置不留空白行",
		formatChatLog(SAME_LINE, D),
		"张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"
	);
	check("同行消息_头部全关不留空白行", formatChatLog(SAME_LINE, ALL_OFF), "\t你好\n\t在的\n");
	check(
		"同行消息_头部全关_插空行设置仍然生效",
		formatChatLog(SAME_LINE, { ...ALL_OFF, blankLineBetweenMessages: true }),
		"\t你好\n\n\t在的\n"
	);
	check(
		"同行消息_含图",
		formatChatLog(`张三: 2024/1/5 14:30:25 ${IMG} 李四: 2024/1/5 14:31:02 你好`, ALL_OFF),
		`\t${IMG}\n\t你好\n`
	);
	check(
		"同行消息_前一条紧贴_多空格",
		formatChatLog("张三: 2024/1/5 14:30:25你好  李四: 2024/1/5 14:31:02在的", ALL_OFF),
		"\t你好\n\t在的\n"
	);

	// 相邻消息按时间先后输出：粘贴顺序常与聊天窗口里的先后不一致 ——
	// 用户用例：连选两条消息（前一条文字、后一条两张图），后一条先落地、
	// 前一条落在它下面，看上去就是"图片跑到上一条文字的上方"。时间戳在手，把它摆正。
	const REVERSED = `张三 2024/1/5 14:31:02\n${IMG}${IMG2}\n李四 2024/1/5 14:30:25\n你好`;
	check(
		"相邻消息_倒序粘贴按时间摆正",
		formatChatLog(REVERSED, D),
		`李四: 2024/01/05 14:30:25\n\t你好\n张三: 2024/01/05 14:31:02\n\t${IMG}${IMG2}\n`
	);
	check("相邻消息_倒序粘贴_头部全关", formatChatLog(REVERSED, ALL_OFF), `\t你好\n\t${IMG}${IMG2}\n`);
	check(
		"相邻消息_倒序粘贴_图片在上方设置下同样摆正",
		formatChatLog(`张三 2024/1/5 14:31:02\n${IMG}${IMG2}\n李四 2024/1/5 14:30:25\n太搞笑了`, opts({ imageOrder: "above" })),
		`李四: 2024/01/05 14:30:25\n\t太搞笑了\n张三: 2024/01/05 14:31:02\n\t${IMG}${IMG2}\n`
	);
	check(
		"相邻消息_已经有序不动",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的", D),
		"张三: 2024/01/05 14:30:25\n\t你好\n李四: 2024/01/05 14:31:02\n\t在的\n"
	);
	check(
		"相邻消息_关掉排序保持粘贴顺序",
		formatChatLog(REVERSED, opts({ sortByTime: false })),
		`张三: 2024/01/05 14:31:02\n\t${IMG}${IMG2}\n李四: 2024/01/05 14:30:25\n\t你好\n`
	);
	// 中间夹着作者自己的正文：那段跟着谁走都说不清，整段不动
	check(
		"相邻消息_中间夹正文不排序",
		formatChatLog(`张三 2024/1/5 14:31:02\n${IMG}\n\n# 记录\n李四 2024/1/5 14:30:25\n你好`, D),
		`张三: 2024/01/05 14:31:02\n\t${IMG}\n\n# 记录\n李四: 2024/01/05 14:30:25\n\t你好\n`
	);
	// 时间戳里只有时分秒（没日期）：整段都是这种形状时按时间比，跨天无从判断只是不适用于混合形状
	check(
		"相邻消息_只有时间也摆正",
		formatChatLog("张三 14:31:02\n在的\n李四 14:30:25\n你好", D, new Date(2024, 0, 5, 14, 0, 0)),
		"李四: 2024/01/05 14:30:25\n\t你好\n张三: 2024/01/05 14:31:02\n\t在的\n"
	);
	// 一段里混着"带日期"与"只有时间"的两种形状 ⇒ 一次排版不排：
	// 缺日期的那种跨天无从判断。头部会把日期补齐，下一轮（流水线会迭代到不动点）
	// 整段时间戳形状一致后再按时间摆正，所以最终结果仍然是按时间排好的。
	check(
		"相邻消息_时间戳形状混着不排序",
		formatChatLog("张三 2024/1/5 14:31:02\n在的\n李四 14:30:25\n你好", D, new Date(2024, 0, 5, 14, 0, 0)),
		"张三: 2024/01/05 14:31:02\n\t在的\n李四: 2024/01/05 14:30:25\n\t你好\n"
	);
	check(
		"相邻消息_时间相同保持原顺序",
		formatChatLog("张三 2024/1/5 14:30:25\n第一条\n李四 2024/1/5 14:30:25\n第二条", D),
		"张三: 2024/01/05 14:30:25\n\t第一条\n李四: 2024/01/05 14:30:25\n\t第二条\n"
	);

	// 去掉 @ 提及（用户用例：QQ 群里的回复标记，昵称在笔记里指不到人）
	check(
		"提及_默认开时不动",
		formatChatLog("张三 2024/1/5 14:30:25\n@徐晃何许人也 这才叫邪恶反派", D),
		"张三: 2024/01/05 14:30:25\n\t@徐晃何许人也 这才叫邪恶反派\n"
	);
	check(
		"提及_开头去掉",
		formatChatLog("张三 2024/1/5 14:30:25\n@徐晃何许人也 这才叫邪恶反派", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t这才叫邪恶反派\n"
	);
	check(
		"提及_行尾去掉",
		formatChatLog("张三 2024/1/5 14:30:25\n你好 @张三", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t你好\n"
	);
	check(
		"提及_行中去掉且不留双空格",
		formatChatLog("张三 2024/1/5 14:30:25\n你说的对 @张三 就是这样", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t你说的对 就是这样\n"
	);
	check(
		"提及_多个连续提及",
		formatChatLog("张三 2024/1/5 14:30:25\n@张三 @李四 大家好", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t大家好\n"
	);
	check(
		"提及_全角＠也算",
		formatChatLog("张三 2024/1/5 14:30:25\n＠张三 大家好", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t大家好\n"
	);
	check(
		"提及_邮箱不算提及",
		formatChatLog("张三 2024/1/5 14:30:25\n发到 foo@bar.com 就行", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t发到 foo@bar.com 就行\n"
	);
	check(
		"提及_整行只有提及则整行去掉",
		formatChatLog("张三 2024/1/5 14:30:25\n@张三\n第三行\n\n", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n\t第三行\n\n"
	);
	check(
		"提及_只有提及的正文留个头部",
		formatChatLog("张三 2024/1/5 14:30:25\n@张三", opts({ stripMentions: true })),
		"张三: 2024/01/05 14:30:25\n"
	);
	check(
		"提及_和图片一起时保留图片",
		formatChatLog(`张三 2024/1/5 14:30:25\n@张三 ${IMG} 你看`, opts({ stripMentions: true })),
		`张三: 2024/01/05 14:30:25\n\t${IMG} 你看\n`
	);

	// 正文边界只认空行与下一条消息头部：作者接在消息下面写的内容（中间没有空行）会被算作
	// 这条消息的正文 —— 这是已知取舍。要精确控制就只排版选中的一段（`typeset-selection`），
	// 别指望整篇排版能猜出"哪几行是作者自己写的"。
	check(
		"正文_接写的行跟着消息一起缩进",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n\t作者接着写的话\n06集\n\n笔记", D),
		"张三: 2024/01/05 14:30:25\n\t你好\n\t作者接着写的话\n\t06集\n\n笔记"
	);
	// 刚从 QQ 粘进来的正文整段顶格 ⇒ 照旧全部算作消息正文
	check(
		"正文_整段顶格不受影响",
		formatChatLog("张三 2024/1/5 14:30:25\n你好\n第二行\n第三行\n\n笔记", D),
		"张三: 2024/01/05 14:30:25\n\t你好\n\t第二行\n\t第三行\n\n笔记"
	);
	// 末条消息多行、后面又没有空行时，正文只取到第一个换行，续行原样跟在后面 ——
	// 这种"正文被截断"的段一律不排：排序会把续行跟消息拆开，而且"谁在最后"一变，
	// 下一次排版对这条消息的取法也跟着变（不幂等）。这里保持原样的粘贴顺序。
	check(
		"相邻消息_末条正文被截断时不排序",
		formatChatLog(`张三 2024/1/5 14:31:02\n${IMG}\n李四 2024/1/5 14:30:25\n第一行\n第二行`, D),
		`张三: 2024/01/05 14:31:02\n\t${IMG}\n李四: 2024/01/05 14:30:25\n\t第一行\n第二行`
	);

	// 输出里的行要么有内容、要么是真空行：不该出现"只有空格 / Tab 的行"（渲染出来同样是空行）
	for (const [name, input] of [
		["同行消息", SAME_LINE],
		["同行消息_含图", `张三: 2024/1/5 14:30:25 ${IMG} 李四: 2024/1/5 14:31:02 你好`],
	] as Array<[string, string]>) {
		for (const [label, options] of [["默认", D], ["头部全关", ALL_OFF]] as Array<[string, ChatLogOptions]>) {
			const out = formatChatLog(input, options);
			checkTrue(`输出出现纯空白行 ${name} [${label}]`, !/^[ \t]+$/m.test(out), `  ${show(out)}`);
		}
	}
}

// ------------------------------------------------------------ 设置组合枚举
function allOptionCombos(): Array<[string, ChatLogOptions]> {
	const indents: ChatIndent[] = ["tab", "2", "4", "none"];
	const orders: ChatImageOrder[] = ["keep", "above", "below"];
	const combos: Array<[string, ChatLogOptions]> = [];

	for (const showUsername of [true, false]) {
		for (const showDate of [true, false]) {
			for (const showTime of [true, false]) {
				for (const indent of indents) {
					for (const order of orders) {
						for (const blankLine of [false, true]) {
							const label = `u=${showUsername} d=${showDate} t=${showTime} i=${indent} o=${order} b=${blankLine}`;
							combos.push([
								label,
								{
									showUsername,
									showDate,
									showTime,
									indent: resolveIndent(indent),
									imageOrder: order,
									blankLineBetweenMessages: blankLine,
									// 相邻消息排序是默认行为，这里固定开着跑遍其余组合
									sortByTime: true,
									// @ 提及默认关；开关两种取值都要求幂等（真实用例里有带提及的样本）
									stripMentions: true,
								},
							]);
						}
					}
				}
			}
		}
	}
	return combos;
}

/**
 * 最长连续换行数，即空行的"厚度"。
 *
 * 这是判断空行是否累积的正确指标：补一行头部只会增加单个换行，
 * 而历史 bug 的表现是同一处空行每执行一次就厚一层（2 → 3 → 4 …）。
 */
function maxNewlineRun(s: string): number {
	let max = 0;
	for (const run of s.match(/\n+/g) || []) {
		max = Math.max(max, run.length);
	}
	return max;
}

/**
 * 归一化日期分隔符：排版引擎会把 `2024-01-05` 统一成 `2024/01/05`，
 * 这是有意的格式统一，不应被当成内容丢失。
 */
const normalizeDashes = (s: string): string => s.replace(/-/g, "/");

/** 非空白字符计数，用于判断内容是否被丢掉 */
function contentMap(s: string): Map<string, number> {
	const map = new Map<string, number>();
	for (const ch of s) {
		if (/\s/.test(ch)) continue;
		map.set(ch, (map.get(ch) || 0) + 1);
	}
	return map;
}

function lostChars(before: string, after: string): string {
	const afterMap = contentMap(normalizeDashes(after));
	const beforeMap = contentMap(normalizeDashes(before));
	let lost = "";
	for (const [ch, count] of beforeMap) {
		if ((afterMap.get(ch) || 0) < count) lost += ch;
	}
	return lost;
}

// ------------------------------------------- 2. 真实用例：一次执行即到不动点
function strictIdempotencyTests(): void {
	const combos = allOptionCombos();
	for (const [label, options] of combos) {
		for (const [name, input] of CASES) {
			const once = formatChatLog(input, options);
			const twice = formatChatLog(once, options);
			checkTrue(`幂等性失败 ${name} [${label}]`, once === twice, `  一次 ${show(once)}\n  二次 ${show(twice)}`);
		}
	}
	console.log(`严格幂等：${combos.length} 组合 × ${CASES.length} 个真实用例 = ${combos.length * CASES.length} 次`);
}

// --------------------- 3. 病态输入：有限次收敛，且不丢内容、不长空行
const MAX_PASSES = 4;
function fuzzConvergenceTests(): void {
	const combos = allOptionCombos();
	let maxPassesUsed = 0;

	for (const [label, options] of combos) {
		// 只有"不隐藏任何头部信息"的组合才适合做字符级丢失检查：
		// 隐藏用户名/日期/时间时，第二次执行可能把残留的原始行按设置改写，
		// 那属于设置的预期效果，不是内容丢失。
		const hidesInfo = !(options.showUsername && options.showDate && options.showTime);

		for (const [name, input] of FUZZ_CASES) {
			let current = input;
			let blankRun = -1;
			let passes = 0;

			while (passes < MAX_PASSES) {
				const next = formatChatLog(current, options);
				passes++;
				if (next === current) break;

				if (passes === 1) {
					// 首次执行会按设置增删信息（隐藏时间、统一日期分隔符、新增头部行、
					// 插入空行等），都属于预期行为，只记录基准
					blankRun = maxNewlineRun(next);
				} else {
					// 此时 current 已经是排版结果，不允许再丢字或让空行变厚。
					//
					// 基准最少按"一个空行"（连续换行 2）算：病态输入的**消息边界本身**要几轮才定下来
					// （`[图片] 14:30:25` 这类伪头部第一轮认不出是消息），后一轮才认出"这两条相邻"
					// 并按「消息之间插入空行」补上一行 —— 那是一次性的，不是"每执行一次厚一层"。
					const nextBlankRun = maxNewlineRun(next);
					const allowed = Math.max(blankRun, 2);
					checkTrue(
						`病态输入空行累积 ${name} [${label}]`,
						nextBlankRun <= allowed,
						`  第 ${passes} 次：最长连续换行 ${blankRun} → ${nextBlankRun}`
					);
					blankRun = nextBlankRun;

					const lost = lostChars(current, next);
					checkTrue(
						`病态输入内容丢失 ${name} [${label}]`,
						hidesInfo || lost === "",
						`  第 ${passes} 次丢失 ${show(lost)}\n  前 ${show(current)}\n  后 ${show(next)}`
					);
				}

				current = next;
			}

			maxPassesUsed = Math.max(maxPassesUsed, passes);
			checkTrue(
				`病态输入未收敛 ${name} [${label}]`,
				formatChatLog(current, options) === current,
				`  执行 ${MAX_PASSES} 次后仍未到不动点：${show(current)}`
			);
		}
	}
	console.log(
		`病态输入：${combos.length} 组合 × ${FUZZ_CASES.length} 个 fuzz 用例，最多 ${maxPassesUsed} 次执行收敛`
	);
}

// --------------------------------------- 4. 这像不像聊天记录（粘贴自动修复的判据）
function looksLikeTests(): void {
	const chatLogs: Array<[string, string]> = [
		["两条消息（QQ 竖排）", "张三 2024/1/5 14:30:25\n你好\n李四 2024/1/5 14:31:02\n在的"],
		["两条消息（QQ 同行）", "张三: 2024/1/5 14:30:25 你好 李四: 2024/1/5 14:31:02 在的"],
		["本插件排版过的结果（无用户名头部）", "2024/01/05 14:30:25\n\t你好\n2024/01/05 14:31:02\n\t在的"],
		["带图片的聊天记录", "张三 2024/1/5 14:30:25\n" + IMG + "\n李四 2024/1/5 14:31:02\n在的"],
	];
	for (const [name, text] of chatLogs) {
		checkTrue(`像聊天记录：${name}`, looksLikeChatLog(text), show(text));
	}

	// 只认一条太容易误伤（正文里提一句时间就命中了），而复制单条消息本来也不带头部
	const others: Array<[string, string]> = [
		["普通笔记", "这是一段普通笔记，没有任何时间戳。"],
		["只有一条消息头部", "张三 2024/1/5 14:30:25\n你好，文件收到了吗"],
		["正文里提到一个时间", "会议 14:30:25 开始，记得提前十分钟到。"],
		["两条没有用户名的纯时间", "14:30:25 开始\n15:00:00 结束"],
		["空文本", ""],
	];
	for (const [name, text] of others) {
		checkTrue(`不像聊天记录：${name}`, !looksLikeChatLog(text), show(text));
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 期望输出 ===");
goldenTests();

console.log("=== 2. 严格幂等（真实用例）===");
strictIdempotencyTests();

console.log("=== 3. 病态输入收敛性 ===");
fuzzConvergenceTests();

console.log("=== 4. 像不像聊天记录 ===");
looksLikeTests();

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
