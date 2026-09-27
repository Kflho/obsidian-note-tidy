/**
 * 「整理图片」= 转换图片格式 + 合并重复副本 + 清理没人引用的附件
 * （`ImageTasks.tidyImages`，见 src/tasks.ts 的 ① ② ③ ④）
 *
 * 运行：npm test
 *
 * 这里跑**真实任务**：插件真的 onload 一遍，vault、Image Converter、Clear Unused Images
 * 全是替身，守四条：
 *
 *   1. 固定顺序 改写引用 → 删副本 → 转换格式 → Clear Unused Images；
 *   2. **马上要被合并掉的副本不进转换清单** —— 它第 ② 步就进回收站了，再拿去读盘
 *      只会记一次"失败"，把结果提示里的数字弄脏；
 *   3. 动图（gif）与已经是目标格式的图片一律不转（`shouldConvertFile` 的硬规矩）；
 *   4. 没装 Image Converter / 关掉「整理时转换图片格式」时，合并与清理照常执行，
 *      只是跳过转换那一步（并在结果提示里说一句为什么）。
 */
import { Notice, TFile } from "obsidian";
import type { App, PluginManifest } from "obsidian";
import ImageTransferPlugin from "../src/main";
import { CLEAR_UNUSED_IMAGES_COMMAND } from "../src/image/dedupe";
import type { ImageTransferSettings } from "../src/settings/model";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

