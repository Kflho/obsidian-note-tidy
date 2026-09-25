/**
 * 图片嵌入扫描测试（`src/image/scan.ts`）
 *
 * 运行：npm test
 *
 * 这是"哪些算图片"的唯一判定，状态栏计数与复制图片都吃它，重点保证：
 *   1. 两种嵌入（`![[图.png]]`、`![说明](图.png)`）都找得到，带尺寸 / 别名 / 片段 / 标题也不漏
 *   2. 指向图片的普通链接（`[[图.png]]`、`[说明](图.png)`）不算 —— 那在笔记里不是图片
 *   3. 代码块与行内代码里的链接不算；开头是 `---`（多半是分隔线）时不算 frontmatter
 *   4. 位置（from / to）准，光标落在嵌入里能取到、落在外面的字上取不到
 *   5. 批量复制：选区里有图片就取选区里的，没有才回退到光标处那一条
 */
import { collectImageRefs, countImageRefs, findImageRefAt, pickImageRefs } from "../src/image/scan";

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

/** 数一段文本并断言张数 */
function expectCount(name: string, text: string, expected: number): void {
	checkEqual(name, countImageRefs(text), expected);
}

/** 取出目标清单（断言"找到的是哪几张"，不只是几张） */
function targets(text: string): string[] {
	return collectImageRefs(text).map(ref => ref.target);
}

// ------------------------------------------------------------ 1. 双链嵌入
function wikiTests(): void {
	expectCount("单张图片", "![[图.png]]", 1);
	expectCount("两张图片", "![[图1.png]] 与 ![[图2.jpg]]", 2);
	expectCount("同一张嵌两次算两张", "![[图.png]]\n![[图.png]]", 2);
	expectCount("带尺寸", "![[图.png|100]]", 1);
	expectCount("带尺寸与位置", "![[图.png|100x200]]", 1);
	expectCount("带片段", "![[图.png#center]]", 1);
	expectCount("带路径", "![[附件/图.png]]", 1);
	expectCount("文件名含空格", "![[我 的 图.png]]", 1);
	expectCount("大写扩展名", "![[图.PNG]]", 1);
	expectCount("宽表里的格式也认（svg / avif）", "![[图标.svg]] ![[照片.avif]]", 2);
	expectCount("别名是图片但目标是笔记", "![[笔记|图.png]]", 0);
	expectCount("目标是笔记", "![[笔记]]", 0);
	expectCount("普通双链（没有 !，渲染成链接不是图片）", "[[图.png]]", 0);
	expectCount("受管位图之外的扩展名", "![[文档.pdf]]", 0);
	// 带尺寸 / 别名的目标要取成文件名本身，别名不能混进来
	checkEqual("目标去掉别名", targets("![[图.png|100]]"), ["图.png"]);
	checkEqual("目标去掉片段外的别名", targets("![[图.png#center|200]]"), ["图.png#center"]);
}

// -------------------------------------------------------- 2. Markdown 嵌入
function markdownTests(): void {
	expectCount("Markdown 图片", "![说明](附件/图.png)", 1);
	expectCount("空说明", "![](图.png)", 1);
	expectCount("外部绝对路径", "![说明](D:\\图片\\图.png)", 1);
	expectCount("file:// 写法", "![说明](file:///D:/图片/图.png)", 1);
	expectCount("带标题", '![说明](图.png "标题")', 1);
	expectCount("尖括号包裹（路径含空格）", "![说明](<我的 图.png>)", 1);
	expectCount("指向非图片", "![说明](笔记.md)", 0);
	expectCount("普通 Markdown 链接", "[说明](图.png)", 0);
	expectCount("一行两张", "![a](a.png) 和 ![b](b.webp)", 2);
	// 目标要把 `<>` 与 `"标题"` 都剥掉，交给解析的那一步
	checkEqual("目标剥掉尖括号", targets("![说明](<我的 图.png>)"), ["我的 图.png"]);
	checkEqual("目标剥掉标题", targets('![说明](图.png "标题")'), ["图.png"]);
}

