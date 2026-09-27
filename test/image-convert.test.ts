/**
 * 图片格式转换（`src/image/convert.ts`）—— **插件自带的编码器**，不依赖别的插件。
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 目标格式 / 名字：`webp` `jpg` `png` 三选一，换扩展名只换最后一个点号那段
 *   2. 该不该转：已是目标格式不转、动图 gif 不转、没有扩展名 / 非受管格式不转
 *   3. 名字按**最终**扩展名算（`plannedExtension`）：同一秒里的 png 与 jpg 不会各占一个名字
 *   4. 真转换（canvas 替身）：转出来是目标格式、比原来小才用；解不开 / 编错格式 / 撞名 / 更小不了 → 按原格式留着
 *   5. 全库单张转换：改名走 Obsidian（链接自动更新）+ 写回新内容
 *
 * 说明：真编码器要浏览器的 canvas，Node 里跑不了 —— 这里用 `installCanvasStub()` 装上替身，
 * 跑的是**真** `encodeWithCanvas`（验我们调用它的姿势），不是假的编码器。
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import {
	convertImageBytes,
	convertPlanFrom,
	convertedFileName,
	convertVaultImage,
	formatLabel,
	looksLikeFormat,
	plannedExtension,
	selectConvertibleImages,
	shouldConvertFile,
	targetExtension,
} from "../src/image/convert";
import type { ConvertPlan } from "../src/image/convert";
import { installCanvasStub, stubPngBytes, stubWebpBytes } from "./canvas-stub";

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
function tf(pathStr: string): TFile {
	const name = pathStr.split('/').pop() ?? pathStr;
	const dot = name.lastIndexOf('.');
	const parentPath = pathStr.includes('/') ? pathStr.substring(0, pathStr.lastIndexOf('/')) : '';
	return Object.assign(new TFile(), {
		path: pathStr,
		name,
		basename: dot > 0 ? name.substring(0, dot) : name,
		extension: dot > 0 ? name.substring(dot + 1) : '',
		parent: { path: parentPath },
	});
}

/** 内存版 vault：记下建了 / 删了 / 改名了 / 改过内容的路径 */
function createApp(initial: Record<string, ArrayBuffer> = {}): {
	app: App;
	files: Map<string, ArrayBuffer>;
	log: { created: string[]; renamed: string[]; modified: string[] };
} {
	const files = new Map<string, ArrayBuffer>(Object.entries(initial));
	const log = { created: [] as string[], renamed: [] as string[], modified: [] as string[] };
	const vault = {
		getAbstractFileByPath: (p: string): TFile | null => (files.has(p) ? tf(p) : null),
		readBinary: async (f: TFile): Promise<ArrayBuffer> => files.get(f.path) ?? stubPngBytes(),
		createBinary: async (p: string, data: ArrayBuffer): Promise<TFile> => {
			if (files.has(p)) throw new Error(`已存在 ${p}`);
			files.set(p, data);
			log.created.push(p);
			return tf(p);
		},
		modifyBinary: async (f: TFile, data: ArrayBuffer): Promise<void> => {
			files.set(f.path, data);
			log.modified.push(f.path);
		},
	};
	const fileManager = {
		renameFile: async (f: TFile, newPath: string): Promise<void> => {
			const data = files.get(f.path) ?? new ArrayBuffer(0);
			files.delete(f.path);
			files.set(newPath, data);
			log.renamed.push(`${f.path} -> ${newPath}`);
		},
	};
	return { app: { vault, fileManager } as unknown as App, files, log };
}

/** 够用的 webp：比测试里的 png 小，所以"转完更小"这条能过 */
const WEBP: ConvertPlan = { format: 'WEBP', quality: 75 };
/** 十几 KB 的原文：替身编出来的字节比它小才会被采用 */
const BIG_SOURCE = new Uint8Array(4000).buffer;

// ------------------------------------------------------------ 1. 格式与名字
function namingTests(): void {
	check("扩展名：WEBP", targetExtension('WEBP'), 'webp');
	check("扩展名：JPEG", targetExtension('JPEG'), 'jpg');
	check("扩展名：PNG", targetExtension('PNG'), 'png');
	check("扩展名：不认识的格式", targetExtension('AVIF'), null);
	check("扩展名：老设置里的 preset", targetExtension('preset'), null);

	check("标签：webp", formatLabel('WEBP'), 'webp');
	check("标签：jpeg 说成 jpg", formatLabel('JPEG'), 'jpg');
	check("标签：认不出来就原样", formatLabel('AVIF'), 'AVIF');

	check("文件名：换扩展名", convertedFileName('pasted_image_20260927.png', 'WEBP'), 'pasted_image_20260927.webp');
	check("文件名：多点号只换最后一个", convertedFileName('a.b.c.jpeg', 'WEBP'), 'a.b.c.webp');
	check("文件名：没有扩展名", convertedFileName('图片', 'WEBP'), '图片.webp');
	check("文件名：格式不支持", convertedFileName('a.png', 'AVIF'), null);

	// 设置 → 计划（认不出来就是"这一步不做"，绝不猜一个格式下手）
	check("计划：webp + 质量", convertPlanFrom('webp', '75'), { format: 'WEBP', quality: 75 });
	check("计划：大小写无所谓", convertPlanFrom('WEBP', '80'), { format: 'WEBP', quality: 80 });
	check("计划：jpg 别名", convertPlanFrom('jpeg', '60'), { format: 'JPEG', quality: 60 });
	check("计划：png", convertPlanFrom('png', '75'), { format: 'PNG', quality: 75 });
	check("计划：老设置里的 preset 不认", convertPlanFrom('preset', '75'), null);
	check("计划：avif 不认（我们编不出来）", convertPlanFrom('avif', '75'), null);
	check("计划：质量坏值按 75", convertPlanFrom('webp', 'abc'), { format: 'WEBP', quality: 75 });
	check("计划：质量上限 100", convertPlanFrom('webp', '999'), { format: 'WEBP', quality: 100 });
	check("计划：质量下限 1", convertPlanFrom('webp', '0'), { format: 'WEBP', quality: 1 });
}