/** 替身 Notice 记录的提示消息（真实 Notice 没有这个字段） */
const noticeLog = Notice as unknown as { messages: string[] };

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n  ${detail}`);
}

function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

// ---------------------------------------------------------------- 替身
/** 假图片：内容只用来判"一样不一样"，不解码 */
function imageBytes(fill: number, length: number): Uint8Array {
	const out = new Uint8Array(length);
	out.fill(fill);
	return out;
}

/** 假 webp：`looksLikeFormat` 认的就是 RIFF…WEBP 这几个字节 */
function webpBytes(length = 32): Uint8Array {
	const out = new Uint8Array(length);
	out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
	out.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
	return out;
}

/** `NoticeSuppressor` / 状态栏进度用到的浏览器 API，在 Node 里补上最小替身 */
function installDomStubs(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	const classes = new Set<string>();
	globals.document = {
		body: {
			classList: {
				add: (name: string) => { classes.add(name); },
				remove: (name: string) => { classes.delete(name); },
				contains: (name: string) => classes.has(name),
			},
		},
		querySelectorAll: (): unknown[] => [],
	};
	// 定时器立即执行：进度那 5 秒的收尾不用真等，也不留悬挂的定时器
	globals.window = {
		setTimeout: (fn: () => void) => { fn(); return 0; },
		clearTimeout: () => undefined,
		innerWidth: 100,
		innerHeight: 100,
	};
	globals.MutationObserver = class {
		observe(): void { /* 不观察 */ }
		disconnect(): void { /* 无需断开 */ }
	};
}

interface StubOptions {
	/** 有没有装 Image Converter（默认装了） */
	converter?: boolean;
	/** 覆盖默认设置 */
	settings?: Partial<ImageTransferSettings>;
}

interface TidyStub {
	/** 仓库里还剩哪些图片（路径 → 字节） */
	images: Map<string, Uint8Array>;
	/** 笔记内容 */
	notes: Map<string, string>;
	/** 交给转码器的图片字节数（按调用顺序） */
	convertedSizes: number[];
	/** 执行过的命令 ID */
	commands: string[];
	tasks: { tidyImages: (confirm?: boolean) => Promise<void> };
}

/**
 * 造一个测试仓库：
 *
 * ```
 * 笔记.md      ![[a.png]] ![[b.png]] ![[d.png]]
 * img/a.png    内容 X  ┐ 同一文件夹、逐字节相同 → 该合并（留名字小的 a.png）
 * img/b.png    内容 X  ┘
 * img/c.webp   已经是目标格式 → 不转
 * img/d.png    独一份 → 该转
 * img/e.gif    动图 → 一律不转
 * ```
 */
async function createStub(options: StubOptions = {}): Promise<TidyStub> {
	installDomStubs();
	noticeLog.messages.length = 0;

	const notes = new Map<string, string>([
		["笔记.md", "![[a.png]]\n![[b.png]]\n![[d.png]]\n"],
	]);
	const images = new Map<string, Uint8Array>([
		["img/a.png", imageBytes(0x11, 64)],
		["img/b.png", imageBytes(0x11, 64)],
		["img/c.webp", webpBytes(48)],
		["img/d.png", imageBytes(0x22, 40)],
		["img/e.gif", imageBytes(0x33, 24)],
	]);
	const convertedSizes: number[] = [];
	const commands: string[] = [];

	const files = new Map<string, TFile>();
	const register = (path: string, size: number): TFile => {
		const slash = path.lastIndexOf("/");
		const name = path.slice(slash + 1);
		const file = Object.assign(new TFile(), {
			path,
			name,
			extension: name.slice(name.lastIndexOf(".") + 1),
			parent: { path: slash > 0 ? path.slice(0, slash) : "" },
			stat: { size },
		});
		files.set(path, file);
		return file;
	};

	for (const [path, data] of images) register(path, data.byteLength);
	const noteFiles: TFile[] = [];
	for (const path of notes.keys()) noteFiles.push(register(path, 0));

	/** Image Converter 的替身：只实现我们借用的那两个字段 */
	const converter = options.converter === false ? undefined : {
		settings: {
			conversionPresets: [
				{ name: "webp", outputFormat: "WEBP", quality: 80, revertToOriginalIfLarger: false },
			],
			selectedConversionPreset: "webp",
		},
		imageProcessor: {
			processImage: async (blob: Blob): Promise<ArrayBuffer> => {
				convertedSizes.push(blob.size);
				return webpBytes(64).buffer;
			},
		},
	};

	const app = {
		vault: {
			getFiles: (): TFile[] => [...files.values()],
			getMarkdownFiles: (): TFile[] => noteFiles,
			getAbstractFileByPath: (path: string): TFile | null => files.get(path) ?? null,
			read: async (file: TFile): Promise<string> => notes.get(file.path) ?? "",
			modify: async (file: TFile, data: string): Promise<void> => { notes.set(file.path, data); },
			readBinary: async (file: TFile): Promise<ArrayBuffer> => {
				const data = images.get(file.path);
				// 已经被删掉的文件再读就报错 —— 转换清单要是没排掉"马上被合并的副本"，这里会炸
				if (!data) throw new Error(`找不到 ${file.path}`);
				return data.slice().buffer;
			},
			modifyBinary: async (file: TFile, data: ArrayBuffer): Promise<void> => {
				images.set(file.path, new Uint8Array(data));
				file.stat.size = data.byteLength;
			},
			createBinary: async (): Promise<unknown> => ({}),
			on: (event: string) => ({ event }),
		},
		fileManager: {
			/** 改名：真 Obsidian 会连带改写全库链接，替身照做（否则"链接跟着改名走"就名存实亡） */
			renameFile: async (file: TFile, newPath: string): Promise<void> => {
				const oldName = file.name;
				const data = images.get(file.path);
				images.delete(file.path);
				files.delete(file.path);
				const slash = newPath.lastIndexOf("/");
				file.path = newPath;
				file.name = newPath.slice(slash + 1);
				file.extension = file.name.slice(file.name.lastIndexOf(".") + 1);
				file.parent = { path: slash > 0 ? newPath.slice(0, slash) : "" } as unknown as TFile["parent"];
				if (data) images.set(newPath, data);
				files.set(newPath, file);
				for (const [path, text] of notes) {
					if (text.includes(oldName)) notes.set(path, text.split(oldName).join(file.name));
				}
			},
			trashFile: async (file: TFile): Promise<void> => {
				images.delete(file.path);
				files.delete(file.path);
			},
		},
		// Clear Unused Images（oz-clear-unused-images）的替身：记下被调用的命令，当作"装了"
		commands: {
			executeCommandById: (id: string): boolean => { commands.push(id); return true; },
		},
		plugins: { plugins: converter ? { "image-converter": converter } : {} },
		workspace: { on: (event: string) => ({ event }) },
	} as unknown as App;

	const manifest = { id: "note-tidy", name: "test", version: "0.0.0" } as PluginManifest;
	const plugin = new ImageTransferPlugin(app, manifest);
	await plugin.onload();
	if (options.settings) Object.assign(plugin.settings, options.settings);

	const tasks = (plugin as unknown as {
		tasks: { tidyImages: (confirm?: boolean) => Promise<void> };
	}).tasks;

	return { images, notes, convertedSizes, commands, tasks };
}

/** 跑一次「整理图片」，返回结果提示（最后一条通知） */
async function tidy(stub: TidyStub, confirm = false): Promise<string> {
	await stub.tasks.tidyImages(confirm);
	return noticeLog.messages[noticeLog.messages.length - 1] ?? "";
}

// ------------------------------- 1. 装了 Image Converter：转换 + 合并 + 清理一次做完
async function withConverter(): Promise<void> {
	const stub = await createStub();
	const message = await tidy(stub);

	check("重复副本进了回收站", stub.images.has("img/b.png"), false);
	check("留下的那张转换成了目标格式", stub.images.has("img/a.webp"), true);
	check("独一份的图也转换了", stub.images.has("img/d.webp"), true);
	check("被合并掉的副本没有被转换（不该多出 b.webp）", stub.images.has("img/b.webp"), false);
	check("已经是目标格式的图片不动", stub.images.has("img/c.webp"), true);
	check("动图不转", stub.images.has("img/e.gif"), true);
	// 64 = a.png（b.png 与它同内容，已被合并），40 = d.png；顺序 = 仓库里 getFiles 的顺序
	check("转码器只收到该转的那两张", stub.convertedSizes, [64, 40]);
	check("笔记里的链接跟着合并与改名走", stub.notes.get("笔记.md"), "![[a.webp]]\n![[a.webp]]\n![[d.webp]]\n");
	check("清理没人引用的附件也执行了", stub.commands, [CLEAR_UNUSED_IMAGES_COMMAND]);
	checkTrue("结果提示把三件事都说清楚了",
		message.includes("合并掉 1 张重复图片")
		&& message.includes("把 2 张图片转换为 webp")
		&& message.includes("clear unused images"),
		`实际提示：${message}`);
}

// --------------------------- 2. 没装 Image Converter：合并与清理照常，只是不转换
async function withoutConverter(): Promise<void> {
	const stub = await createStub({ converter: false });
	const message = await tidy(stub);

	check("没装插件：合并照常", stub.images.has("img/b.png"), false);
	check("没装插件：一张都不转换", [stub.images.has("img/a.webp"), stub.images.has("img/d.png")], [false, true]);
	check("没装插件：清理照常", stub.commands, [CLEAR_UNUSED_IMAGES_COMMAND]);
	checkTrue("提示里说明了跳过转换的原因",
		message.includes("没检测到 image converter"),
		`实际提示：${message}`);
}

// --------------------------- 3. 关掉「整理时转换图片格式」：装了插件也不转换、不念叨
async function convertSwitchOff(): Promise<void> {
	const stub = await createStub({ settings: { tidyConvertFormat: false } });
	const message = await tidy(stub);

	check("开关关着：一张都不转换", stub.convertedSizes, []);
	check("开关关着：图片保持原格式", [stub.images.has("img/a.png"), stub.images.has("img/d.png")], [true, true]);
	check("开关关着：合并照常", stub.images.has("img/b.png"), false);
	check("开关关着：清理照常", stub.commands, [CLEAR_UNUSED_IMAGES_COMMAND]);
	checkTrue("开关关着：不拿「没检测到 image converter」来唠叨",
		!message.includes("image converter"),
		`实际提示：${message}`);
}

// -------------------------------------------------------------------- 运行
console.log("=== 整理图片：转换 + 合并 + 清理（装了 Image Converter） ===");
await withConverter();

console.log("=== 整理图片：没装 Image Converter 的退路 ===");
await withoutConverter();

console.log("=== 整理图片：关掉转换开关 ===");
await convertSwitchOff();

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
