/**
 * 上下文缩进与接缝处理（`src/text/context-indent.ts`）
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 续行前缀：光标处的空白 / `>` 链才算参照，前面已经有正文时给不出参照
 *   2. 缩进就按光标处那一层算 —— 不参考上下文的其它行（上下都顶格也不影响）
 *   3. 整段共有的缩进（`commonIndent`）、剥缩进、加前缀与接缝换行：原本那一层先剥掉再前缀
 *      （免得叠成两层）、首尾换行数还原
 *   4. 端到端：像 `tasks.typesetEditorRange` 那样把一段排版后写回整篇 ——
 *      缩进与光标处对齐、接缝不多出空行、再排一次不变
 *   5. 真接线：真的跑一遍 `ImageTasks.fixPastedRange`（编辑器替身的偏移就是字符串下标）
 */
import { TFile } from "obsidian";
import type { App, Editor } from "obsidian";
import { formatNoteText } from "../src/text/pipeline";
import type { TextPipelineOptions } from "../src/text/pipeline";
import { DEFAULT_CHAT_LOG_OPTIONS } from "../src/text/chat-log";
import { DEFAULT_SPACING_OPTIONS } from "../src/text/spacing";
import { DEFAULT_TEXT_MATH_OPTIONS } from "../src/text/math-wrap";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import { ImageTasks } from "../src/tasks";
import type { BatchRunner } from "../src/batch";
import type { StatusBarProgress } from "../src/ui/progress";
import {
	applyIndentPrefix,
	commonIndent,
	continuationPrefix,
	dedentBy,
	keepEdgeNewlines,
	placeBlockAt,
	resolveRangeIndent,
} from "../src/text/context-indent";

const T = "\t";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function show(value: unknown): string {
	return JSON.stringify(value);
}

