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
function createApp(options: { modifyFails?: boolean; content?: string; withConverter?: boolean } = {}): {
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
			plugins: { 'image-converter': fakeConverter() },
		};
	}
	return { app, files, log };
}

/** 转码器替身：一律返回 webp 字节 */
function fakeConverter(): ConverterHandle {
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
		imageProcessor: { processImage: async (): Promise<ArrayBuffer> => webpBytes() },
	};
}

const BASE_SETTINGS: TransferSettings = {
	attachmentLocation: 'root',
	customAttachmentFolder: '',
	imageNamePreset: 'img_{ss}',
};

// window.moment 的替身：测试里不需要真实时间，名字固定成 img_M.<ext>
const fakeMoment = {
	clone: (): unknown => fakeMoment,
	add: (): unknown => fakeMoment,
	format: (): string => 'M',
};
(globalThis as unknown as { window: unknown }).window = { moment: () => fakeMoment };

// 磁盘上的真实源文件（`resolvePhysicalPath` 会逐段去文件系统里找）
const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-tidy-transfer-'));
const sourceFile = path.join(sourceDir, 'source.png');
fs.writeFileSync(sourceFile, Buffer.from(pngBytes()));
/** `file:///C:/…` 形态的外部链接（Linux 上自动变成 `file:///tmp/…`） */
const externalLink = `file:///${sourceFile.replace(/\\/g, '/')}`;

// ------------------------------------------------------- 1. 交接：链接写新名字
async function handOffTests(): Promise<void> {
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

	// ② 没有改动时也不会留下文件（理论上 created 为空，这里直接盯行为）
	{
		const { app, log } = createApp();
		const changed = await transferExternalImages(app, BASE_SETTINGS, tf('note.md'));
		check("回滚：正常写回时返回 true", changed, true);
		check("回滚：正常写回时不丢弃", log.trashed, []);
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

// -------------------------------------------------------------------- 运行
console.log("=== 1. 交接：链接写转换后的名字 ===");
await handOffTests();

console.log("=== 2. 回滚：不留孤儿附件 ===");
await rollbackTests();

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
