/**
 * 「文字 + 图片」混排复制（`src/image/rich-copy.ts`）的纯函数测试
 *
 * 运行：npm test
 *
 * 这块最容易错的是**字节偏移**：CF_HTML 头里的 StartFragment / EndFragment 按 UTF-8
 * 字节算，中文一个字三字节 —— 按字符数算就会错位，目标程序解析出来是乱码或不出图。
 * 所以这里除了拼出来的 HTML 长什么样，还要**按头里的偏移量把片段切回来**核对一遍。
 */
import {
	MAX_EMBED_BYTES,
	MAX_EMBED_TOTAL_BYTES,
	buildClipboardHtml,
	buildHtmlFragment,
	buildRichContent,
	dataUriOf,
	escapeHtml,
	fileUrlOf,
	hasTextBesidesImages,
	imageSourceMap,
	mimeTypeOf,
	utf8Length,
} from "../src/image/rich-copy";

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

// -------------------------------------------------------------------- 用例
console.log("=== 有没有文字 ===");
checkEqual("只有一条图片链接 → 纯图片", hasTextBesidesImages("![[图.png]]", [{ from: 0, to: 10 }]), false);
checkEqual("两张图也只有图片", hasTextBesidesImages("![[甲.png]]\n![[乙.png]]", [{ from: 0, to: 10 }, { from: 11, to: 21 }]), false);
checkEqual("图片周围的空格换行不算文字", hasTextBesidesImages("\n  ![[图.png]]  \n", [{ from: 3, to: 13 }]), false);
checkEqual("前面有字", hasTextBesidesImages("看这张 ![[图.png]]", [{ from: 4, to: 14 }]), true);
checkEqual("后面有字", hasTextBesidesImages("![[图.png]] 很好看", [{ from: 0, to: 10 }]), true);
checkEqual("夹在中间有字", hasTextBesidesImages("![[甲.png]]和![[乙.png]]", [{ from: 0, to: 10 }, { from: 11, to: 21 }]), true);
checkEqual("位置乱序也给对", hasTextBesidesImages("![[甲.png]]和![[乙.png]]", [{ from: 11, to: 21 }, { from: 0, to: 10 }]), true);
checkEqual("空选区没有文字", hasTextBesidesImages("", []), false);

console.log("=== file:/// 地址 ===");
checkEqual("Windows 路径（中文原样留着）", fileUrlOf("D:\\仓库\\附件\\图.png"), "file:///D:/仓库/附件/图.png");
checkEqual("空格编掉", fileUrlOf("D:\\a b\\图.png"), "file:///D:/a%20b/图.png");
checkEqual("正斜杠原样", fileUrlOf("D:/a/图.png"), "file:///D:/a/图.png");
checkEqual("盘符的冒号留着", fileUrlOf("C:\\1.png"), "file:///C:/1.png");
checkEqual("macOS 路径", fileUrlOf("/Users/me/我的图.png"), "file:///Users/me/我的图.png");
checkEqual("井号 / 问号 / 百分号编掉（否则被当成 URL 片段或已转义）", fileUrlOf("D:\\a#b?c%20\\图.png"), "file:///D:/a%23b%3Fc%2520/图.png");

console.log("=== HTML 片段 ===");
checkEqual("转义", escapeHtml("a & b <c>"), "a &amp; b &lt;c&gt;");
checkEqual("换行变 <br>", buildHtmlFragment("甲\n乙", []), "甲<br>乙");
checkEqual("图片顶在原位置", buildHtmlFragment("看图 ![[图.png]] 好的", [{ path: "D:\\图.png", from: 3, to: 13 }]),
	`看图 <img src="file:///D:/图.png"> 好的`);
checkEqual("两张图各就各位", buildHtmlFragment("![[甲.png]]和![[乙.png]]", [
	{ path: "D:\\甲.png", from: 0, to: 10 },
	{ path: "D:\\乙.png", from: 11, to: 21 },
]), `<img src="file:///D:/甲.png">和<img src="file:///D:/乙.png">`);
checkEqual("文字里的 & < > 不会破坏标签", buildHtmlFragment("<a & b>", []), "&lt;a &amp; b&gt;");
checkEqual("越界的图片位置跳过", buildHtmlFragment("短", [{ path: "D:\\图.png", from: 0, to: 99 }]), "短");
checkEqual("重叠的位置只认前一条", buildHtmlFragment("![[甲.png]]", [
	{ path: "D:\\甲.png", from: 0, to: 10 },
	{ path: "D:\\乙.png", from: 5, to: 10 },
]), `<img src="file:///D:/甲.png">`);
checkEqual("可以换 src 的取法", buildHtmlFragment("![[图.png]]", [{ path: "D:\\图.png", from: 0, to: 10 }], path => `data:image/png;base64,${path.length}`),
	`<img src="data:image/png;base64,8">`);

console.log("=== CF_HTML 头 ===");
const fragment = `看<img src="file:///D:/图.png">好`;
const html = buildClipboardHtml(fragment);
const readOffset = (name: string): number => Number(new RegExp(`${name}:(\\d+)`).exec(html)?.[1] ?? "-1");
const startHtml = readOffset("StartHTML");
const endHtml = readOffset("EndHTML");
const startFragment = readOffset("StartFragment");
const endFragment = readOffset("EndFragment");

