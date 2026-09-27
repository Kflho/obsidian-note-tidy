/**
 * 外部图片导入的交接与回滚（`src/image/transfer.ts`）
 *
 * 运行：npm test
 *
 * 盯四件事：
 *   1. 交接：导入的图片交给 Image Converter 转格式后，**链接写的是转换后的文件名**（`.webp`）
 *   2. 退回：没装插件 / 关了开关时按原格式导入，链接仍是 `.png`
 *   3. 回滚：写回失败时把刚导入的文件删掉 —— 不留孤儿附件（2026-09 用户库里 40 张的成因）
 *   4. 回滚的删除走 Obsidian 的回收站，删不动也不炸
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	discardImportedFiles,
	transferExternalImages,
	transferImagesInText,
} from "../src/image/transfer";
import type { TransferSettings } from "../src/image/transfer";
import type { ConverterHandle } from "../src/image/image-converter-bridge";

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
function webpBytes(payload = 'webp'): ArrayBuffer {
	const bytes = new Uint8Array(12 + payload.length);
	const head = 'RIFF\u0000\u0000\u0000\u0000WEBP';
	for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
	for (let i = 0; i < payload.length; i++) bytes[12 + i] = payload.charCodeAt(i);
	return bytes.buffer;
}

function pngBytes(): ArrayBuffer {
	const bytes = new Uint8Array(16);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	return bytes.buffer;
}

function tf(pathStr: string): TFile {
	// 真实仓库里的路径从不带前导斜杠（`normalizePath` 会收掉），替身照此办理
	const path = pathStr.replace(/^\/+/, '');
	const name = path.split('/').pop() ?? path;
	const dot = name.lastIndexOf('.');
	return Object.assign(new TFile(), {
		path,
		name,
		basename: dot > 0 ? name.substring(0, dot) : name,
		extension: dot > 0 ? name.substring(dot + 1) : '',
		parent: { path: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '' },
	});
}

/** 内存版 vault（`modify` 可以设成"写盘必失败"，用来验回滚） */
function createApp(options: {
	modifyFails?: boolean;
	content?: string;
	withConverter?: boolean;
	/** 换一个转码器替身（例如"转出来的还是原格式"，用来验转码失败时的退路） */
	converter?: ConverterHandle;
} = {}): {
	app: App;
	files: Map<string, ArrayBuffer>;
	log: { created: string[]; deleted: string[]; trashed: string[]; modified: string[] };
} {
	const files = new Map<string, ArrayBuffer>();
	const log = { created: [] as string[], deleted: [] as string[], trashed: [] as string[], modified: [] as string[] };
	const vault = {
		getAbstractFileByPath: (p: string): TFile | null => (files.has(p) ? tf(p) : null),
		readBinary: async (f: TFile): Promise<ArrayBuffer> => files.get(f.path) ?? pngBytes(),
		createBinary: async (p: string, data: ArrayBuffer): Promise<TFile> => {
			if (files.has(p)) throw new Error(`已存在 ${p}`);
			files.set(p, data);
			log.created.push(p);
			return tf(p);
		},
		delete: async (f: TFile): Promise<void> => {
			files.delete(f.path);
			log.deleted.push(f.path);
		},
		read: async (): Promise<string> => options.content ?? `![](${externalLink})`,
		modify: async (f: TFile): Promise<void> => {
			if (options.modifyFails) throw new Error('写盘失败');
			log.modified.push(f.path);
		},
	};
	const fileManager = {
		trashFile: async (f: TFile): Promise<void> => {
			files.delete(f.path);
			log.trashed.push(f.path);
		},
	};
	const app = { vault, fileManager } as unknown as App;
	// 交接靠 `app.plugins.plugins['image-converter']` 找插件实例 —— 装上插件才有交接这回事
	if (options.withConverter) {
		(app as unknown as { plugins: unknown }).plugins = {
			plugins: { 'image-converter': options.converter ?? fakeConverter() },
		};
	}
	return { app, files, log };
}

/** 转码器替身：默认返回 webp 字节（`produce` 换成别的就能造出"转码失败"） */
function fakeConverter(produce: () => ArrayBuffer = webpBytes): ConverterHandle {
	return {
		settings: {
			conversionPresets: [{
				name: 'WEBP(Exclude gif)', outputFormat: 'WEBP', quality: 75, colorDepth: 1,
				resizeMode: 'None', desiredWidth: 800, desiredHeight: 600, desiredLongestEdge: 1000,
				enlargeOrReduce: 'Auto', allowLargerFiles: false,
				revertToOriginalIfLarger: false, minimumCompressionSavingsInKB: 30,
				skipConversionPatterns: '*.gif',
			}],
			selectedConversionPreset: 'WEBP(Exclude gif)',
		},
		imageProcessor: { processImage: async (): Promise<ArrayBuffer> => produce() },
	};
}

