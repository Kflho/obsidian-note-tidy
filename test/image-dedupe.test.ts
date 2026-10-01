/**
 * 合并重复图片（`src/image/dedupe.ts`）
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 粗分组：只有"同一文件夹 + 字节数相同"才进候选（跨目录的同图是设计如此，不能合并）
 *   2. 逐字节比对：大小一样但内容不同要拆开；读不动的文件单独一组（宁可少合并）
 *   3. 留哪张：引用最多的优先，一样多取名字最小的（结果可复现）
 *   4. 引用改写：`![[名]]` / `[[名]]` / `![](.../名)` / canvas 都改到，且不误伤长名字
 *   5. 表格里的写法（`![[名\|100]]`）算引用 —— 漏了它，清理未引用图片会把表格里的图删掉
 */
import {
	chooseKeeper,
	collectImageTargets,
	countImageReferences,
	findIdenticalGroups,
	groupByFolderAndSize,
	isManagedImageExtension,
	rewriteImageReferences,
	sameBytes,
} from "../src/image/dedupe";
import type { ImageEntry } from "../src/image/dedupe";

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

// -------------------------------------------------------------------- 工具
function entry(folder: string, name: string, size: number): ImageEntry {
	return { path: folder ? `${folder}/${name}` : name, name, folder, size };
}

function bytes(text: string): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** 用内容表造一个 readBytes 替身（键按完整路径） */
function reader(table: Record<string, ArrayBuffer>, failOn: string[] = []): (path: string) => Promise<ArrayBuffer> {
	return async (path: string) => {
		if (failOn.includes(path)) throw new Error(`模拟读取失败：${path}`);
		const data = table[path];
		if (!data) throw new Error(`没有 ${path}`);
		return data;
	};
}

// ------------------------------------------------------------ 1. 扩展名与粗分组
function groupTests(): void {
	check("扩展名：webp 受管", isManagedImageExtension("webp"), true);
	check("扩展名：PNG 大小写不敏感", isManagedImageExtension("PNG"), true);
	check("扩展名：svg 不归它管", isManagedImageExtension("svg"), false);
	check("扩展名：avif 不归它管", isManagedImageExtension("avif"), false);
	check("扩展名：md 不是图片", isManagedImageExtension("md"), false);

	const entries = [
		entry("att", "a1.webp", 100),
		entry("att", "a2.webp", 100),   // 同目录同大小 → 候选
		entry("att", "b.webp", 200),    // 大小不同 → 不进来
		entry("other", "a3.webp", 100), // 目录不同 → 不进来
		entry("att", "only.webp", 300), // 落单 → 不进来
	];
	const groups = groupByFolderAndSize(entries);
	check("粗分组：只留下同目录同大小的一组", groups.length, 1);
	check("粗分组：组内成员", groups[0]?.map(e => e.name).sort(), ["a1.webp", "a2.webp"]);

	check("粗分组：目录尾斜杠不影响分组",
		groupByFolderAndSize([entry("att/", "x.webp", 5), entry("att", "y.webp", 5)]).length, 1);
	check("粗分组：全落单时没有组", groupByFolderAndSize([entry("att", "a.webp", 1)]), []);
}

// ------------------------------------------------------------ 2. 逐字节比对
async function identicalTests(): Promise<void> {
	check("字节比对：相同", sameBytes(bytes("abc"), bytes("abc")), true);
	check("字节比对：长度不同", sameBytes(bytes("abc"), bytes("abcd")), false);
	check("字节比对：长度相同内容不同", sameBytes(bytes("abc"), bytes("abd")), false);

	const group = [entry("att", "a.webp", 3), entry("att", "b.webp", 3), entry("att", "c.webp", 3)];
	const read = reader({
		"att/a.webp": bytes("aaa"),
		"att/b.webp": bytes("aaa"),   // 与 a 相同
		"att/c.webp": bytes("bbb"),   // 与 a 同大小但内容不同
	});
	const groups = await findIdenticalGroups(group, read);
	check("逐字节比对：拆成两组", groups.length, 2);
	check("逐字节比对：相同的一组",
		groups.find(g => g.length === 2)?.map(e => e.name), ["a.webp", "b.webp"]);
	check("逐字节比对：不同的单独一组",
		groups.find(g => g.length === 1)?.map(e => e.name), ["c.webp"]);

	// 读不动：单独一组，绝不能拿"没读到的"去等同
	const failing = await findIdenticalGroups(group, reader({}, ["att/a.webp", "att/b.webp", "att/c.webp"]));
	check("读不动的各自一组（宁可少合并）", failing.map(g => g.length).sort(), [1, 1, 1]);
}

// ------------------------------------------------------------ 3. 留哪张
function keeperTests(): void {
	const group = [entry("att", "b.webp", 10), entry("att", "a.webp", 10), entry("att", "c.webp", 10)];
	const counts: Record<string, number> = { "a.webp": 5, "b.webp": 5, "c.webp": 1 };
	check("留哪张：引用最多者优先（并列取名字最小）",
		chooseKeeper(group, name => counts[name] ?? 0).name, "a.webp");

	const counts2: Record<string, number> = { "a.webp": 1, "b.webp": 9 };
	check("留哪张：引用多者胜出",
		chooseKeeper(group, name => counts2[name] ?? 0).name, "b.webp");

	check("留哪张：都没人引用时取名字最小",
		chooseKeeper(group, () => 0).name, "a.webp");
}