// ------------------------------------------------------------- 3. 保护区
function protectedTests(): void {
	expectCount("围栏代码块里的链接不算", ["```md", "![[图.png]]", "![说明](图.png)", "```"].join("\n"), 0);
	expectCount("波浪号围栏", ["~~~", "![[图.png]]", "~~~"].join("\n"), 0);
	expectCount("围栏外的照数", ["![[图.png]]", "```md", "![[示例.png]]", "```", "![[另一张.png]]"].join("\n"), 2);
	expectCount("未闭合的围栏后面全算代码（与排版一致）", ["```", "![[图.png]]"].join("\n"), 0);
	// 选区 / 片段开头那个 `---` 多半是分隔线，不该把整段当 frontmatter 吃掉
	expectCount("以 --- 包裹的片段照数", ["---", "![[图.png]]", "---"].join("\n"), 1);
	expectCount("行内代码里的链接不算", "写法是 `![[图.png]]`", 0);
	expectCount("行内代码旁边的那张照数", "写法是 `![[图.png]]`，实际是 ![[真图.png]]", 1);
	expectCount("双反引号行内代码", "`` ![[图.png]] ``", 0);
}

// ------------------------------------------------------------- 4. 位置
function positionTests(): void {
	const text = ["第一行 ![[a.png]]", "第二行", "![说明](b.png) 结尾"].join("\n");
	const refs = collectImageRefs(text);

	checkEqual("两条", refs.length, 2);
	checkEqual("第一条目标", refs[0]?.target, "a.png");
	checkEqual("第二条目标", refs[1]?.target, "b.png");
	checkEqual("第一条语法", refs[0]?.kind, "wiki");
	checkEqual("第二条语法", refs[1]?.kind, "markdown");

	const first = refs[0];
	const second = refs[1];
	checkTrue("位置对得上原文", first !== undefined && second !== undefined
		&& text.slice(first.from, first.to) === "![[a.png]]"
		&& text.slice(second.from, second.to) === "![说明](b.png)",
		`实际 ${first ? JSON.stringify(text.slice(first.from, first.to)) : "无"} / ${second ? JSON.stringify(text.slice(second.from, second.to)) : "无"}`);

	// 选区是片段时，位置要带上整篇里的偏移（否则光标判定会错位）
	const sliced = collectImageRefs(text.slice(9), 9);
	checkEqual("片段位置带偏移", sliced[0]?.from, refs[1]?.from);

	// 光标落点
	checkEqual("光标落在嵌入里", findImageRefAt(refs, (first?.from ?? 0) + 3)?.target, "a.png");
	checkEqual("光标落在空处", findImageRefAt(refs, 2), null);
}

// ------------------------------------------------------- 5. 这次复制哪几张
function pickTests(): void {
	const text = ["![[a.png]]", "中间一行", "![[b.png]] 和 ![[c.png]]"].join("\n");
	const refs = collectImageRefs(text);
	const b = refs.find(ref => ref.target === "b.png");
	const c = refs.find(ref => ref.target === "c.png");

	// 选中两行 → 复制选区里的两张（批量）
	const batch = pickImageRefs(text, 0, { from: b?.from ?? 0, to: c?.to ?? 0 });
	checkEqual("选区里有图片就复制选区里的", batch.map(ref => ref.target), ["b.png", "c.png"]);

	// 没有选区 → 光标处那一条（右键点在图片上）
	checkEqual("没有选区时取光标处的", pickImageRefs(text, (b?.from ?? 0) + 1, null).map(ref => ref.target), ["b.png"]);

	// 选区里没有图片（选了中间的正文）→ 退回到光标处的
	checkEqual("选区里没图片时回退到光标处", pickImageRefs(text, (c?.from ?? 0) + 1, { from: 12, to: 16 }).map(ref => ref.target), ["c.png"]);

	// 什么都没有 → 空
	checkEqual("光标在空处且没有选区", pickImageRefs(text, 13, null), []);
	checkEqual("空文档", pickImageRefs("", 0, null), []);
}

// ------------------------------------------------------------- 6. 边界
function edgeTests(): void {
	expectCount("空串", "", 0);
	expectCount("没有叹号的正文", "这里没有图片，只有 ! 一个叹号", 0);
	expectCount("只有图片语法的一半", "![[图.png", 0);
	expectCount("多行混合", ["# 标题", "", "![[封面.png]]", "", "- 正文", "- ![说明](图.png)"].join("\n"), 2);
}

// -------------------------------------------------------------------- 运行
console.log("=== 双链嵌入 ===");
wikiTests();
console.log("=== Markdown 嵌入 ===");
markdownTests();
console.log("=== 保护区 ===");
protectedTests();
console.log("=== 位置 ===");
positionTests();
console.log("=== 这次复制哪几张 ===");
pickTests();
console.log("=== 边界 ===");
edgeTests();

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