const BASE_SETTINGS: TransferSettings = {
	attachmentLocation: 'root',
	customAttachmentFolder: '',
	imageNamePreset: 'img_{ss}',
};

// window.moment 的替身。
//
// 默认是"定死"模式：不管几点都给出 `img_M.<ext>`，既有用例都按这个名字断言。
// 「同一秒里撞名要往后推一秒」的用例得让时间真的走，用 `useTickingMoment()` 切到走秒模式
// （从第 0 秒开始，`format` 就是当前秒数 → 名字是 `img_0`、`img_1`…）。
let ticking = false;
let clock = 0;

interface FakeMoment {
	second: number;
	clone: () => FakeMoment;
	add: () => FakeMoment;
	format: () => string;
}

function momentAt(second: number): FakeMoment {
	return {
		second,
		clone(): FakeMoment { return momentAt(this.second); },
		add(): FakeMoment { this.second += 1; return this; },
		format(): string { return ticking ? String(this.second) : 'M'; },
	};
}

/** 切到走秒模式：名字按秒数走（`img_0`、`img_1`…），用来验"撞名往后推一秒" */
function useTickingMoment(startSecond = 0): void {
	ticking = true;
	clock = startSecond;
}

/** 切回定死模式（别把模式漏给后面的用例） */
function useFixedMoment(): void {
	ticking = false;
	clock = 0;
}

(globalThis as unknown as { window: unknown }).window = {
	moment: () => momentAt(clock),
};

// 磁盘上的真实源文件（`resolvePhysicalPath` 会逐段去文件系统里找）
//
// ⚠️ 只有 Windows 能跑这一段：插件的路径解析认的是 `file:///D:/…` 与 `D:\…` 这两种
// **盘符**写法（见 `image/external-path.ts` 文件头），POSIX 绝对路径既不被
// `externalImageRe` 匹配、也走不通 `resolvePhysicalPath`。所以"真去磁盘找图"的用例
// 在别的平台直接跳过（CI 跑在 ubuntu 上），纯逻辑部分在所有平台照跑。
const CAN_TOUCH_DISK = process.platform === 'win32' && !process.env.NOTE_TIDY_SKIP_DISK_TESTS;
const SKIP_DISK_NOTE = 'ℹ️ 跳过「真去磁盘找图」的用例：插件的路径解析只支持 Windows 盘符路径（CI 在 Linux 上跑，属正常）。';

const sourceDir = CAN_TOUCH_DISK ? fs.mkdtempSync(path.join(os.tmpdir(), 'note-tidy-transfer-')) : '';
const sourceFile = CAN_TOUCH_DISK ? path.join(sourceDir, 'source.png') : '';
if (CAN_TOUCH_DISK) fs.writeFileSync(sourceFile, Buffer.from(pngBytes()));
/** QQ 那种"一张截图 + 一张表情"的批次：**源格式不同**（png 与 jpg），扩展名只差一点点 */
const sourceJpg = CAN_TOUCH_DISK ? path.join(sourceDir, 'source.jpg') : '';
const sourceGif = CAN_TOUCH_DISK ? path.join(sourceDir, 'source.gif') : '';
if (CAN_TOUCH_DISK) {
	fs.writeFileSync(sourceJpg, Buffer.from(pngBytes()));
	fs.writeFileSync(sourceGif, Buffer.from(pngBytes()));
}
/** `file:///C:/…` 形态的外部链接 */
const externalLink = `file:///${sourceFile.replace(/\\/g, '/')}`;
const externalJpgLink = `file:///${sourceJpg.replace(/\\/g, '/')}`;
const externalGifLink = `file:///${sourceGif.replace(/\\/g, '/')}`;

