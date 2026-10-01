/**
 * 粘贴后自动收拾的三件事（`pasteFixPlanFrom` + `ImageTasks.fixPastedRange`）
 *
 * 运行：npm test
 *
 * 盯两件事：
 *   1. **开关矩阵**：收图（`autoTransferImagesOnPaste`）/ 排版（`autoFixChatLogOnPaste`）/
 *      套尺寸（`autoSetImageSizeOnPaste`）各自认自己的开关，三件全关时整趟立刻返回 ——
 *      "智能排版"与"智能转换图片"是两件事，解耦之后可以只留一件（2026-09 用户要的）；
 *   2. **端到端**：一段**不像聊天记录**的粘贴（"两张图 + 一段话"，没有时间戳头部）里的
 *      `file:///…` 外链图片照样收进仓库、换成内部链接（"本来就应该放进仓库"），
 *      而正文一个字都不改；单条消息（带日期的头部）则整段当聊天记录排好。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TFile } from 'obsidian';
import type { App, Editor } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/settings/model';
import { pasteFixPlanFrom } from '../src/settings/model';
import { looksLikeChatLog } from '../src/text/chat-log';
import type { ImageTransferSettings } from '../src/settings';
import { ImageTasks } from '../src/tasks';
import type { BatchRunner } from '../src/batch';
import type { StatusBarProgress } from '../src/ui/progress';

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

// -------------------------------------------------------------------- 替身
function tf(pathStr: string): TFile {
	const name = pathStr.split('/').pop() ?? pathStr;
	const dot = name.lastIndexOf('.');
	return Object.assign(new TFile(), {
		path: pathStr,
		name,
		basename: dot > 0 ? name.substring(0, dot) : name,
		extension: dot > 0 ? name.substring(dot + 1) : '',
	});
}

/** 内存版仓库：`createBinary` 记下写进来的文件，`trashFile` 把它们撤掉（回滚那条路要用） */
function createApp(): { app: App; files: Map<string, ArrayBuffer>; trashed: string[] } {
	const files = new Map<string, ArrayBuffer>();
	const trashed: string[] = [];
	const app = {
		vault: {
			getAbstractFileByPath: (p: string): TFile | null => (files.has(p) ? tf(p) : null),
			createBinary: async (p: string, data: ArrayBuffer): Promise<TFile> => {
				files.set(p, data);
				return tf(p);
			},
			getFiles: (): TFile[] => [],
		},
		fileManager: {
			trashFile: async (f: TFile): Promise<void> => {
				files.delete(f.path);
				trashed.push(f.path);
			},
		},
	} as unknown as App;
	return { app, files, trashed };
}

/**
 * `window.moment` 的替身：名字里的 `{ss}` 按"第几秒"走（`img_0`、`img_1`…）——
 * 同一批里第二张图必须换个名字，否则 `generateUniqueTargetPath` 会一直往后推秒数。
 */
function installMoment(): void {
	const globals = globalThis as unknown as Record<string, unknown>;
	globals.window = {
		moment: () => momentAt(0),
		setTimeout: (): number => 0,
		clearTimeout: (): void => undefined,
	};
}

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
		format(): string { return String(this.second); },
	};
}

/** 编辑器替身：偏移就是字符串下标，`replaceRange` 真的改内容，光标可设 */
function createEditor(text: string): {
	editor: Editor;
	value: () => string;
	setCursor: (offset: number) => void;
} {
	let value = text;
	let cursor = 0;
	const editor = {
		getValue: (): string => value,
		posToOffset: (pos: { line: number; ch: number }): number => pos.line * 100000 + pos.ch,
		offsetToPos: (offset: number): { line: number; ch: number } => ({
			line: Math.floor(offset / 100000),
			ch: offset % 100000,
		}),
		getCursor: (): { line: number; ch: number } => ({
			line: Math.floor(cursor / 100000),
			ch: cursor % 100000,
		}),
		getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }): string =>
			value.substring(from.line * 100000 + from.ch, to.line * 100000 + to.ch),
		replaceRange: (replacement: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void => {
			const a = from.line * 100000 + from.ch;
			const b = to.line * 100000 + to.ch;
			value = value.slice(0, a) + replacement + value.slice(b);
		},
	} as unknown as Editor;
	return { editor, value: () => value, setCursor: (offset: number) => { cursor = offset; } };
}

