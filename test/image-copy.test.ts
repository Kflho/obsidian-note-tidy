/**
 * 复制图片：把引用解析成磁盘文件（`src/image/copy.ts`）测试
 *
 * 运行：npm test
 *
 * 重点保证：
 *   1. 仓库内链接能解析出绝对路径（FileSystemAdapter 的 getFullPath，或老的 getBasePath）
 *   2. **同名不猜**：全库两张同名图、原生解析又失败时跳过，绝不复制错的那张
 *   3. 同一张图出现两次只放一份（否则粘到文件夹里会多出一个「图 2.png」）
 *   4. `/开头` 的链接是"仓库根目录"，不能当成磁盘路径去扫整个盘
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import {
	absolutePathOf,
	baseNameOf,
	basePathOf,
	isExternalTarget,
	resolveImageFiles,
	vaultPathFromResourceUrl,
} from "../src/image/copy";
import type { ImageRef } from "../src/image/scan";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

// ---------------------------------------------------------------- 假仓库
function mkFile(path: string): TFile {
	const file = new TFile();
	const slash = path.lastIndexOf("/");
	file.path = path;
	file.name = slash >= 0 ? path.substring(slash + 1) : path;
	file.extension = file.name.split(".").pop() ?? "";
	return file;
}

interface FakeAppOptions {
	files: string[];
	/** 传给 metadataCache.getFirstLinkpathDest 的映射：链接目标 → 文件路径 */
	native?: Record<string, string>;
	adapter?: Record<string, unknown>;
}

function makeApp(options: FakeAppOptions): App {
	const files = options.files.map(mkFile);
	const byPath = new Map(files.map(file => [file.path, file]));

	return {
		vault: {
			getFiles: () => files,
			getAbstractFileByPath: (p: string) => byPath.get(p) ?? null,
			adapter: options.adapter ?? {},
		},
		metadataCache: {
			getFirstLinkpathDest: (link: string) => {
				const target = options.native?.[link];
				return target ? byPath.get(target) ?? null : null;
			},
		},
	} as unknown as App;
}

/** 造一条 ImageRef（from / to 是它在原文里的位置：混排复制按它把图放回文字中间） */
function ref(target: string, kind: ImageRef["kind"] = "wiki", from = 0, to = 0): ImageRef {
	return { target, kind, from, to };
}

const GET_FULL_PATH = { getFullPath: (p: string) => `D:\\vault\\${p.replace(/\//g, "\\")}` };
const GET_BASE_PATH = { getBasePath: () => "D:\\vault\\" };

// ------------------------------------------------------------ 1. 纯函数
function pureTests(): void {
	checkEqual("盘符路径算外部", isExternalTarget("D:\\图.png"), true);
	checkEqual("盘符路径（正斜杠）算外部", isExternalTarget("D:/图.png"), true);
	checkEqual("file:// 算外部", isExternalTarget("file:///D:/图.png"), true);
	checkEqual("UNC 算外部", isExternalTarget("\\\\server\\share\\图.png"), true);
	checkEqual("/开头是仓库根目录，不算外部", isExternalTarget("/附件/图.png"), false);
	checkEqual("相对路径不算外部", isExternalTarget("附件/图.png"), false);

	checkEqual("取文件名（/）", baseNameOf("a/b/图.png"), "图.png");
	checkEqual("取文件名（\\）", baseNameOf("D:\\图片\\图.png"), "图.png");
	checkEqual("没有分隔符就是自己", baseNameOf("图.png"), "图.png");

	// 资源 URL → 仓库路径（阅读模式里 <img> 只有这个 src）
	checkEqual("Windows 资源 URL", vaultPathFromResourceUrl("app://local/D:/仓库/附件/%E5%9B%BE.png?1699", "D:\\仓库"), "附件/图.png");
	checkEqual("macOS / Linux 资源 URL", vaultPathFromResourceUrl("app://local/Users/me/vault/a%20b.png", "/Users/me/vault"), "a b.png");
	checkEqual("file:// 写法", vaultPathFromResourceUrl("file:///D:/仓库/图.png", "D:\\仓库"), "图.png");
	checkEqual("不在仓库里 → null", vaultPathFromResourceUrl("app://local/C:/别处/图.png", "D:\\仓库"), null);
	checkEqual("外链图 → null", vaultPathFromResourceUrl("https://example.com/a.png", "D:\\仓库"), null);
	checkEqual("不是 URL → null", vaultPathFromResourceUrl("附件/图.png", "D:\\仓库"), null);
	checkEqual("没有 basePath → null", vaultPathFromResourceUrl("app://local/D:/仓库/图.png", ""), null);
	// 前缀相同但不是一个仓库（`D:/仓库2` 不该被认成 `D:/仓库` 里的文件）
	checkEqual("只认整段路径", vaultPathFromResourceUrl("app://local/D:/仓库2/图.png", "D:\\仓库"), null);
}