// ------------------------------------------------------- 1. 交接：链接写新名字
async function handOffTests(): Promise<void> {
	if (!CAN_TOUCH_DISK) {
		console.log(SKIP_DISK_NOTE);
		return;
	}
	// 装了插件、开关默认开（undefined 也算开）：链接写 .webp，创建的也是 webp 文件
	{
		const { app, log } = createApp({ withConverter: true });
		const result = await transferImagesInText(
			app, { ...BASE_SETTINGS, handOffImportedImages: true }, tf('note.md'),
			`正文\n![](${externalLink})\n结尾`,
		);
		check("交接：链接换成 webp", result.content.includes('![[img_M.webp]]'), true);
		check("交接：不再有外部路径", result.content.includes('file:///'), false);
		check("交接：内容算改了", result.changed, true);
		check("交接：created 记的是转换后的文件", result.created.map(f => f.name), ['img_M.webp']);
		check("交接：写进仓库的只有 webp（没有中转 png）", log.created, ['img_M.webp']);
		check("交接：不需要删除任何文件", log.deleted, []);
	}

	// 开关写着 undefined：按默认（开）走 —— 设置项默认值就是 true
	{
		const { app } = createApp({ withConverter: true });
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'), `![](${externalLink})`,
		);
		check("交接：默认就是开", result.created.map(f => f.name), ['img_M.webp']);
	}

	// 关掉开关：按原格式导入，链接仍是 .png（插件装着也不交接）
	{
		const { app, log } = createApp({ withConverter: true });
		const result = await transferImagesInText(
			app, { ...BASE_SETTINGS, handOffImportedImages: false }, tf('note.md'),
			`![](${externalLink})`,
		);
		check("退回：关掉开关时链接是 png", result.content.includes('![[img_M.png]]'), true);
		check("退回：created 记的是原格式文件", result.created.map(f => f.name), ['img_M.png']);
		check("退回：写进仓库的是 png", log.created, ['img_M.png']);
	}

	// 没装 image converter（app 上没有它的实例）：照旧导入，链接是 png —— 功能不坏，只是不转格式
	{
		const { app, log } = createApp();
		const result = await transferImagesInText(
			app, { ...BASE_SETTINGS, handOffImportedImages: true }, tf('note.md'),
			`![](${externalLink})`,
		);
		check("退路：没装插件时链接是 png", result.content.includes('![[img_M.png]]'), true);
		check("退路：没装插件时照旧入库", log.created, ['img_M.png']);
	}

	// 没有外部图片：什么都不做，created 空
	{
		const { app } = createApp();
		const result = await transferImagesInText(app, BASE_SETTINGS, tf('note.md'), '只有正文');
		check("空跑：内容没变", result.changed, false);
		check("空跑：没有新建文件", result.created.length, 0);
	}

	// 图片带说明文字与尺寸：说明文字照旧跟着链接走
	{
		const { app } = createApp({ withConverter: true });
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'), `![|300](${externalLink})`,
		);
		check("交接：说明文字跟着链接", result.content.includes('![[img_M.webp|300]]'), true);
	}
}

// ------------------------------------------------------- 2. 回滚：孤儿附件
async function rollbackTests(): Promise<void> {
	// ①②需要真的从磁盘导入一张图（原因见文件上方关于平台的说明）
	if (CAN_TOUCH_DISK) {
		// ① 写盘失败：刚导入的文件要被丢弃，错误照旧抛出去
		{
			const { app, log } = createApp({ modifyFails: true, withConverter: true });
			let threw = false;
			try {
				await transferExternalImages(app, BASE_SETTINGS, tf('note.md'));
			} catch {
				threw = true;
			}
			check("回滚：写盘失败照旧抛错", threw, true);
			check("回滚：写盘失败时不留文件", log.trashed, ['img_M.webp']);
		}

		// ② 正常写回：返回 true，且没有任何文件被丢弃
		{
			const { app, log } = createApp();
			const changed = await transferExternalImages(app, BASE_SETTINGS, tf('note.md'));
			check("回滚：正常写回时返回 true", changed, true);
			check("回滚：正常写回时不丢弃", log.trashed, []);
		}
	} else {
		console.log(SKIP_DISK_NOTE);
	}

	// ③ 丢弃走 Obsidian 的回收站（trashFile）
	{
		const { app, log } = createApp();
		await discardImportedFiles(app, [tf('/a.png'), tf('/b.png')]);
		check("丢弃：两个文件都进回收站", log.trashed, ['a.png', 'b.png']);
		check("丢弃：没用永久删除", log.deleted, []);
	}

	// ④ 删除本身失败：吞掉，不连累调用方
	{
		const app = {
			vault: {
				delete: async (): Promise<void> => { throw new Error('删不掉'); },
			},
			fileManager: {
				trashFile: async (): Promise<void> => { throw new Error('回收站也删不掉'); },
			},
		} as unknown as App;
		let threw = false;
		try {
			await discardImportedFiles(app, [tf('/d.png')]);
		} catch {
			threw = true;
		}
		check("丢弃：删不掉也不抛异常", threw, false);
	}
}

