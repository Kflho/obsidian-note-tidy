/**
 * 「粘贴图片」（`src/ui/paste-images.ts` + `ui/paste-watch.ts` 的接管分支）
 *
 * 运行：npm test
 *
 * 盯四件事：
 *   1. 挑图：剪贴板里哪些算图片（按 MIME 认、没有 MIME 时看扩展名；`items` 优先、不与 `files` 重复）
 *   2. 补名字：剪贴板里的图没有文件名 / 没有扩展名时按 MIME 补一个（命名模板靠扩展名判格式）
 *   3. 拼正文：剪贴板的文字在前、图片链接在后（各占一行）
 *   4. 真接线：粘贴里带图片文件时**我们接管**（`preventDefault` + 调 `pasteImages`），
 *      只有文字时保持原样（不接管，回到"观察者 + 文本修复"那条老路）
 */
import type { Editor, Plugin } from "obsidian";
import { TFile } from "obsidian";
import type { ImageTransferSettings } from "../src/settings/model";
import { DEFAULT_SETTINGS } from "../src/settings/model";
import type { PasteImage, TaskActions } from "../src/tasks";
import { buildPasteText, imageFilesFromClipboard, isImageFile, pastedImageName } from "../src/ui/paste-images";
import { registerPasteAutoFix } from "../src/ui/paste-watch";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail = ""): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

function installDomStubs(): void {
	(globalThis as unknown as Record<string, unknown>).window = {
		setTimeout: (): number => 0,
		clearTimeout: (): void => undefined,
	};
}

/** 剪贴板替身：`items` / `files` 按需给 */
function fakeClipboard(options: {
	items?: Array<{ kind: string; type: string; file: File | null }>;
	files?: File[];
	text?: string;
}): DataTransfer {
	return {
		items: (options.items ?? []).map(item => ({
			kind: item.kind,
			type: item.type,
			getAsFile: (): File | null => item.file,
		})),
		files: options.files ?? [],
		getData: (type: string): string => (type === 'text/plain' ? (options.text ?? '') : ''),
	} as unknown as DataTransfer;
}

function fakeFile(name: string, type: string, bytes = 4): File {
	const data = new Uint8Array(bytes);
	return { name, type, arrayBuffer: async (): Promise<ArrayBuffer> => data.buffer } as unknown as File;
}

// ------------------------------------------------------------ 1. 挑出剪贴板里的图
function pickTests(): void {
	checkEqual("算图片：按 MIME", isImageFile(fakeFile('a', 'image/png')), true);
	checkEqual("算图片：没有 MIME 时看扩展名", isImageFile(fakeFile('a.PNG', '')), true);
	checkEqual("不算图片：文本文件", isImageFile(fakeFile('a.txt', 'text/plain')), false);
	checkEqual("不算图片：没有扩展名也没有 MIME", isImageFile(fakeFile('a', '')), false);

	const one = fakeFile('a.png', 'image/png');
	const two = fakeFile('b.jpg', 'image/jpeg');
	const text = fakeFile('c.txt', 'text/plain');

	checkEqual("挑图：items 里只要图片",
		imageFilesFromClipboard(fakeClipboard({
			items: [
				{ kind: 'string', type: 'text/plain', file: null },
				{ kind: 'file', type: 'image/png', file: one },
				{ kind: 'file', type: 'text/plain', file: text },
				{ kind: 'file', type: 'image/jpeg', file: two },
			],
		})),
		[one, two]);

	// items 与 files 是同一批，别合并（合并会存两遍）
	checkEqual("挑图：items 有货就不看 files",
		imageFilesFromClipboard(fakeClipboard({ items: [{ kind: 'file', type: 'image/png', file: one }], files: [one, two] })),
		[one]);

	checkEqual("挑图：没有 items 时退回 files",
		imageFilesFromClipboard(fakeClipboard({ items: [], files: [one, text, two] })),
		[one, two]);

	checkEqual("挑图：空剪贴板", imageFilesFromClipboard(null), []);
}