// ------------------------------------------------------------ 4. 引用改写与计数
function referenceTests(): void {
	const from = "pasted_image_1.webp";
	const to = "pasted_image_2.webp";

	check("改写：嵌入", rewriteImageReferences(`![[${from}]]`, from, to), `![[${to}]]`);
	check("改写：带尺寸别名", rewriteImageReferences(`![[${from}|100]]`, from, to), `![[${to}|100]]`);
	check("改写：普通双链", rewriteImageReferences(`[[${from}]]`, from, to), `[[${to}]]`);
	check("改写：带片段", rewriteImageReferences(`[[${from}#x]]`, from, to), `[[${to}#x]]`);
	check("改写：Markdown 路径写法",
		rewriteImageReferences(`![](attachments/${from})`, from, to), `![](attachments/${to})`);
	check("改写：canvas 的 file 字段",
		rewriteImageReferences(`{"file":"attachments/${from}"}`, from, to), `{"file":"attachments/${to}"}`);
	check("改写：一行里出现多次全改",
		rewriteImageReferences(`a![[${from}]]b![[${from}|50]]c`, from, to), `a![[${to}]]b![[${to}|50]]c`);

	// 词边界：别把"名字的一部分"当成它
	check("改写：前缀不能误伤", rewriteImageReferences(`![[x_${from}]]`, from, to), `![[x_${from}]]`);
	check("改写：后缀不能误伤", rewriteImageReferences(`[[${from}.bak]]`, from, to), `[[${from}.bak]]`);
	check("改写：同一次调用改完不重复替换",
		rewriteImageReferences(`![[${from}]] ![[${to}]]`, from, to), `![[${to}]] ![[${to}]]`);
	check("改写：名字相同直接原样返回", rewriteImageReferences("![[a]]", "a", "a"), "![[a]]");

	check("计数：数出现次数", countImageReferences(`![[${from}]]\n![[${from}|5]]`, from), 2);
	check("计数：词边界同样生效", countImageReferences(`![[x_${from}]]`, from), 0);
}

// ------------------------------------------------------------ 5. 目标抽取
function targetTests(): void {
	const text = [
		"![[a.webp]]",                    // 嵌入
		"![[b.PNG|300]]",                 // 大写扩展名 + 尺寸
		"[[c.jpg#片段]]",                  // 普通双链 + 片段
		"![](attachments/d.gif)",         // Markdown 带路径
		"![](<e%20f.webp>)",              // 尖括号 + URL 编码
		"![[note.md]]",                   // 不是图片
		'"file": "attachments/g.webp"',   // canvas
	].join("\n");
	check("抽取：四种写法都认，非图片不要，统一小写",
		collectImageTargets(text).sort(),
		["a.webp", "b.png", "c.jpg", "d.gif", "e f.webp", "g.webp"]);
	check("抽取：空文本", collectImageTargets(""), []);
}

// ------------------------------------------------- 6. 表格里的写法（GFM 转义）
function tableTests(): void {
	// GFM 表格里 `|` 必须写成 `\|`，链接正则又在 `|` 前面停下 —— 捕获到的目标末尾
	// 会多一个转义反斜杠。2026-09 的 bug：就是它让表格里的图被判成"没人引用"清掉的。
	check("抽取：表格里的嵌入（转义尺寸）", collectImageTargets("![[a.webp\\|100]]"), ["a.webp"]);
	check("抽取：竖线后带空格", collectImageTargets("![[a.webp\\| 100x200]]"), ["a.webp"]);
	check("抽取：表格里的普通双链", collectImageTargets("[[a.webp\\|说明]]"), ["a.webp"]);
	check("抽取：一整行表格里的好几张",
		collectImageTargets("| 1排 | ![[a.webp\\|97]]![[b.webp\\|140]] | ![[c.webp\\| 100]] |"),
		["a.webp", "b.webp", "c.webp"]);
	check("抽取：表格里的非图片照样不认", collectImageTargets("![[note.md\\|100]]"), []);
	check("抽取：表格里的 canvas 写法", collectImageTargets('"file": "att/a.webp"'), ["a.webp"]);

	check("改写：转义竖线原样留着", rewriteImageReferences("![[a.webp\\|100]]", "a.webp", "b.webp"), "![[b.webp\\|100]]");
	check("计数：转义写法也算一次引用", countImageReferences("![[a.webp\\|100]]", "a.webp"), 1);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 扩展名与粗分组 ===");
groupTests();

console.log("=== 2. 逐字节比对 ===");
await identicalTests();

console.log("=== 3. 留哪张 ===");
keeperTests();

console.log("=== 4. 引用改写与计数 ===");
referenceTests();

console.log("=== 5. 目标抽取 ===");
targetTests();

console.log("=== 6. 表格里的写法 ===");
tableTests();

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