function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (show(actual) !== show(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${show(expected)}\n  实际 ${show(actual)}`);
	}
}

// ---------------------------------------------------------- 1. 续行前缀
function prefixTests(): void {
	check("顶格：空前缀", continuationPrefix(""), "");
	check("两格空格：原样", continuationPrefix("  "), "  ");
	check("tab：原样", continuationPrefix("\t"), T);
	check("引用：补上标记后的空格", continuationPrefix(">"), "> ");
	check("引用：已有一格空格", continuationPrefix("> "), "> ");
	check("引用：多级", continuationPrefix(">>"), "> > ");
	check("引用：带缩进的多级", continuationPrefix("  > > "), "  > > ");
	check("列表符号：给不出参照", continuationPrefix("  - "), null);
	check("前面有正文：给不出参照", continuationPrefix("前面一句话"), null);
	check("前面有正文与空格：给不出参照", continuationPrefix("记录： "), null);
	check("正文里夹着引用符号：给不出参照", continuationPrefix("a > "), null);
}

// -------------------------------------------------- 2. 该用哪个缩进前缀
/**
 * 光标位置在文档里用 `|` 标出来，这一段（粘贴 / 选区）的长度由 `length` 给
 * —— 这样测试里不必手数偏移。
 */
function resolveAt(marked: string, length = 1): unknown {
	const from = marked.indexOf("|");
	const document = marked.slice(0, from) + marked.slice(from + 1);
	return resolveRangeIndent(document, from, from + length);
}

function resolveTests(): void {
	// 顶格粘贴：没有前缀，替换起点就是这一段本身
	check("顶格：不缩进", resolveAt("正文\n|", 0), { prefix: "", baseIndent: "", from: 3 });

	// 列表项里的续行位（Obsidian 自动缩进 2 格）：整块对齐到这一列
	check("列表项：按光标处缩进", resolveAt("- 群聊记录：\n  |\n- 下一条\n"), { prefix: "  ", baseIndent: "  ", from: 8 });

	// 引用块：`>` 链要留给每一行，否则内容会掉出引用
	check("引用块：每行都带引用标记", resolveAt("> 记录\n> |\n> 结束\n"), { prefix: "> ", baseIndent: "> ", from: 5 });

	// 上下都是顶格正文也照样按光标处缩进：光标放在第几层就是第几层，不去看别的行
	check("上下顶格也不影响光标处的缩进", resolveAt("顶格正文\n  |\n另一段顶格正文\n"), { prefix: "  ", baseIndent: "  ", from: 5 });
	check("上下缩进四格也不影响光标处的缩进", resolveAt("    说明\n  |\n    结尾\n"), { prefix: "  ", baseIndent: "  ", from: 7 });

	// 上一行是列表项（内容列由标记决定）：照样只认光标
	check("上一行是列表项：照样按光标", resolveAt("- 说明\n    |\n"), { prefix: "    ", baseIndent: "    ", from: 5 });

	// 文档以换行开头、上面再没有正文：照样按光标（顺带盯住"往上找行"没被用到）
	check("文档开头是空行：照样按光标", resolveAt("\n  |\n正文\n"), { prefix: "  ", baseIndent: "  ", from: 1 });

	// 前面已经有正文：给不出参照，也不吃掉任何字符
	check("前面有正文：不缩进也不吃掉正文", resolveAt("前面一句|", 0), { prefix: "", baseIndent: "", from: 4 });

	// 选区的缩进已经在选区里 ⇒ 按它自己那一层，不再照光标位置重算
	check("选区自带缩进：按它自己来",
		resolveAt("- 记录：\n|  张三 2024/1/5 14:30:25\n  你好\n", 31),
		{ prefix: "  ", baseIndent: "  ", from: 6 });

	// 选区从正文第一个字开始（缩进在选区外）⇒ 按起点那一行的前缀
	check("选区不含缩进：按起点那一行的前缀",
		resolveAt("- 记录：\n  |张三 2024/1/5 14:30:25\n  你好\n", 29),
		{ prefix: "  ", baseIndent: "  ", from: 6 });

	// 越界与空段
	check("空段：什么都不做", resolveRangeIndent("abc", 2, 2), { prefix: "", baseIndent: "", from: 2 });
}

// ------------------------------------------------ 3. 放到光标那一层与接缝换行
function applyTests(): void {
	check("加前缀：每行都加", applyIndentPrefix("a\nb\n", "  "), "  a\n  b\n");
	check("加前缀：空行不加（免得留下只有空白的行）", applyIndentPrefix("a\n\nb", "  "), "  a\n\n  b");
	check("加前缀：空前缀原样", applyIndentPrefix("a\nb", ""), "a\nb");
	check("加前缀：行首已有的缩进原样保留", applyIndentPrefix("\t你好", "  "), "  \t你好");

	// 整段自己共有的那一层缩进：placeBlockAt 收掉的就是它，所以单独盯一遍
	check("共有缩进：各行一致时取那一层", commonIndent("  甲\n  乙"), "  ");
	check("共有缩进：只有一行", commonIndent("  甲"), "  ");
	check("共有缩进：空行不参与", commonIndent("  甲\n\n  乙"), "  ");
	check("共有缩进：更深的那层不算共有", commonIndent("  甲\n    乙"), "  ");
	check("共有缩进：各行对不上时为空", commonIndent("  甲\n乙"), "");
	check("共有缩进：tab 与空格对不上时为空", commonIndent("\t甲\n  乙"), "");
	check("共有缩进：顶格时为空", commonIndent("甲\n乙"), "");
	check("共有缩进：全是空行时为空", commonIndent("\n\n"), "");

	// 剥缩进要在**排版之前**做：剥的是整段共有的那一层，更深的嵌套保留
	check("剥缩进：每行都剥一层", dedentBy("  甲\n  乙", "  "), "甲\n乙");
	check("剥缩进：更深的嵌套保留", dedentBy("  甲\n    乙", "  "), "甲\n  乙");
	check("剥缩进：空行不动", dedentBy("  甲\n\n  乙", "  "), "甲\n\n乙");
	check("剥缩进：行首带着它的才剥", dedentBy("甲\n  乙", "  "), "甲\n乙");
	check("剥缩进：空 baseIndent 原样", dedentBy("  甲", ""), "  甲");

	// 整块落到光标那一层：先收掉它自己共有的一层，再加前缀 —— 不是"前缀 + 原文"
	check("落块：整块都缩进时并入光标这一层", placeBlockAt("\t你好\n\t在的", ""), "你好\n在的");
	check("落块：光标在 1 层", placeBlockAt("\t你好\n\t在的", T), `${T}你好\n${T}在的`);
	check("落块：光标在 2 层", placeBlockAt("\t你好\n\t在的", T + T), `${T}${T}你好\n${T}${T}在的`);
	check("落块：有头部时正文比头部深一格",
		placeBlockAt("张三: 2024/01/05 14:30:25\n\t你好", "  "),
		`  张三: 2024/01/05 14:30:25\n  ${T}你好`);
	check("落块：块内部更深的缩进保留", placeBlockAt("  甲\n    乙", "  "), "  甲\n    乙");

	// 排版结果总会带一个收尾换行；粘贴进来的那一段本来没有，就不该凭空多出来
	check("接缝：原文没有收尾换行", keepEdgeNewlines("a\nb", "甲\n乙\n"), "甲\n乙");
	check("接缝：原文以空行收尾", keepEdgeNewlines("a\nb\n\n", "甲\n乙\n"), "甲\n乙\n\n");
	check("接缝：原文以换行收尾", keepEdgeNewlines("a\n", "甲\n乙\n"), "甲\n乙\n");
	check("接缝：原文以换行开头", keepEdgeNewlines("\n\na\n", "甲\n乙\n"), "\n\n甲\n乙\n");
	check("接缝：原文首尾都没有换行", keepEdgeNewlines("ab", "\n甲\n"), "甲");
}

// ------------------------------------------------------------ 5. 端到端
/** 默认设置（与插件默认一致：头部信息全显示、tab 正文缩进） */
const BASE: TextPipelineOptions = {
	leadingIndent: "smart",
	chat: DEFAULT_CHAT_LOG_OPTIONS,
	listRenumber: true,
	headingLevels: true,
	textMath: DEFAULT_TEXT_MATH_OPTIONS,
	mathLayout: false,
	spacing: DEFAULT_SPACING_OPTIONS,
	tags: null,
	blockSort: false,
};

/** 使用者的实际设置：头部信息全关（只留正文）、图片在文字上方、去掉 @ 提及 */
const BODY_ONLY: TextPipelineOptions = {
	...BASE,
	chat: {
		...DEFAULT_CHAT_LOG_OPTIONS,
		showUsername: false,
		showDate: false,
		showTime: false,
		imageOrder: "above",
		stripMentions: true,
	},
};

/**
 * 模拟 `tasks.typesetEditorRange`：把编辑器里 `[from, to)` 这一段排版后写回整篇。
 * 这里没有 Obsidian，但组合顺序与实现完全一致（解析缩进 → 排版 → 加前缀 → 还原接缝）。
 */
function fixRange(document: string, from: number, to: number, options: TextPipelineOptions): string {
	const indent = resolveRangeIndent(document, from, to);
	const pasted = document.substring(from, to);
	const typeset = formatNoteText(dedentBy(pasted, indent.baseIndent), options);
	const result = keepEdgeNewlines(pasted, placeBlockAt(typeset, indent.prefix));
	return document.substring(0, indent.from) + result + document.substring(to);
}

const RAW = "张三 2024/1/5 14:30:25\n你好\n\n李四 2024/1/5 14:31:02\n在的";

function endToEndTests(): void {
	// ① 列表项里粘贴：整块落在列表项这一层（正文那一格并入光标这一层，头部信息全关时整块都是正文）
	const listDoc = "- 群聊记录：\n  " + RAW + "\n- 下一条\n";
	const listFrom = "- 群聊记录：\n  ".length;
	check("端到端_列表项里粘贴",
		fixRange(listDoc, listFrom, listFrom + RAW.length, BODY_ONLY),
		[
			"- 群聊记录：",
			"  你好",
			"  在的",
			"- 下一条",
			"",
		].join("\n"));

	// ② 接缝：粘贴块前后各一行空行，排完还是各一行（旧版会在末尾多出一行）
	const seamDoc = "前面一段话。\n\n" + RAW + "\n\n后面一段话。";
	const seamFrom = "前面一段话。\n\n".length;
	check("端到端_接缝不多出空行",
		fixRange(seamDoc, seamFrom, seamFrom + RAW.length, BODY_ONLY),
		[
			"前面一段话。",
			"",
			"你好",
			"在的",
			"",
			"后面一段话。",
		].join("\n"));

	// ③ 引用块里粘贴：每一行都带 `>`（旧版只有第一行在引用里，其余掉出去）
	const quoteDoc = "> 记录\n> " + RAW + "\n> 结束\n";
	const quoteFrom = "> 记录\n> ".length;
	check("端到端_引用块里粘贴",
		fixRange(quoteDoc, quoteFrom, quoteFrom + RAW.length, BODY_ONLY),
		[
			"> 记录",
			"> 你好",
			"> 在的",
			"> 结束",
			"",
		].join("\n"));

	// ④ 上下文的缩进与光标处不一样：照样按光标处算（只看光标，不看别的行）
	const messyDoc = "顶格正文\n  " + RAW + "\n另一段顶格正文\n";
	const messyFrom = "顶格正文\n  ".length;
	check("端到端_上下顶格也按光标处缩进",
		fixRange(messyDoc, messyFrom, messyFrom + RAW.length, BODY_ONLY),
		[
			"顶格正文",
			"  你好",
			"  在的",
			"另一段顶格正文",
			"",
		].join("\n"));

	// ⑤ 默认设置（头部信息全显示）：头部落在光标那一列、正文比头部深一格
	const headDoc = "  " + RAW + "\n";
	check("端到端_默认设置跟随缩进",
		fixRange(headDoc, 2, 2 + RAW.length, BASE),
		[
			"  张三: 2024/01/05 14:30:25",
			`  ${T}你好`,
			"  李四: 2024/01/05 14:31:02",
			`  ${T}在的`,
			"",
		].join("\n"));

	// ⑥ 再排一次不变：插件连跑两次不该改第二次
	const once = fixRange(listDoc, listFrom, listFrom + RAW.length, BODY_ONLY);
	const blockEnd = once.indexOf("\n- 下一条");
	check("端到端_再排一次不变",
		fixRange(once, listFrom, blockEnd, BODY_ONLY),
		once);

	// ⑦ 选一整段已经缩进好的列表项：流水线会放过列表符号前的缩进，
	//    剥掉原本那一层再加前缀，结果一个字符都不该变（叠成两层就错了）
	const nestedDoc = "- 列表：\n  - 子项一\n  - 子项二\n";
	check("端到端_已缩进的列表项不被叠成两层",
		fixRange(nestedDoc, 6, nestedDoc.length - 1, BASE),
		nestedDoc);

	// ⑧ 光标缩进与「消息正文缩进」用同一个字符（都用 tab）时不许再加一层：
	//    光标在第几层，整块就在第几层（0 层 → 顶格、1 层 → 1 层、2 层 → 2 层）
	for (const [label, prefix] of [["0层", ""], ["1层", T], ["2层", T + T]] as Array<[string, string]>) {
		const tabDoc = prefix + RAW + "\n";
		check(`端到端_制表符缩进_${label}`,
			fixRange(tabDoc, prefix.length, prefix.length + RAW.length, BODY_ONLY),
			[`${prefix}你好`, `${prefix}在的`, ""].join("\n"));
	}
}

// -------------------------------------------- 6. 真接线（ImageTasks 那条路）
/**
 * 编辑器替身：坐标与真编辑器一致 —— 偏移就是**字符串下标**（`posToOffset` 与 `offsetToPos` 互为反函数），
 * 这样 `ImageTasks.typesetEditorRange` 里"拿整篇算缩进、按偏移写回"才走得通。
 */
function createEditor(text: string): { editor: Editor; value: () => string; setCursor: (offset: number) => void } {
	let value = text;
	let cursor = text.length;

	const lineStart = (line: number): number => {
		let index = 0;
		for (let i = 0; i < line; i++) {
			const next = value.indexOf("\n", index);
			if (next === -1) return value.length;
			index = next + 1;
		}
		return index;
	};
	const posToOffset = (pos: { line: number; ch: number }): number =>
		Math.min(lineStart(pos.line) + pos.ch, value.length);
	const offsetToPos = (offset: number): { line: number; ch: number } => {
		const clamped = Math.max(0, Math.min(offset, value.length));
		const line = value.slice(0, clamped).split("\n").length - 1;
		return { line, ch: clamped - lineStart(line) };
	};

	const editor = {
		getValue: (): string => value,
		posToOffset,
		offsetToPos,
		// 粘贴之后光标落在这一段末尾 —— `fixPastedRange` 就是这么取这一段终点的
		getCursor: (): { line: number; ch: number } => offsetToPos(cursor),
		getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }): string =>
			value.substring(posToOffset(from), posToOffset(to)),
		replaceRange: (replacement: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void => {
			value = value.slice(0, posToOffset(from)) + replacement + value.slice(posToOffset(to));
		},
	} as unknown as Editor;

	return { editor, value: () => value, setCursor: (offset: number) => { cursor = offset; } };
}

async function wiringTests(): Promise<void> {
	const file = Object.assign(new TFile(), { path: "聊天记录.md", name: "聊天记录.md", extension: "md" });
	// 使用者的实际设置：头部信息全关、去掉 @ 提及（正文缩进 = tab、消息之间不留空行都是默认值）
	const settings = {
		...DEFAULT_SETTINGS,
		chatShowUsername: false,
		chatShowDate: false,
		chatShowTime: false,
		chatStripMentions: true,
	};
	// fixPastedRange 不走批量壳，互斥锁与状态栏都用不上
	const tasks = new ImageTasks(
		{} as unknown as App,
		() => settings,
		null as unknown as BatchRunner,
		null as unknown as StatusBarProgress,
		async () => undefined
	);

	// ① 列表项里粘贴（光标缩进 2 空格）：整块落在列表项这一层，接缝也不多出空行
	const listDocument = "- 群聊记录：\n  " + RAW + "\n\n- 下一条\n";
	const listFrom = "- 群聊记录：\n  ".length;
	const list = createEditor(listDocument);
	list.setCursor(listFrom + RAW.length);
	check("真接线_报为已修复", await tasks.fixPastedRange(file, list.editor, listFrom), true);
	check("真接线_列表项里粘贴", list.value(),
		[
			"- 群聊记录：",
			"  你好",
			"  在的",
			"",
			"- 下一条",
			"",
		].join("\n"));

	// ② 制表符缩进（笔记与「消息正文缩进」都用 tab）：0 / 1 / 2 层各粘一次，
	//    整块就落在光标那一层，不许再加一层
	for (const [label, prefix] of [["0层", ""], ["1层", T], ["2层", T + T]] as Array<[string, string]>) {
		const tabDocument = `${prefix}${RAW}\n`;
		const tabEditor = createEditor(tabDocument);
		tabEditor.setCursor(prefix.length + RAW.length);
		await tasks.fixPastedRange(file, tabEditor.editor, prefix.length);
		check(`真接线_制表符缩进_${label}`, tabEditor.value(),
			[`${prefix}你好`, `${prefix}在的`, ""].join("\n"));
	}

	// ③ 粘贴进来的图片顺手套上默认尺寸（与排版**同一次写回**）：聊天记录里的图片带着 |100
	const chatWithImage = "张三 2024/1/5 14:30:25\n![[图.png]]\n你好";
	const imageEditor = createEditor(`${chatWithImage}\n`);
	imageEditor.setCursor(chatWithImage.length);
	check("真接线_带图的聊天记录报为已修复", await tasks.fixPastedRange(file, imageEditor.editor, 0), true);
	check("真接线_聊天记录里的图片带上默认尺寸", imageEditor.value().includes("![[图.png|100]]"), true);
	// 排版与套尺寸合在同一次写回里：图片按「消息正文缩进」落在 tab 那一层，正文在它下面
	check("真接线_排版照样做完了（图片在正文前，且带着尺寸）",
		imageEditor.value(), "\t![[图.png|100]]\n你好\n");

	// ④ 只有图片、没有聊天记录：走 sizePastedRange 那条路（文本修复那一步不该动它）
	const imageOnly = "![[图.png]]";
	const sizeOnlyEditor = createEditor(imageOnly);
	sizeOnlyEditor.setCursor(imageOnly.length);
	check("真接线_只给图片套尺寸", await tasks.sizePastedRange(sizeOnlyEditor.editor, 0), true);
	check("真接线_图片加上了默认尺寸", sizeOnlyEditor.value(), "![[图.png|100]]");
	// 再跑一次：已经有尺寸，什么都不改（幂等 —— 观望表会重复调用它）
	check("真接线_重复跑不再改动", await tasks.sizePastedRange(sizeOnlyEditor.editor, 0), false);
	check("真接线_内容一字不变", sizeOnlyEditor.value(), "![[图.png|100]]");

	// ⑤ 关掉「粘贴图片时自动套用尺寸」：一条都不碰
	settings.autoSetImageSizeOnPaste = false;
	const offEditor = createEditor("![[图.png]]");
	offEditor.setCursor("![[图.png]]".length);
	check("真接线_开关关掉就不动手", await tasks.sizePastedRange(offEditor.editor, 0), false);
	check("真接线_开关关掉内容不变", offEditor.value(), "![[图.png]]");
	settings.autoSetImageSizeOnPaste = true;
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 续行前缀 ===");
prefixTests();

console.log("=== 2. 该用哪个缩进前缀 ===");
resolveTests();

console.log("=== 3. 加前缀与接缝换行 ===");
applyTests();

console.log("=== 4. 端到端 ===");
endToEndTests();

console.log("=== 5. 真接线 ===");
await wiringTests();

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
