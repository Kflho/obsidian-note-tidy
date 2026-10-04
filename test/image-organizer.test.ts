/**
 * 图片整理 / 链接解析测试
 *
 * 运行：npm test
 *
 * 重点覆盖本次修复的两个隐患：
 *   1. 同名图片歧义 —— 无法确定指向哪一张时必须跳过，绝不能猜
 *   2. 链接形式 —— 文件名不唯一时不能写裸文件名，否则会显示成另一张同名图
 *
 * 另有一条与清理误删同源的规矩：表格里的链接写的是 `![[图.png\|200]]`
 * （GFM 要求转义竖线），认链接时要还原，改写时那根反斜杠要原样带回去。
 */
import { TFile, TFolder } from "obsidian";
import { buildCopyName, chooseLinkTarget, isImagePath, linkBasename, reseatInBasenameIndex, resolveImageLink } from "../src/image/links";
import { organizeNoteImages } from "../src/image/organize";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (actual !== expected) {
		failures.push(`[数值不符] ${name}\n  期望 ${String(expected)}\n  实际 ${String(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail = ""): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

// ---------------------------------------------------------------- 假 vault
interface FakeFile {
	file: TFile;
	data: Uint8Array;
}

function mkFile(path: string, data = "x"): TFile {
	const file = new TFile();
	const slash = path.lastIndexOf("/");
	file.path = path;
	file.name = slash >= 0 ? path.substring(slash + 1) : path;
	file.extension = file.name.split(".").pop() ?? "";
	file.stat = { ctime: 0, mtime: 0, size: data.length };
	// Obsidian 里 parent 由 vault 维护，这里补上，附件夹解析要用
	const dir = slash >= 0 ? path.substring(0, slash) : "/";
	file.parent = mkFolder(dir, []);
	return file;
}

function mkFolder(path: string, files: TFile[]): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path === "/" ? "/" : (path.split("/").pop() ?? path);
	folder.children = files;
	return folder;
}

function bytes(s: string): Uint8Array {
	return new TextEncoder().encode(s);
}

class FakeVault {
	files = new Map<string, FakeFile>();
	folders = new Map<string, TFolder>();
	notices: string[] = [];

	addFile(path: string, content: string): TFile {
		const data = bytes(content);
		const file = mkFile(path, content);
		this.files.set(path, { file, data });
		this.refreshFolders();
		return file;
	}

	refreshFolders(): void {
		this.folders.clear();
		const root = mkFolder("/", []);
		this.folders.set("/", root);
		for (const { file } of this.files.values()) {
			const parent = file.path.includes("/") ? file.path.substring(0, file.path.lastIndexOf("/")) : "/";
			if (!this.folders.has(parent)) {
				const parts = parent.split("/");
				let current = "";
				for (const part of parts) {
					current = current === "" ? part : `${current}/${part}`;
					if (!this.folders.has(current)) this.folders.set(current, mkFolder(current, []));
				}
			}
			const parentFolder = this.folders.get(parent);
			if (parentFolder) parentFolder.children.push(file);
		}
	}
}

function makeApp(vault: FakeVault, tree: Record<string, string>) {
	return {
		vault: {
			getFiles: () => [...vault.files.values()].map(f => f.file),
			getRoot: () => vault.folders.get("/") ?? mkFolder("/", []),
			getAbstractFileByPath: (p: string) => vault.files.get(p)?.file ?? vault.folders.get(p) ?? null,
			createFolder: async (p: string) => {
				vault.folders.set(p, mkFolder(p, []));
			},
			read: async (f: TFile) => tree[f.path] ?? "",
			modify: async (f: TFile, c: string) => { tree[f.path] = c; },
			readBinary: async (f: TFile) => vault.files.get(f.path)?.data.buffer ?? new ArrayBuffer(0),
			createBinary: async (p: string, data: ArrayBuffer) => {
				const file = mkFile(p, "y");
				vault.files.set(p, { file, data: new Uint8Array(data) });
				tree[p] = "";
				vault.refreshFolders();
				return file;
			},
		},
		metadataCache: { getFirstLinkpathDest: () => null },
		// 模拟 Obsidian 的 renameFile：文件真的换位置，并且 **原地** 更新那个 TFile
		// （path / name / parent 都会变）—— 索引里存的就是这个对象，搬家后仍然有效
		fileManager: {
			renameFile: async (file: TFile, newPath: string) => {
				const entry = vault.files.get(file.path);
				if (!entry) throw new Error(`找不到 ${file.path}`);
				const oldPath = file.path;
				vault.files.delete(oldPath);
				const slash = newPath.lastIndexOf("/");
				file.path = newPath;
				file.name = slash >= 0 ? newPath.substring(slash + 1) : newPath;
				file.extension = file.name.split(".").pop() ?? "";
				file.parent = mkFolder(slash >= 0 ? newPath.substring(0, slash) : "/", []);
				vault.files.set(newPath, { file, data: entry.data });
				const previous = tree[oldPath];
				if (previous !== undefined) {
					tree[newPath] = previous;
					delete tree[oldPath];
				}
				vault.refreshFolders();
			},
		},
	};
}

/** 构造「索引」：与 buildBasenameIndex 等价 */
function indexOf(app: { vault: { getFiles: () => TFile[] } }): Map<string, TFile[]> {
	const index = new Map<string, TFile[]>();
	for (const file of app.vault.getFiles()) {
		const key = file.name.toLowerCase();
		const list = index.get(key);
		if (list) list.push(file);
		else index.set(key, [file]);
	}
	return index;
}

const SETTINGS = { attachmentLocation: "subfolder", customAttachmentFolder: "attachments", renameLinkFormat: "filename" };

// ------------------------------------------------------------ 1. 纯函数
function pureTests(): void {
	checkEqual("图片扩展名", isImagePath("a.PNG"), true);
	checkEqual("非图片", isImagePath("a.md"), false);
	checkEqual("带片段仍算图片", isImagePath("a.png#outline"), true);
	checkEqual("取文件名", linkBasename("attachments/图.png"), "图.png");
	checkEqual("取文件名（忽略片段）", linkBasename("attachments/图.png#outline"), "图.png");

	// 唯一 → 文件名；重复 → 完整路径；full 模式 → 始终路径
	const unique = new Map([["图.png", [mkFile("a/图.png")]]]);
	const dup = new Map([["图.png", [mkFile("a/图.png"), mkFile("b/图.png")]]]);
	checkEqual("唯一时写文件名", chooseLinkTarget({ name: "图.png", path: "a/图.png" }, unique, "filename"), "图.png");
	checkEqual("同名时强制完整路径", chooseLinkTarget({ name: "图.png", path: "b/图.png" }, dup, "filename"), "b/图.png");
	checkEqual("full 模式始终完整路径", chooseLinkTarget({ name: "图.png", path: "a/图.png" }, unique, "full"), "a/图.png");

	// 重名时的复制命名
	const taken = new Set(["图.png", "图 2.png"]);
	checkEqual("不冲突时用原名", buildCopyName(new Set(), "图.png"), "图.png");
	checkEqual("冲突时加序号", buildCopyName(taken, "图.png"), "图 3.png");
	checkEqual("无扩展名也安全", buildCopyName(new Set(["a"]), "a"), "a 2");

	// 搬家（可能还改了名）后在索引里重新登记：旧名字下不能留下名字已经不对的登记
	const movedIndex = new Map([["图.png", [mkFile("a/图.png")]]]);
	reseatInBasenameIndex(movedIndex, "a/图.png", mkFile("b/图.png"));
	checkEqual("搬家后旧名字下只剩一张", movedIndex.get("图.png")?.length, 1);
	checkEqual("搬家后索引指向新路径", movedIndex.get("图.png")?.[0]?.path, "b/图.png");

	const renamedIndex = new Map([["图.png", [mkFile("a/图.png")]]]);
	reseatInBasenameIndex(renamedIndex, "a/图.png", mkFile("b/图 2.png"));
	checkEqual("改名后旧名字下没有登记", renamedIndex.get("图.png"), undefined);
	checkEqual("改名后登记在新名字下", renamedIndex.get("图 2.png")?.length, 1);
}

// ------------------------------------------------------- 2. 歧义解析
function resolveTests(): void {
	const vault = new FakeVault();
	const a = vault.addFile("a/图.png", "A");
	vault.addFile("b/图.png", "B");
	const tree: Record<string, string> = {};
	const app = makeApp(vault, tree);
	const index = indexOf(app);

	// 原生解析失败 + 同名两张 → 必须返回 null（不能猜）
	const ambiguous = resolveImageLink(app as never, "note.md", "图.png", index);
	checkEqual("同名时不给结果", ambiguous.file, null);
	checkEqual("同名时标记歧义", ambiguous.ambiguous, true);

	// 唯一同名 → 可以解析
	const vault2 = new FakeVault();
	const only = vault2.addFile("a/唯一.png", "A");
	const app2 = makeApp(vault2, {});
	const unique = resolveImageLink(app2 as never, "note.md", "唯一.png", indexOf(app2));
	checkEqual("唯一同名可解析", unique.file?.path, only.path);
	checkEqual("唯一同名不标歧义", unique.ambiguous, false);

	// 找到的图片确实存在
	checkTrue("解析结果有路径", typeof a.path === "string", a.path);
}

// ------------------------------------------------------ 3. 图片整理
async function organizeTests(): Promise<void> {
	// 场景 A：图片在别处 → 复制进本地 attachments 并改写链接
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "IMAGE-A");
		const note = vault.addFile("folderB/note.md", "![[图.png]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[图.png]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("A 复制了 1 张", result.copied, 1);
		checkEqual("A 没搬（不传统计函数 = 老行为，只复制）", result.moved, 0);
		checkEqual("A 内容有变化", result.changed, true);
		checkTrue("A 本地出现了副本", vault.files.has("folderB/attachments/图.png"));
		checkTrue("A 源文件仍留在原处", vault.files.has("folderA/attachments/图.png"));
		checkTrue("A 链接改为完整路径", result.content.includes("![[folderB/attachments/图.png]]"), result.content);
		checkTrue("A 副本内容一致", new TextDecoder().decode(vault.files.get("folderB/attachments/图.png")?.data) === "IMAGE-A", "内容不一致");

		// 幂等：再跑一次不应再有改动
		tree["folderB/note.md"] = result.content;
		const again = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("A 复跑无改动", again.changed, false);
		checkEqual("A 复跑不重复复制", again.copied, 0);
	}

	// 场景 B：本地已有同内容副本 → 只改链接，不复制
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "SAME");
		vault.addFile("folderB/attachments/图.png", "SAME");
		const note = vault.addFile("folderB/note.md", "![[folderA/attachments/图.png]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[folderA/attachments/图.png]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("B 未复制", result.copied, 0);
		checkEqual("B 只改写链接", result.relinked, 1);
		checkTrue("B 链接指向本地", result.content.includes("![[folderB/attachments/图.png]]"), result.content);
	}

	// 场景 C：本地同名但内容不同 → 复制成新名字，不覆盖
	{
		const vault = new FakeVault();
		vault.addFile("folderA/图.png", "AAA");
		vault.addFile("folderB/attachments/图.png", "BBB");
		const note = vault.addFile("folderB/note.md", "![[folderA/图.png]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[folderA/图.png]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("C 复制了 1 张", result.copied, 1);
		checkTrue("C 生成了新名字", vault.files.has("folderB/attachments/图 2.png"), [...vault.files.keys()].join(","));
		checkTrue("C 原文件未被覆盖", new TextDecoder().decode(vault.files.get("folderB/attachments/图.png")?.data) === "BBB", "被覆盖了");
		// 新名字在全库唯一 → 写裸文件名即可（无歧义且更简洁）
		checkTrue("C 链接指向新副本", result.content.includes("![[图 2.png]]"), result.content);
		// 同名的那张仍存在，所以旧名字不能再用裸文件名指向
		checkTrue("C 未把链接写成有歧义的旧名字", !result.content.includes("![[图.png]]"), result.content);
	}

	// 场景 D：同名歧义 → 跳过并给出原因
	{
		const vault = new FakeVault();
		vault.addFile("a/图.png", "A");
		vault.addFile("b/图.png", "B");
		const note = vault.addFile("c/note.md", "![[图.png]]\n");
		const tree: Record<string, string> = { "c/note.md": "![[图.png]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("D 无改动", result.changed, false);
		checkEqual("D 跳过 1 处", result.skipped, 1);
		checkTrue("D 给出歧义原因", result.reasons.join().includes("同名"), result.reasons.join());
	}

	// 场景 E：图片已经在本地附件夹 → 完全不动
	{
		const vault = new FakeVault();
		vault.addFile("note/attachments/图.png", "A");
		const note = vault.addFile("note/a.md", "![[图.png]]\n");
		const tree: Record<string, string> = { "note/a.md": "![[图.png]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("E 无改动", result.changed, false);
		checkEqual("E 未复制", result.copied, 0);
	}

	// 场景 F：保留别名与片段
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "A");
		const note = vault.addFile("folderB/note.md", "![[folderA/attachments/图.png#outline|200]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[folderA/attachments/图.png#outline|200]]\n" };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkTrue("F 保留片段", result.content.includes("#outline"), result.content);
		checkTrue("F 保留别名", result.content.includes("|200]]"), result.content);
		checkTrue("F 指向本地副本", result.content.includes("folderB/attachments/图.png#outline|200"), result.content);
	}
	// 场景 G：表格里的链接（竖线要写成 `\|`）→ 一样认得出、一样搬运，转义不能丢
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "A");
		const table = "| 图 |\n| --- |\n| ![[folderA/attachments/图.png\\|200]] |\n";
		const note = vault.addFile("folderB/note.md", table);
		const tree: Record<string, string> = { "folderB/note.md": table };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app));
		checkEqual("G 复制了 1 张", result.copied, 1);
		checkTrue("G 指向本地副本", result.content.includes("folderB/attachments/图.png"), result.content);
		checkTrue("G 别名前的转义竖线原样保留", result.content.includes("\\|200]]"), result.content);
		checkTrue("G 表格结构没被破坏", result.content.split("\n").slice(0, 3).every(line => line.startsWith("|")), result.content);
	}

	// 场景 H：没有别的笔记在用 → 直接搬（旧文件夹不留副本）
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "IMAGE-A");
		const note = vault.addFile("folderB/note.md", "![[folderA/attachments/图.png]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[folderA/attachments/图.png]]\n" };
		const app = makeApp(vault, tree);
		// 全库只有这一篇笔记引用它
		const countUsages = async (): Promise<number> => 1;

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app), { countUsages });
		checkEqual("H 搬了 1 张", result.moved, 1);
		checkEqual("H 没有复制", result.copied, 0);
		checkTrue("H 源文件已经不在原处", !vault.files.has("folderA/attachments/图.png"), [...vault.files.keys()].join(","));
		checkTrue("H 出现在本地附件夹", vault.files.has("folderB/attachments/图.png"));
		checkTrue("H 内容没变", new TextDecoder().decode(vault.files.get("folderB/attachments/图.png")?.data) === "IMAGE-A", "内容不一致");
		checkTrue("H 链接指向搬过来的那张", result.content.includes("![[图.png]]"), result.content);

		// 幂等：再跑一次不应再有改动（图片已经在本地附件夹里了）
		tree["folderB/note.md"] = result.content;
		const again = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app), { countUsages });
		checkEqual("H 复跑无改动", again.changed, false);
		checkEqual("H 复跑不再搬", again.moved, 0);
	}

	// 场景 I：别的笔记还在用 → 只能复制（源文件留下来给那篇笔记）
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "IMAGE-A");
		const note = vault.addFile("folderB/note.md", "![[folderA/attachments/图.png]]\n");
		const tree: Record<string, string> = { "folderB/note.md": "![[folderA/attachments/图.png]]\n" };
		const app = makeApp(vault, tree);
		// 全库有两篇文档引用它：本笔记 + 另一篇
		const countUsages = async (): Promise<number> => 2;

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app), { countUsages });
		checkEqual("I 复制了 1 张", result.copied, 1);
		checkEqual("I 没搬", result.moved, 0);
		checkTrue("I 源文件还在（另一篇笔记要用）", vault.files.has("folderA/attachments/图.png"));
		checkTrue("I 本地也有一份", vault.files.has("folderB/attachments/图.png"));
	}

	// 场景 J：同一张图被这篇笔记引用两次 → 只搬一次，两处链接都要改写对
	{
		const vault = new FakeVault();
		vault.addFile("folderA/attachments/图.png", "A");
		const body = "![[folderA/attachments/图.png]]\n![[folderA/attachments/图.png|200]]\n";
		const note = vault.addFile("folderB/note.md", body);
		const tree: Record<string, string> = { "folderB/note.md": body };
		const app = makeApp(vault, tree);

		const result = await organizeNoteImages(app as never, SETTINGS, note, indexOf(app), { countUsages: async () => 1 });
		checkEqual("J 只搬一次", result.moved, 1);
		checkEqual("J 一处都没跳过", result.skipped, 0);
		checkEqual("J 两处链接都指向搬过来的那张", (result.content.match(/!\[\[图\.png/g) ?? []).length, 2);
		checkTrue("J 没留下老路径", !result.content.includes("folderA/attachments"), result.content);
		checkTrue("J 别名保留", result.content.includes("![[图.png|200]]"), result.content);
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 链接工具纯函数 ===");
pureTests();

console.log("=== 2. 同名歧义解析 ===");
resolveTests();

console.log("=== 3. 图片位置整理 ===");
await organizeTests();

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