const BASE: ImageTransferSettings = {
	...DEFAULT_SETTINGS,
	attachmentLocation: 'root',
	customAttachmentFolder: '',
	imageNamePreset: 'img_{ss}',
	// 关掉转码：这一份测的是"收不收图"，转码归 image-convert 的测试
	convertImportedImages: false,
	// 头部信息全关（使用者的实际设置）：排完版只剩消息正文
	chatShowUsername: false,
	chatShowDate: false,
	chatShowTime: false,
};

// ---------------------------------------------------------- 1. 开关矩阵
function planTests(): void {
	check('三件全开', pasteFixPlanFrom(BASE), {
		transfer: true,
		typeset: true,
		size: { width: '100', height: '', overwriteExisting: true },
	});
	check('只关收图：transfer 关掉，其它两件还在',
		pasteFixPlanFrom({ ...BASE, autoTransferImagesOnPaste: false }),
		{ transfer: false, typeset: true, size: { width: '100', height: '', overwriteExisting: true } });
	check('只关排版：typeset 关掉',
		pasteFixPlanFrom({ ...BASE, autoFixChatLogOnPaste: false }),
		{ transfer: true, typeset: false, size: { width: '100', height: '', overwriteExisting: true } });
	check('只关尺寸：size 为 null',
		pasteFixPlanFrom({ ...BASE, autoSetImageSizeOnPaste: false }),
		{ transfer: true, typeset: true, size: null });
	check('宽度留空（"移除尺寸"那一档）：尺寸那一件不做',
		pasteFixPlanFrom({ ...BASE, imageSizeWidth: '' }),
		{ transfer: true, typeset: true, size: null });
	check('三件全关 → null（整趟一笔都不动）',
		pasteFixPlanFrom({
			...BASE,
			autoTransferImagesOnPaste: false,
			autoFixChatLogOnPaste: false,
			autoSetImageSizeOnPaste: false,
		}),
		null);
}