// ------------------------------------------------------- 2. 绝对路径
function absolutePathTests(): void {
	const full = makeApp({ files: ["附件/图.png"], adapter: GET_FULL_PATH });
	checkEqual("getFullPath 优先", absolutePathOf(full, mkFile("附件/图.png")), "D:\\vault\\附件\\图.png");

	const base = makeApp({ files: ["附件/图.png"], adapter: GET_BASE_PATH });
	checkEqual("没有 getFullPath 就拼 getBasePath（去掉尾部斜杠）", absolutePathOf(base, mkFile("附件/图.png")), "D:\\vault/附件/图.png");
	checkEqual("basePath 也能单独取", basePathOf(base), "D:\\vault\\");

	const none = makeApp({ files: ["附件/图.png"] });
	checkEqual("适配器都不提供时返回 null", absolutePathOf(none, mkFile("附件/图.png")), null);
	checkEqual("适配器都没有 basePath", basePathOf(none), null);
}

// ------------------------------------------------------- 3. 解析清单
async function resolveTests(): Promise<void> {
	const app = makeApp({
		files: ["附件/图.png", "附件/另一张.jpg", "笔记.md"],
		native: { "图.png": "附件/图.png", "另一张.jpg": "附件/另一张.jpg" },
		adapter: GET_FULL_PATH,
	});

	const one = await resolveImageFiles(app, "笔记.md", [ref("图.png")]);
	checkEqual("解析出绝对路径", one, [{ name: "图.png", path: "D:\\vault\\附件\\图.png", from: 0, to: 0 }]);
	checkEqual("引用在原文里的位置原样带出来（混排复制要用）",
		(await resolveImageFiles(app, "笔记.md", [ref("图.png", "wiki", 20, 30)]))[0],
		{ name: "图.png", path: "D:\\vault\\附件\\图.png", from: 20, to: 30 });

	const two = await resolveImageFiles(app, "笔记.md", [ref("图.png"), ref("另一张.jpg", "markdown")]);
	checkEqual("多张按出现顺序", two.map(image => image.name), ["图.png", "另一张.jpg"]);

	const dup = await resolveImageFiles(app, "笔记.md", [ref("图.png"), ref("图.png")]);
	checkEqual("同一张出现两次只放一份", dup.length, 1);

	// 同名歧义：原生解析失败、全库两张同名 → 跳过，不猜
	const ambiguous = makeApp({
		files: ["a/图.png", "b/图.png"],
		adapter: GET_FULL_PATH,
	});
	checkEqual("同名歧义跳过", await resolveImageFiles(ambiguous, "笔记.md", [ref("图.png")]), []);

	// 只有一张同名时，即使原生解析失败也认（links.ts 的规矩）
	const sole = makeApp({ files: ["a/图.png"], adapter: GET_FULL_PATH });
	checkEqual("唯一同名可用", (await resolveImageFiles(sole, "笔记.md", [ref("图.png")])).length, 1);

	// 解析不到 / 不是图片的文件
	const missing = await resolveImageFiles(app, "笔记.md", [ref("不存在.png")]);
	checkEqual("找不到的跳过", missing, []);

	// 外部绝对路径：用不存在的盘符，确认它是"找得到才收"而不是原样塞进去
	const external = await resolveImageFiles(app, "笔记.md", [ref("V:\\没有这张图.png", "markdown")]);
	checkEqual("外部路径找不到就跳过", external, []);
}

// -------------------------------------------------------------------- 运行
console.log("=== 纯函数 ===");
pureTests();
console.log("=== 绝对路径 ===");
absolutePathTests();
console.log("=== 解析清单 ===");
await resolveTests();

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