// ------------------------------------------------------------ 2. 补文件名
function nameTests(): void {
	checkEqual("名字：本来就有扩展名就照用", pastedImageName(fakeFile('QQ图片.png', 'image/png')), 'QQ图片.png');
	checkEqual("名字：没有扩展名时按 MIME 补", pastedImageName(fakeFile('image', 'image/png')), 'image.png');
	checkEqual("名字：jpeg 补成 jpg", pastedImageName(fakeFile('image', 'image/jpeg')), 'image.jpg');
	checkEqual("名字：webp", pastedImageName(fakeFile('image', 'image/webp')), 'image.webp');
	checkEqual("名字：连名字都没有", pastedImageName(fakeFile('', 'image/png')), 'pasted-image.png');
	checkEqual("名字：MIME 也不认识就用 png", pastedImageName(fakeFile('', '')), 'pasted-image.png');
}

// ------------------------------------------------------------ 3. 拼要写进正文的内容
function insertTextTests(): void {
	checkEqual("拼正文：只有图片", buildPasteText('', ['![[a.webp]]', '![[b.webp]]']), '![[a.webp]]\n![[b.webp]]');
	checkEqual("拼正文：只有文字", buildPasteText('聊天记录', []), '聊天记录');
	checkEqual("拼正文：文字在前、图在后", buildPasteText('聊天记录', ['![[a.webp]]']), '聊天记录\n![[a.webp]]');
	checkEqual("拼正文：文字本来就有换行就不再补", buildPasteText('聊天记录\n', ['![[a.webp]]']), '聊天记录\n![[a.webp]]');
	checkEqual("拼正文：都没有", buildPasteText('', []), '');
}

// ------------------------------------------------------------ 4. 真接线
function fakeEditor(text: string, cursor: number): Editor & { setText: (t: string, c?: number) => void } {
	let value = text;
	let at = cursor;
	return {
		setText: (t: string, c = 0): void => { value = t; at = c; },
		posToOffset: (pos: { line: number; ch: number }) => pos.line * 100000 + pos.ch,
		offsetToPos: (offset: number) => ({ line: Math.floor(offset / 100000), ch: offset % 100000 }),
		getCursor: () => ({ line: Math.floor(at / 100000), ch: at % 100000 }),
		getSelection: () => '',
		getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }) =>
			value.substring(from.line * 100000 + from.ch, to.line * 100000 + to.ch),
		replaceRange: (): void => undefined,
		setCursor: (): void => undefined,
	} as unknown as Editor & { setText: (t: string, c?: number) => void };
}

