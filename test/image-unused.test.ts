/**
 * 清理没人引用的图片附件（`src/image/unused.ts`）
 *
 * 运行：npm test
 *
 * 盯三件事：
 *   1. 认引用：`![[图]]`、`[[图]]`、`![](路径/图)`、canvas 的 `"file"` 都算；`#片段` 不算名字的一部分
 *   2. 比名字：不区分大小写、只比文件名（`attachments/图.png` 与 `图.png` 是同一张）
 *   3. 保守：非图片的双链（笔记、pdf）不算图片引用；不在清单里的文件不会被动
 */
import { isImageFileName, selectUnusedImages } from "../src/image/unused";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

/** 造一批图片文件（只看 name） */
function images(...names: string[]): Array<{ name: string }> {
	return names.map(name => ({ name }));
}

function unusedIn(texts: string[], ...names: string[]): string[] {
	return selectUnusedImages(images(...names), texts).map(file => file.name);
}

// ------------------------------------------------------------ 1. 哪些写法算引用
function referenceTests(): void {
	check("双链嵌入算引用", unusedIn(['![[a.png]]'], 'a.png', 'b.png'), ['b.png']);
	check("普通双链也算（有些插件用 [[]]）", unusedIn(['[[a.png]]'], 'a.png', 'b.png'), ['b.png']);
	check("Markdown 图片算引用", unusedIn(['![](attachments/a.png)'], 'a.png', 'b.png'), ['b.png']);
	check("canvas 的 file 字段算引用",
		unusedIn(['{ "file": "att/a.png" }'], 'a.png', 'b.png'), ['b.png']);
	check("带尺寸别名的双链算引用", unusedIn(['![[a.png|100]]'], 'a.png'), []);
	check("带 #片段 的双链算引用（片段不算名字）", unusedIn(['![[a.png#outline]]'], 'a.png'), []);
	check("大小写不敏感", unusedIn(['![[A.PNG]]'], 'a.png'), []);
	check("引用写全路径也认（只比文件名）", unusedIn(['![[x/y/a.png]]'], 'a.png'), []);
	check("URL 编码的路径认得出（%20）", unusedIn(['![](att/a%20b.png)'], 'a b.png'), []);

	check("多个文件里任意一处提到就算引用",
		unusedIn(['![[c.png]]', '![[a.png]]'], 'a.png', 'b.png', 'c.png'), ['b.png']);

	check("没被提过的才算没人引用", unusedIn(['![[a.png]]'], 'a.png', 'b.png', 'c.png'), ['b.png', 'c.png']);
	check("一篇都没提时全算没人引用", unusedIn([], 'a.png', 'b.png'), ['a.png', 'b.png']);
}

// ------------------------------------------------------------ 2. 不该误伤的
function safetyTests(): void {
	check("别的文件的链接保护不了图片（`[[笔记.md]]` 与图片无关）",
		unusedIn(['[[笔记.md]]'], 'a.png'), ['a.png']);
	check("pdf 的链接也不算图片引用（而且 pdf 根本不在图片清单里）",
		unusedIn(['![[a.pdf]]'], 'a.png'), ['a.png']);
	check("正文里只是提到名字，不算引用（要的是链接写法）",
		unusedIn(['这里说了 a.png 这个词'], 'a.png'), ['a.png']);
	check("图片扩展名清单：png/jpg/gif/bmp/webp/heic/avif/svg 都算",
		['a.png', 'b.jpg', 'c.jpeg', 'd.gif', 'e.bmp', 'f.webp', 'g.heic', 'h.avif', 'i.svg']
			.map(name => [name, isImageFileName(name)] as const),
		[['a.png', true], ['b.jpg', true], ['c.jpeg', true], ['d.gif', true], ['e.bmp', true], ['f.webp', true], ['g.heic', true], ['h.avif', true], ['i.svg', true]]);
	check("非图片不归它管", ['a.pdf', 'b.md', 'c.canvas', 'd.mp3'].map(isImageFileName), [false, false, false, false]);
}

// ------------------------------------------------------------ 3. 顺序与可复现
function orderTests(): void {
	check("返回顺序与传入一致（结果可复现）",
		unusedIn(['![[b.png]]'], 'a.png', 'b.png', 'c.png', 'd.png'), ['a.png', 'c.png', 'd.png']);
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 哪些写法算引用 ===");
referenceTests();

console.log("=== 2. 不该误伤的 ===");
safetyTests();

console.log("=== 3. 顺序 ===");
orderTests();

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