checkTrue("有 Version:0.9", html.startsWith("Version:0.9\r\n"), html.slice(0, 40));
checkTrue("偏移量补零到 10 位", /StartHTML:0\d{9}\r\n/.test(html), html.slice(0, 120));
checkTrue("StartHTML = 头本身的字节数", startHtml === utf8Length(html.slice(0, html.indexOf("<html>"))), `StartHTML=${startHtml}`);
checkTrue("EndHTML 落在末尾", endHtml === Buffer.byteLength(html, "utf8"), `EndHTML=${endHtml} 实际 ${Buffer.byteLength(html, "utf8")}`);

const bytes = Buffer.from(html, "utf8");
checkEqual("按头的偏移切回片段（中文也对）", bytes.subarray(startFragment, endFragment).toString("utf8"), fragment);
checkEqual("片段外是标准外壳",
	bytes.subarray(startHtml, startFragment).toString("utf8") + bytes.subarray(endFragment, endHtml).toString("utf8"),
	"<html><body><!--StartFragment--><!--EndFragment--></body></html>");

const withSource = buildClipboardHtml("甲", "file:///D:/笔记.md");
checkTrue("SourceURL 写进去了", withSource.includes("SourceURL:file:///D:/%E7%AC%94%E8%AE%B0.md\r\n"), withSource.slice(0, 200));
checkEqual("带 SourceURL 时偏移依然正确",
	Buffer.from(withSource, "utf8")
		.subarray(Number(/StartFragment:(\d+)/.exec(withSource)?.[1]), Number(/EndFragment:(\d+)/.exec(withSource)?.[1]))
		.toString("utf8"),
	"甲");
checkEqual("字节数 > 字符数（中文三字节）", utf8Length("图") > "图".length, true);

console.log("=== 拼一份混排内容 ===");
// 读图片字节的替身：不碰真文件
const fakePng = new Uint8Array([1, 2, 3, 4, 5, 6]);
const reader = async (path: string): Promise<Uint8Array> => {
	if (path.includes("坏的")) throw new Error("读不到");
	if (path.includes("大的")) return new Uint8Array(MAX_EMBED_BYTES + 1);
	return fakePng;
};

const selection = { text: "看这张 ![[图.png]] 好看", from: 100 };
const images = [{ path: "D:\\图.png", from: 104, to: 114 }];
const rich = await buildRichContent(selection, images, reader);
checkEqual("纯文本是选区原文", rich?.text, selection.text);
checkTrue("图片内嵌成 data URI（QQ 这类程序不许读本地文件）",
	rich?.html.includes(`看这张 <img src="data:image/png;base64,${Buffer.from(fakePng).toString("base64")}"> 好看`) === true,
	rich?.html ?? "null");
checkEqual("没有选区 → 不走混排", await buildRichContent(null, images, reader), null);
checkEqual("选区里只有图片 → 不走混排", await buildRichContent({ text: "![[图.png]]", from: 100 }, images, reader), null);
checkEqual("图片不在选区里 → 不走混排", await buildRichContent({ text: "只有文字", from: 200 }, images, reader), null);
checkEqual("图片被选区切了一半 → 不走混排", await buildRichContent({ text: "看这张 ![[图", from: 100 }, images, reader), null);

console.log("=== 图片内嵌与退回 ===");
checkEqual("png", mimeTypeOf("D:\\图.PNG"), "image/png");
checkEqual("jpeg", mimeTypeOf("a/b.jpeg"), "image/jpeg");
checkEqual("不认识的后缀 → 不内嵌", mimeTypeOf("D:\\说明.txt"), null);
checkEqual("没有后缀 → 不内嵌", mimeTypeOf("D:\\图"), null);
checkEqual("data URI 拼法", dataUriOf(new Uint8Array([1, 2]), "image/png"), "data:image/png;base64,AQI=");

const sources = await imageSourceMap([
	{ path: "D:\\好图.png", from: 0, to: 1 },
	{ path: "D:\\好的.txt", from: 0, to: 1 },
	{ path: "D:\\坏的.png", from: 0, to: 1 },
	{ path: "D:\\大的.png", from: 0, to: 1 },
], reader);
checkTrue("读得到就内嵌", sources.get("D:\\好图.png")?.startsWith("data:image/png;base64,") === true, sources.get("D:\\好图.png") ?? "");
checkEqual("后缀不认识就退回 file:///", sources.get("D:\\好的.txt"), "file:///D:/好的.txt");
checkEqual("读不到就退回 file:///（总比整条复制失败强）", sources.get("D:\\坏的.png"), "file:///D:/坏的.png");
checkEqual("太大就退回 file:///", sources.get("D:\\大的.png"), "file:///D:/大的.png");
checkEqual("每张图只在表里出现一次", sources.size, 4);
checkEqual("同一个路径问两次不重复读", (await imageSourceMap([
	{ path: "D:\\好图.png", from: 0, to: 1 },
	{ path: "D:\\好图.png", from: 5, to: 6 },
], reader)).size, 1);
checkEqual("总上限兜住（超了后面那张退回 file:///）",
	(await imageSourceMap([
		{ path: "D:\\一.png", from: 0, to: 1 },
		{ path: "D:\\二.png", from: 0, to: 1 },
	], async () => new Uint8Array(MAX_EMBED_TOTAL_BYTES / 2 + 1)))?.get("D:\\二.png"),
	"file:///D:/二.png");

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