// ------------------------------------------------------------ 2. 该不该转
function shouldConvertTests(): void {
	check("该转：png → webp", shouldConvertFile('a.png', WEBP), true);
	check("该转：bmp → webp", shouldConvertFile('a.bmp', WEBP), true);
	check("该转：PNG 大写也认", shouldConvertFile('A.PNG', WEBP), true);
	check("不转：已经是目标格式", shouldConvertFile('a.webp', WEBP), false);
	check("不转：动图 gif（canvas 只会画第一帧）", shouldConvertFile('a.gif', WEBP), false);
	check("不转：没有扩展名", shouldConvertFile('图片', WEBP), false);
	check("不转：矢量图 svg 不归它管", shouldConvertFile('a.svg', WEBP), false);
	check("不转：计划是空", shouldConvertFile('a.png', null), false);

	// 名字按**最终**扩展名算：这一条是"粘贴多张图只有第一张转了 webp"的根
	check("最终扩展名：要转就是目标格式", plannedExtension('pasted_image_1.png', WEBP), 'webp');
	check("最终扩展名：同一秒的 jpg 也一样", plannedExtension('pasted_image_1.jpg', WEBP), 'webp');
	check("最终扩展名：不转就返回 null", plannedExtension('pasted_image_1.webp', WEBP), null);
	check("最终扩展名：没有计划", plannedExtension('pasted_image_1.png', null), null);

	// 全库筛选
	const files = [
		{ name: 'a.png', extension: 'png' },
		{ name: 'b.webp', extension: 'webp' },
		{ name: 'c.gif', extension: 'gif' },
		{ name: 'd.svg', extension: 'svg' },
		{ name: 'e.jpg', extension: 'jpg' },
		{ name: 'f.md', extension: 'md' },
	];
	check("全库筛选：只留下该转的",
		selectConvertibleImages(files, WEBP).map(f => f.name), ['a.png', 'e.jpg']);
}

// ------------------------------------------------------------ 3. 魔数
function magicTests(): void {
	check("魔数：webp", looksLikeFormat(stubWebpBytes(), 'WEBP'), true);
	check("魔数：png 冒充 webp 不算", looksLikeFormat(stubPngBytes(), 'WEBP'), false);
	check("魔数：png", looksLikeFormat(stubPngBytes(), 'PNG'), true);
	check("魔数：jpeg", looksLikeFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer, 'JPEG'), true);
	check("魔数：太短直接不算", looksLikeFormat(new Uint8Array(4).buffer, 'WEBP'), false);
}