async function wiringTests(): Promise<void> {
	installDomStubs();

	const pasteHandlers: Array<(evt: ClipboardEvent, editor: unknown, info: { file: TFile | null }) => void> = [];
	const changeHandlers: Array<(editor: unknown, info: { file: TFile | null }) => void> = [];
	const note = Object.assign(new TFile(), { path: '聊天记录.md', name: '聊天记录.md', extension: 'md' });
	const settings: ImageTransferSettings = { ...DEFAULT_SETTINGS };
	const pasted: Array<{ images: PasteImage[]; text: string; from: number; to: number }> = [];
	const fixed: number[] = [];
	const sized: number[] = [];

	const plugin = {
		app: {
			workspace: {
				on: (event: string, callback: never) => {
					if (event === 'editor-paste') pasteHandlers.push(callback);
					if (event === 'editor-change') changeHandlers.push(callback);
					return { event };
				},
			},
		},
		register: (): void => undefined,
		registerEvent: (): void => undefined,
	} as unknown as Plugin;

	const actions = {
		pasteImages: async (_file: TFile, _editor: Editor, from: number, to: number, images: PasteImage[], text: string) => {
			pasted.push({ images, text, from, to });
			return true;
		},
		fixPastedRange: async (_file: TFile, _editor: Editor, start: number) => { fixed.push(start); return true; },
		sizePastedRange: async (_editor: Editor, start: number) => { sized.push(start); return true; },
	} as unknown as TaskActions;

	registerPasteAutoFix(plugin, actions, () => settings);

	const editor = fakeEditor('笔记开头。', 5);
	const paste = (clipboard: DataTransfer, prevented = false): { defaultPrevented: boolean } => {
		const evt = {
			clipboardData: clipboard,
			defaultPrevented: prevented,
			preventDefault(): void { this.defaultPrevented = true; },
		};
		for (const handler of pasteHandlers) handler(evt as unknown as ClipboardEvent, editor, { file: note });
		return evt;
	};
	/** 等异步那半跑完（读字节 → 交给任务层） */
	const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

	// ① 剪贴板里有图片：我们接管（preventDefault），字节交给任务层，文字一起带过去
	{
		const image = fakeFile('a.png', 'image/png', 8);
		const evt = paste(fakeClipboard({ items: [{ kind: 'file', type: 'image/png', file: image }], text: '看这张' }));
		checkTrue("接管：阻止了默认粘贴", evt.defaultPrevented, "应当 preventDefault");
		await settle();
		checkEqual("接管：交给任务层的起点 / 终点", [pasted[0]?.from, pasted[0]?.to], [5, 5]);
		checkEqual("接管：带上了剪贴板的文字", pasted[0]?.text, '看这张');
		checkEqual("接管：带上了图片（名字 + 字节）", pasted[0]?.images.map(i => [i.name, i.bytes.byteLength]), [['a.png', 8]]);
		checkEqual("接管：不再走文本修复 / 套尺寸那两笔", [fixed.length, sized.length], [0, 0]);
	}

	// ② 多张图：一张一张读进来，顺序照剪贴板
	{
		pasted.length = 0;
		paste(fakeClipboard({
			items: [
				{ kind: 'file', type: 'image/png', file: fakeFile('a.png', 'image/png', 4) },
				{ kind: 'file', type: 'image/jpeg', file: fakeFile('b.jpg', 'image/jpeg', 6) },
			],
		}));
		await settle();
		checkEqual("接管：两张图都进来了", pasted[0]?.images.map(i => i.name), ['a.png', 'b.jpg']);
		checkEqual("接管：没有文字时文字是空串", pasted[0]?.text, '');
	}

	// ③ 只有文字：不接管，回到"观察者"那条路（文本修复 + 尺寸观望表）
	{
		pasted.length = 0;
		const evt = paste(fakeClipboard({ items: [{ kind: 'string', type: 'text/plain', file: null }], text: '只有文字' }));
		checkEqual("只有文字：不 preventDefault", evt.defaultPrevented, false);
		await settle();
		checkEqual("只有文字：不调 pasteImages", pasted.length, 0);
	}

	// ④ 开关关掉：图片也不接管（交给别的插件 / Obsidian 默认行为）
	{
		settings.takeOverImagePaste = false;
		const evt = paste(fakeClipboard({ items: [{ kind: 'file', type: 'image/png', file: fakeFile('a.png', 'image/png', 4) }] }));
		checkEqual("开关关着：不 preventDefault", evt.defaultPrevented, false);
		await settle();
		checkEqual("开关关着：不调 pasteImages", pasted.length, 0);
		settings.takeOverImagePaste = true;
	}

	// ⑤ 别的插件已经接管了这次粘贴：我们不再抢（它已经 preventDefault，图它会自己存）
	{
		pasted.length = 0;
		paste(fakeClipboard({ items: [{ kind: 'file', type: 'image/png', file: fakeFile('a.png', 'image/png', 4) }] }), true);
		await settle();
		checkEqual("已被接管：不重复处理", pasted.length, 0);
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 挑出剪贴板里的图 ===");
pickTests();

console.log("=== 2. 补文件名 ===");
nameTests();

console.log("=== 3. 拼要写进正文的内容 ===");
insertTextTests();

console.log("=== 4. 真接线 ===");
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