// ---------------------------- 3. 同一批多张图：源格式不同的两张落在同一秒也要转格式
/**
 * 2026-09 用户报的「粘贴一段有多张图的聊天记录，只有第一张转了 webp，后面几张还是 png/jpg」：
 *
 * 一次粘贴里的图片往往落在同一秒，名字只差源扩展名（`pasted_image_…014850.png` 与
 * `…014850.jpg`）。按源扩展名起名字的话两张都"没被占"，可第二张转出来的 `…014850.webp`
 * 正是第一张 —— 转码器撞名即放弃转换，第二张就按原格式进了库。
 *
 * 现在与批量重命名同一条规矩：**名字按文件最终会有的扩展名生成**（要转格式就是目标格式），
 * 撞名交给 `generateUniqueTargetPath` 那套"往后推一秒"。转码万一没成，再换回原扩展名要个空位。
 */
async function sameSecondBatchTests(): Promise<void> {
	if (!CAN_TOUCH_DISK) {
		console.log(SKIP_DISK_NOTE);
		return;
	}

	// ① png + jpg 同一秒：两张都要转成 webp，名字各自错开一秒
	{
		const { app, log } = createApp({ withConverter: true });
		useTickingMoment();
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'),
			`![](${externalLink})\n![](${externalJpgLink})`,
		);
		useFixedMoment();
		check("同秒多图：两张都落了 webp", log.created, ['img_0.webp', 'img_1.webp']);
		check("同秒多图：链接都指向 webp", [/!\[\[img_0\.webp\]\]/.test(result.content), /!\[\[img_1\.webp\]\]/.test(result.content)], [true, true]);
		check("同秒多图：没有一张按原格式留下", /\.(png|jpg)\]\]/.test(result.content), false);
		check("同秒多图：created 与落盘一致", result.created.map(f => f.name), ['img_0.webp', 'img_1.webp']);
	}

	// ② 目标格式的名字**早就被仓库里的文件占着**（上一批粘贴留下的）：照样推一秒后转格式，
	//    而不是"撞名就按 png 留着"
	{
		const { app, log } = createApp({ withConverter: true });
		await app.vault.createBinary('img_0.webp', webpBytes());
		log.created.length = 0;
		useTickingMoment();
		const result = await transferImagesInText(app, BASE_SETTINGS, tf('note.md'), `![](${externalLink})`);
		useFixedMoment();
		check("目标名被占：往后推一秒", log.created, ['img_1.webp']);
		check("目标名被占：链接写的是转换后的名字", result.content.includes('![[img_1.webp]]'), true);
	}

	// ③ 没装 Image Converter：不交接，按原格式各用各的名字（行为与以前完全一样）
	{
		const { app, log } = createApp();
		useTickingMoment();
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'),
			`![](${externalLink})\n![](${externalJpgLink})`,
		);
		useFixedMoment();
		check("不交接：各按原格式落盘", log.created, ['img_0.png', 'img_0.jpg']);
		check("不交接：链接是原格式", [result.content.includes('![[img_0.png]]'), result.content.includes('![[img_0.jpg]]')], [true, true]);
	}

	// ④ 动图（gif）不转：它按 `.gif` 起名字，后面那张 png 照旧转格式
	{
		const { app, log } = createApp({ withConverter: true });
		useTickingMoment();
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'),
			`![](${externalGifLink})\n![](${externalLink})`,
		);
		useFixedMoment();
		check("同秒多图：gif 保持原样、png 转 webp", log.created, ['img_0.gif', 'img_0.webp']);
		check("同秒多图：gif 的链接没被换成 webp", result.content.includes('![[img_0.gif]]'), true);
	}

	// ⑤ 名字是按目标格式生成的，可转码**没成**（它把输入原样退了回来）：必须换回原扩展名落盘，
	//    不能把 png 字节写成 `.webp` 文件。此时两张图可以与"没装转码器"那一档一样同词干不同扩展名
	//    （链接带着扩展名，谁也不会指错）
	{
		const { app, log } = createApp({ withConverter: true, converter: fakeConverter(pngBytes) });
		useTickingMoment();
		const result = await transferImagesInText(
			app, BASE_SETTINGS, tf('note.md'),
			`![](${externalLink})\n![](${externalJpgLink})`,
		);
		useFixedMoment();
		check("转码没成：按原扩展名落盘", log.created, ['img_0.png', 'img_0.jpg']);
		check("转码没成：链接跟着原扩展名", [result.content.includes('![[img_0.png]]'), result.content.includes('![[img_0.jpg]]')], [true, true]);
		check("转码没成：一个 .webp 都没建（不拿 png 字节冒充）",
			log.created.some(name => name.endsWith('.webp')), false);
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 交接：链接写转换后的名字 ===");
await handOffTests();

console.log("=== 2. 回滚：不留孤儿附件 ===");
await rollbackTests();

console.log("=== 3. 同一批多张图：同一秒里源格式不同也都要转 ===");
await sameSecondBatchTests();

fs.rmSync(sourceDir, { recursive: true, force: true });

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