// ------------------------------------------------- 2. 端到端：粘贴时收图
async function endToEndTests(): Promise<void> {
	installMoment();

	// 磁盘上真放一张图：外链解析是真找文件的（`file:///…` → fs.readFile）
	const tempImage = path.join(os.tmpdir(), `note-tidy-paste-fix-${process.pid}.png`);
	fs.writeFileSync(tempImage, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	const link = `file:///${tempImage.replace(/\\/g, '/')}`;

	const file = Object.assign(new TFile(), { path: '聊天记录.md', name: '聊天记录.md', extension: 'md' });

	const build = (settings: ImageTransferSettings): { tasks: ImageTasks; files: Map<string, ArrayBuffer>; trashed: string[] } => {
		const { app, files, trashed } = createApp();
		const tasks = new ImageTasks(
			app,
			() => settings,
			null as unknown as BatchRunner,
			null as unknown as StatusBarProgress,
			async () => undefined
		);
		return { tasks, files, trashed };
	};

	try {
		// ① 用户 2026-09 那条：**两张图 + 一段话**，没有"昵称 + 时间戳"头部 ⇒ 不像聊天记录，
		//    但图片照样得进仓库（"本来就应该放进仓库，转换图片本来就是智能排版的功能"）
		const pasted = `![100](${link})![100](${link})  \n天天打怪导致作业都写不来才是正确的`;
		check('不像聊天记录（没有时间戳头部）', looksLikeChatLog(pasted), false);

		{
			const { tasks, files } = build(BASE);
			const document = `137集\n\t${pasted}\n`;
			const start = '137集\n'.length + 1; // 粘贴起点在 tab 之后
			const editor = createEditor(document);
			editor.setCursor(start + pasted.length);

			check('不像聊天记录也动手（收图 + 对齐缩进）', await tasks.fixPastedRange(file, editor.editor, start), true);
			check('两张外链图片都收进了仓库', [...files.keys()], ['img_0.png', 'img_1.png']);
			check('链接换成内部双链（尺寸别名保留）、正文一个字没改', editor.value(),
				'137集\n\t![[img_0.png|100]]![[img_1.png|100]]  \n\t天天打怪导致作业都写不来才是正确的\n');

			// 再跑一次：内部链接不再收图，缩进已经在那一层 ⇒ 什么都不改
			editor.setCursor(start + pasted.length + 1);
			check('重复跑不动手', await tasks.fixPastedRange(file, editor.editor, start), false);
			check('重复跑内容不变', editor.value(),
				'137集\n\t![[img_0.png|100]]![[img_1.png|100]]  \n\t天天打怪导致作业都写不来才是正确的\n');
		}

		// ② 关掉「粘贴时自动收图」：图片留在原处（外链），排版那一件照做
		{
			const { tasks, files } = build({ ...BASE, autoTransferImagesOnPaste: false });
			const document = `137集\n\t${pasted}\n`;
			const start = '137集\n'.length + 1;
			const editor = createEditor(document);
			editor.setCursor(start + pasted.length);

			check('关掉收图后仍然对齐缩进', await tasks.fixPastedRange(file, editor.editor, start), true);
			check('关掉收图后一张都没进仓库', [...files.keys()], []);
			check('关掉收图后链接原样、只有缩进对齐', editor.value(),
				`137集\n\t![100](${link})![100](${link})  \n\t天天打怪导致作业都写不来才是正确的\n`);
		}

		// ③ 关掉「粘贴时自动排版」：图照收，正文一个字不动（第二行仍然顶格 —— 那是编辑器
		//    自己的粘贴行为，只有排版那一件开着时才由我们对齐）
		{
			const { tasks, files } = build({ ...BASE, autoFixChatLogOnPaste: false });
			const document = `137集\n\t${pasted}\n`;
			const start = '137集\n'.length + 1;
			const editor = createEditor(document);
			editor.setCursor(start + pasted.length);

			check('关掉排版后照样收图', await tasks.fixPastedRange(file, editor.editor, start), true);
			check('关掉排版后图片进仓库', [...files.keys()], ['img_0.png', 'img_1.png']);
			check('关掉排版后不做缩进对齐', editor.value(),
				'137集\n\t![[img_0.png|100]]![[img_1.png|100]]  \n天天打怪导致作业都写不来才是正确的\n');
		}

		// ④ 单条消息也算聊天记录（用户 2026-09 要的第 2 条）：带日期的头部一条就认，
		//    整段按聊天记录排好（头部信息全关 ⇒ 头部行收掉、正文缩进），图片一并进仓库
		{
			const single = `张三 2026/9/28 15:57:00\n![100](${link})\n天天打怪导致作业都写不来才是正确的`;
			check('单条消息（带日期）算聊天记录', looksLikeChatLog(single), true);

			const { tasks, files } = build(BASE);
			const editor = createEditor(`${single}\n`);
			editor.setCursor(single.length);

			check('单条消息也动手', await tasks.fixPastedRange(file, editor.editor, 0), true);
			check('单条消息里的图片收进仓库', [...files.keys()], ['img_0.png']);
			check('单条消息整段排好（头部收掉、正文缩进、尺寸带上）', editor.value(),
				'![[img_0.png|100]]\n天天打怪导致作业都写不来才是正确的\n');
		}
	} finally {
		fs.rmSync(tempImage, { force: true });
	}
}

// -------------------------------------------------------------------- 运行
console.log('=== 1. 开关矩阵 ===');
planTests();

console.log('=== 2. 端到端：粘贴时收图 ===');
await endToEndTests();

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log('\n❌ ' + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