// ------------------------------------------------------------ 4. 真转换（canvas 替身）
async function convertTests(): Promise<void> {
	// ① 转成功：目标格式的字节 + 新名字；**不碰仓库**（先转换、再落盘）
	const canvas = installCanvasStub(() => stubWebpBytes());
	try {
		const { app, log } = createApp();
		const converted = await convertImageBytes(
			app, { name: 'a.png', bytes: BIG_SOURCE, folder: 'attachments' }, WEBP
		);
		check("转换：新文件名换成 webp", converted?.name, 'a.webp');
		check("转换：拿到的是 webp 字节", converted ? looksLikeFormat(converted.bytes, 'WEBP') : false, true);
		check("转换：自己一个文件都不建", log.created, []);
		check("转换：MIME 传对（目标）", canvas.calls[0]?.mime, 'image/webp');
		check("转换：质量按 0–1 传", canvas.calls[0]?.quality, 0.75);
		check("转换：画布用的是解码出来的尺寸", [canvas.calls[0]?.width, canvas.calls[0]?.height], [8, 4]);
		check("转换：webp 不铺白底（透明要留着）", canvas.filledBackground(), false);
	} finally {
		canvas.restore();
	}

	// ② JPEG：先铺白底（不然透明区是黑块），质量照传
	const jpegCanvas = installCanvasStub(() => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer);
	try {
		const { app } = createApp();
		const converted = await convertImageBytes(app, { name: 'a.png', bytes: BIG_SOURCE }, { format: 'JPEG', quality: 90 });
		check("JPEG：新名字是 .jpg", converted?.name, 'a.jpg');
		check("JPEG：铺了白底", jpegCanvas.filledBackground(), true);
		check("JPEG：MIME 与质量传对", [jpegCanvas.calls[0]?.mime, jpegCanvas.calls[0]?.quality], ['image/jpeg', 0.9]);
	} finally {
		jpegCanvas.restore();
	}

	// ③ 各种"不转"：编回来不是目标格式 / 已经是目标格式 / 撞名 / 没有计划
	{
		const wrong = installCanvasStub(() => stubPngBytes());
		try {
			const { app } = createApp();
			check("不转：编回来不是 webp（拿原图糊弄）",
				await convertImageBytes(app, { name: 'a.png', bytes: BIG_SOURCE }, WEBP), null);
		} finally {
			wrong.restore();
		}

		// **比原来大也照用**：目标格式统一本身就是目的
		//（用户判定"这张图优化过没有"看的就是它是不是 webp）
		const huge = installCanvasStub(() => stubWebpBytes('x'.repeat(9000)));
		try {
			const { app } = createApp();
			const converted = await convertImageBytes(app, { name: 'a.png', bytes: BIG_SOURCE }, WEBP);
			check("转完更大也用转换结果（格式统一优先）", converted?.name, 'a.webp');
			check("转完更大时交出去的就是编码器那份字节",
				converted
					? looksLikeFormat(converted.bytes, 'WEBP') && converted.bytes.byteLength > BIG_SOURCE.byteLength
					: false,
				true);
		} finally {
			huge.restore();
		}
	}

	const canvas2 = installCanvasStub();
	try {
		const { app } = createApp({ 'attachments/a.webp': stubWebpBytes('existing') });
		check("不转：目标名字已被占（不覆盖）",
			await convertImageBytes(app, { name: 'a.png', bytes: BIG_SOURCE, folder: 'attachments' }, WEBP), null);
		check("不转：没有计划",
			await convertImageBytes(app, { name: 'a.png', bytes: BIG_SOURCE }, null), null);
		check("不转：动图 gif",
			await convertImageBytes(app, { name: 'a.gif', bytes: BIG_SOURCE }, WEBP), null);
		check("不转：已经是 webp",
			await convertImageBytes(app, { name: 'a.webp', bytes: BIG_SOURCE }, WEBP), null);
	} finally {
		canvas2.restore();
	}

	// ④ 解码器解不开（HEIC 这类）：按原格式留着，不炸
	const broken = installCanvasStub();
	const globals = globalThis as unknown as Record<string, unknown>;
	const realCreate = globals.createImageBitmap;
	globals.createImageBitmap = async (): Promise<unknown> => { throw new Error('解不开'); };
	try {
		const { app } = createApp();
		check("不转：解不开就按原格式",
			await convertImageBytes(app, { name: 'a.heic', bytes: BIG_SOURCE }, WEBP), null);
	} finally {
		globals.createImageBitmap = realCreate;
		broken.restore();
	}
}

// ------------------------------------------------------------ 5. 全库单张转换
async function vaultConvertTests(): Promise<void> {
	// ① 转好之后：改名（换扩展名）+ 写回内容，链接由 Obsidian 跟着改
	const canvas = installCanvasStub(() => stubWebpBytes());
	try {
		const { app, files, log } = createApp({ 'attachments/a.png': BIG_SOURCE });
		const name = await convertVaultImage(app, tf('attachments/a.png'), WEBP);
		check("全库转换：返回新文件名", name, 'a.webp');
		check("全库转换：改名走 Obsidian（链接会自动更新）", log.renamed, ['attachments/a.png -> attachments/a.webp']);
		check("全库转换：新内容写回去了", log.modified, ['attachments/a.webp']);
		check("全库转换：新文件是 webp", looksLikeFormat(files.get('attachments/a.webp') ?? new ArrayBuffer(0), 'WEBP'), true);
		check("全库转换：旧文件没了", files.has('attachments/a.png'), false);

		// ② 已经是目标格式 / 动图 / 没有计划：一律不动文件
		check("全库转换：已是 webp 不动", await convertVaultImage(app, tf('a.webp'), WEBP), null);
		check("全库转换：gif 不动", await convertVaultImage(app, tf('b.gif'), WEBP), null);
		check("全库转换：没有计划就不动", await convertVaultImage(app, tf('c.png'), null), null);
		check("全库转换：这三个都没被改名", log.renamed.length, 1);
	} finally {
		canvas.restore();
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 目标格式与文件名 ===");
namingTests();

console.log("=== 2. 该不该转 ===");
shouldConvertTests();

console.log("=== 3. 魔数 ===");
magicTests();

console.log("=== 4. 真转换（canvas 替身） ===");
await convertTests();

console.log("=== 5. 全库单张转换 ===");
await vaultConvertTests();

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
