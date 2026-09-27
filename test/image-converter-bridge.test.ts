/**
 * 与 Image Converter 的交接（`src/image/image-converter-bridge.ts`）
 *
 * 运行：npm test
 *
 * 盯五件事：
 *   1. 预设读取：选中哪个预设、哪些格式不接、缺字段怎么兜底（它自己的默认值）
 *   2. 跳过模式：`*.gif` 这类通配与 `/正则/` 三种写法的语义（照抄它自己的实现）
 *   3. 魔数校验：它转码失败时会**原样返回输入**，所以必须自己认一遍结果
 *   4. 划算判定：`revertToOriginalIfLarger` + `minimumCompressionSavingsInKB`
 *   5. 真转换：转换成功就交出目标格式的字节与新名字（先转换、再落盘，不碰仓库）；
 *      任何一步不对都返回 null（调用方按原格式导入）
 *
 * 另有 `handOffExtension`（"这张图最终是什么格式"）：导入那边在**起名字之前**问它，
 * 好把转换后那一路的名字也占上 —— 判定与 `convertImageBytes` 共用一份（`planConversion`）。
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import {
	ConversionHint,
	convertedFileName,
	convertImageBytes,
	convertVaultImage,
	findImageConverter,
	formatLabel,
	handOffExtension,
	looksLikeFormat,
	matchesAnyPattern,
	readConverterPreset,
	selectConvertibleImages,
	shouldConvertFile,
	shouldUseConverted,
	targetExtension,
	vaultConvertOverride,
} from "../src/image/image-converter-bridge";
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
function webpBytes(payload = 'webp-body'): ArrayBuffer {
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

function jpegBytes(): ArrayBuffer {
	const bytes = new Uint8Array(16);
	bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
	return bytes.buffer;
}

function avifBytes(): ArrayBuffer {
	const bytes = new Uint8Array(24);
	// 布局同 ISO BMFF：size(4) + "ftyp"(4) + 主品牌(4)
	const head = '\u0000\u0000\u0000\u0000ftypavif';
	for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
	return bytes.buffer;
}

/** 造一个 TFile 替身（TFile 本体是空类，字段自己挂上去） */
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

/** 内存版 vault：记下建了/删了/改名了哪些路径 */
function createApp(initial: Record<string, ArrayBuffer> = {}): {
	app: App;
	files: Map<string, ArrayBuffer>;
	log: { created: string[]; deleted: string[]; trashed: string[]; renamed: string[]; modified: string[] };
} {
	const files = new Map<string, ArrayBuffer>(Object.entries(initial));
	const log = {
		created: [] as string[], deleted: [] as string[], trashed: [] as string[],
		renamed: [] as string[], modified: [] as string[],
	};
	const vault = {
		getAbstractFileByPath: (p: string): TFile | null => (files.has(p) ? tf(p) : null),
		readBinary: async (f: TFile): Promise<ArrayBuffer> => {
			const data = files.get(f.path);
			if (!data) throw new Error(`找不到 ${f.path}`);
			return data;
		},
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
	return {
		app: { vault, fileManager } as unknown as App,
		files,
		log,
	};
}

const WEBP_PRESET = {
	name: 'WEBP(Exclude gif)',
	outputFormat: 'WEBP',
	quality: 75,
	colorDepth: 1,
	resizeMode: 'None',
	desiredWidth: 800,
	desiredHeight: 600,
	desiredLongestEdge: 1000,
	enlargeOrReduce: 'Auto',
	allowLargerFiles: false,
	revertToOriginalIfLarger: false,
	minimumCompressionSavingsInKB: 30,
	skipConversionPatterns: '*.gif',
};

function settingsWith(preset: Record<string, unknown>): Record<string, unknown> {
	return {
		conversionPresets: [preset],
		selectedConversionPreset: preset.name,
		revertToOriginalIfLarger: false,
		minimumCompressionSavingsInKB: 30,
	};
}

/** 造一个转码器替身：把收到的参数记下来，按 `produce` 返回字节 */
function fakeConverter(
	produce: () => ArrayBuffer,
	settings: unknown = settingsWith(WEBP_PRESET)
): { handle: ConverterHandle; calls: unknown[][] } {
	const calls: unknown[][] = [];
	return {
		calls,
		handle: {
			settings,
			imageProcessor: {
				processImage: async (...args: unknown[]): Promise<ArrayBuffer> => {
					calls.push(args);
					return produce();
				},
			},
		},
	};
}

// ------------------------------------------------------- 1. 目标格式与文件名
function namingTests(): void {
	check("扩展名：WEBP", targetExtension('WEBP'), 'webp');
	check("扩展名：JPEG", targetExtension('JPEG'), 'jpg');
	check("扩展名：PNG", targetExtension('PNG'), 'png');
	check("扩展名：AVIF", targetExtension('AVIF'), 'avif');
	check("扩展名：pngquant 出来的还是 png", targetExtension('PNGQUANT'), 'png');
	check("扩展名：不转换", targetExtension('NONE'), null);
	check("扩展名：只压缩原格式（不改名）", targetExtension('ORIGINAL'), null);
	check("扩展名：不认识", targetExtension('TIFF'), null);

	check("文件名：换扩展名", convertedFileName('pasted_image_20260927.png', 'WEBP'), 'pasted_image_20260927.webp');
	check("文件名：多点号只换最后一个", convertedFileName('a.b.c.jpeg', 'WEBP'), 'a.b.c.webp');
	check("文件名：没有扩展名", convertedFileName('图片', 'WEBP'), '图片.webp');
	check("文件名：格式不支持", convertedFileName('a.png', 'NONE'), null);

	// 命名前先问的一句：这张图最终是什么扩展名（导入那边据此给"转换后那一路"占位，
	// 否则同一秒里 png 与 jpg 会算出只差扩展名的两个名字，见 test/image-transfer.test.ts 第 3 节）
	const webpHandle = fakeConverter(() => webpBytes()).handle;
	check("交接扩展名：png 会转成 webp", handOffExtension(webpHandle, 'pasted_image_1.png'), 'webp');
	check("交接扩展名：jpg 也会转", handOffExtension(webpHandle, 'pasted_image_1.jpg'), 'webp');
	check("交接扩展名：已经是 webp 就不转", handOffExtension(webpHandle, 'pasted_image_1.webp'), null);
	check("交接扩展名：动图 gif 不转", handOffExtension(webpHandle, 'pasted_image_1.gif'), null);
	check("交接扩展名：没装 Image Converter", handOffExtension(null, 'pasted_image_1.png'), null);
	check("交接扩展名：预设是「不转换」",
		handOffExtension(fakeConverter(() => webpBytes(), settingsWith({ name: 'None', outputFormat: 'NONE' })).handle, 'a.png'),
		null);
	check("交接扩展名：设置里读不出预设", handOffExtension(fakeConverter(() => webpBytes(), {}).handle, 'a.png'), null);
}

// ------------------------------------------------------------ 2. 跳过模式
function patternTests(): void {
	check("跳过：*.gif 命中", matchesAnyPattern('pasted_image_1.gif', '*.gif'), true);
	check("跳过：*.gif 不误伤", matchesAnyPattern('pasted_image_1.png', '*.gif'), false);
	check("跳过：空模式不跳", matchesAnyPattern('a.gif', ''), false);
	check("跳过：逗号分隔（前后空格）」", matchesAnyPattern('b.bmp', ' *.gif , *.bmp '), true);
	check("跳过：逗号分隔时别的格式不跳", matchesAnyPattern('b.webp', ' *.gif , *.bmp '), false);
	check("跳过：* 不跨目录", matchesAnyPattern('sub/a.png', 'sub/*.png'), true);
	check("跳过：** 跨目录", matchesAnyPattern('a/b/c.png', '**/*.png'), true);
	check("跳过：? 一个字符", matchesAnyPattern('a1.png', 'a?.png'), true);
	check("跳过：点号是字面量", matchesAnyPattern('axpng', 'a.png'), false);
	check("跳过：大小写不敏感", matchesAnyPattern('A.GIF', '*.gif'), true);
	check("跳过：/正则/", matchesAnyPattern('img_2026.png', '/^img_\\d+\\.png$/'), true);
	check("跳过：r/正则/", matchesAnyPattern('img_2026.png', 'r/^img_\\d+\\.png$/'), true);
	check("跳过：regex: 前缀", matchesAnyPattern('img_2026.png', 'regex:^img_\\d+\\.png$'), true);
	check("跳过：坏正则不炸（当没命中）", matchesAnyPattern('a.png', '/([/'), false);
}

// ------------------------------------------------------------ 3. 预设读取
function presetTests(): void {
	const read = readConverterPreset(settingsWith(WEBP_PRESET));
	check("预设：选中项读出来", read?.values.outputFormat, 'WEBP');
	check("预设：质量", read?.values.quality, 75);
	check("预设：跳过模式", read?.values.skipConversionPatterns, '*.gif');
	check("预设：原始对象也带出来（要原样回传给转码器）", (read?.raw as Record<string, unknown>)?.name, 'WEBP(Exclude gif)');

	check("预设：没有设置", readConverterPreset(null), null);
	check("预设：没选中的名字", readConverterPreset({ conversionPresets: [WEBP_PRESET], selectedConversionPreset: '不存在' }), null);
	check("预设：输出格式为不转换", readConverterPreset(settingsWith({ ...WEBP_PRESET, outputFormat: 'NONE' })), null);
	check("预设：输出格式为只压缩原格式", readConverterPreset(settingsWith({ ...WEBP_PRESET, outputFormat: 'ORIGINAL' })), null);

	const sparse = readConverterPreset(settingsWith({ name: 'X', outputFormat: 'webp' }));
	check("预设：小写格式也认", sparse?.values.outputFormat, 'WEBP');
	check("预设：缺质量按 100", sparse?.values.quality, 100);
	check("预设：缺 resizeMode 按 None", sparse?.values.resizeMode, 'None');
	check("预设：缺尺寸按它自己的默认", sparse?.values.desiredWidth, 800);
	check("预设：缺跳过模式按空", sparse?.values.skipConversionPatterns, '');

	const noSavings = readConverterPreset({
		conversionPresets: [{ name: 'X', outputFormat: 'WEBP', minimumCompressionSavingsInKB: undefined }],
		selectedConversionPreset: 'X',
		minimumCompressionSavingsInKB: 5,
	});
	check("预设：预设里没有就用全局的", noSavings?.values.minimumCompressionSavingsInKB, 5);
	const negative = readConverterPreset(settingsWith({ ...WEBP_PRESET, minimumCompressionSavingsInKB: -1 }));
	check("预设：负数当默认 30", negative?.values.minimumCompressionSavingsInKB, 30);
	const inherited = readConverterPreset({
		conversionPresets: [{ name: 'X', outputFormat: 'WEBP' }],
		selectedConversionPreset: 'X',
		revertToOriginalIfLarger: true,
	});
	check("预设：退回开关可以从全局继承", inherited?.values.revertToOriginalIfLarger, true);
}

// ------------------------------------------------------------ 4. 魔数
function magicTests(): void {
	check("魔数：webp", looksLikeFormat(webpBytes(), 'WEBP'), true);
	check("魔数：png", looksLikeFormat(pngBytes(), 'PNG'), true);
	check("魔数：pngquant 也按 png 认", looksLikeFormat(pngBytes(), 'PNGQUANT'), true);
	check("魔数：jpeg", looksLikeFormat(jpegBytes(), 'JPEG'), true);
	check("魔数：avif", looksLikeFormat(avifBytes(), 'AVIF'), true);
	check("魔数：拿 png 冒充 webp（它转码失败时会原样返回输入）", looksLikeFormat(pngBytes(), 'WEBP'), false);
	check("魔数：太短", looksLikeFormat(new Uint8Array([0x52, 0x49]).buffer, 'WEBP'), false);
	check("魔数：不认识的格式一律 false", looksLikeFormat(pngBytes(), 'TIFF'), false);
}

// ------------------------------------------------------------ 5. 划算判定
function savingsTests(): void {
	const noRevert = readConverterPreset(settingsWith(WEBP_PRESET))!.values;
	check("划算：没开退回就用转换结果（哪怕更大）",
		shouldUseConverted(noRevert, 1000, 2000), true);

	const revert = readConverterPreset(settingsWith({
		...WEBP_PRESET, revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 30,
	}))!.values;
	check("划算：省得不够（<30KB）用原图", shouldUseConverted(revert, 50 * 1024, 45 * 1024), false);
	check("划算：省够了（>30KB）用转换结果", shouldUseConverted(revert, 100 * 1024, 60 * 1024), true);
	check("划算：刚好省到阈值", shouldUseConverted(revert, 100 * 1024, 70 * 1024), true);
	check("划算：转完更大用原图", shouldUseConverted(revert, 100 * 1024, 120 * 1024), false);
}

// ------------------------------------------------------------ 6. 找插件实例
function findTests(): void {
	check("找插件：app 上没有 plugins", findImageConverter({} as unknown as App), null);
	check("找插件：装了但没有这个 id",
		findImageConverter({ plugins: { plugins: {} } } as unknown as App), null);
	check("找插件：没有转码器",
		findImageConverter({ plugins: { plugins: { 'image-converter': { settings: {} } } } } as unknown as App), null);

	const instance = { settings: { a: 1 }, imageProcessor: { processImage: async () => new ArrayBuffer(0) } };
	const viaMap = findImageConverter({ plugins: { plugins: { 'image-converter': instance } } } as unknown as App);
	check("找插件：从 plugins 表里拿", viaMap === (instance as unknown as ConverterHandle), true);
	const viaGetter = findImageConverter({
		plugins: { plugins: {}, getPlugin: (id: string) => (id === 'image-converter' ? instance : null) },
	} as unknown as App);
	check("找插件：退回 getPlugin()", viaGetter === (instance as unknown as ConverterHandle), true);
}

// ------------------------------------------------------------ 7. 真转换
async function convertTests(): Promise<void> {
	// ① 转换成功：返回目标格式的字节与新文件名 —— **不碰仓库**（先转换、再落盘）
	{
		const { app, log } = createApp({ 'other.png': pngBytes() });
		const { handle, calls } = fakeConverter(() => webpBytes());
		const converted = await convertImageBytes(
			app, { name: 'a.png', bytes: pngBytes(), folder: 'attachments' }, handle,
		);
		check("转换：新文件名换成 webp", converted?.name, 'a.webp');
		check("转换：拿到的是 webp 字节", converted ? looksLikeFormat(converted.bytes, 'WEBP') : false, true);
		check("转换：自己一个文件都不建", log.created, []);
		check("转换：也不删任何东西", log.deleted, []);
		check("转换：格式传对", calls[0]?.[1], 'WEBP');
		check("转换：质量按它要的 0–1", calls[0]?.[2], 0.75);
		check("转换：colorDepth / resizeMode 照传", [calls[0]?.[3], calls[0]?.[4]], [1, 'None']);
		check("转换：尺寸与缩放照传", [calls[0]?.[5], calls[0]?.[6], calls[0]?.[7], calls[0]?.[8]], [800, 600, 1000, 'Auto']);
		check("转换：预设对象原样回传（它靠这个取 pngquant / ffmpeg 路径）",
			(calls[0]?.[10] as Record<string, unknown>)?.name, 'WEBP(Exclude gif)');
		check("转换：插件设置也回传", typeof calls[0]?.[11], 'object');
	}

	// ② 已经是目标格式：不再压一遍（避免代际失真）
	{
		const { app } = createApp();
		const { handle, calls } = fakeConverter(() => webpBytes());
		check("转换：已是 webp 不动它",
			await convertImageBytes(app, { name: 'a.webp', bytes: webpBytes() }, handle), null);
		check("转换：已是 webp 不调转码器", calls.length, 0);
	}

	// ③ 预设的跳过模式（*.gif）：动图不能转
	{
		const { app } = createApp();
		const { handle, calls } = fakeConverter(() => webpBytes());
		check("转换：*.gif 跳过",
			await convertImageBytes(app, { name: 'a.gif', bytes: pngBytes() }, handle), null);
		check("转换：*.gif 不调转码器", calls.length, 0);
	}

	// ④ 转码器原样返回输入（它内部失败时的行为）→ 魔数不对，按原格式导入
	{
		const { app } = createApp();
		const { handle } = fakeConverter(() => pngBytes());
		check("转换：结果不是 webp 就放弃",
			await convertImageBytes(app, { name: 'a.png', bytes: pngBytes() }, handle), null);
	}

	// ⑤ 撞名：目标文件名已被占用（宁可按原格式导入，也不覆盖）
	{
		const { app } = createApp({ 'attachments/a.webp': webpBytes('existing') });
		const { handle } = fakeConverter(() => webpBytes());
		check("转换：撞名就放弃",
			await convertImageBytes(app, { name: 'a.png', bytes: pngBytes(), folder: 'attachments' }, handle), null);
	}

	// ⑥ 不划算（预设开了"省得不够就用原图"）：原图 50 KB，转出来还有 45 KB —— 只省 5 KB
	{
		const settings = settingsWith({ ...WEBP_PRESET, revertToOriginalIfLarger: true, minimumCompressionSavingsInKB: 30 });
		const { app } = createApp();
		const { handle } = fakeConverter(() => webpBytes('x'.repeat(45 * 1024)), settings);
		check("转换：省得不够就按原图",
			await convertImageBytes(app, { name: 'a.png', bytes: new Uint8Array(50 * 1024).buffer }, handle), null);
	}

	// ⑦ 转码器抛异常：吞掉，按原格式导入
	{
		const { app } = createApp();
		const handle: ConverterHandle = {
			settings: settingsWith(WEBP_PRESET),
			imageProcessor: { processImage: async () => { throw new Error('boom'); } },
		};
		check("转换：转码器抛异常 → null",
			await convertImageBytes(app, { name: 'a.png', bytes: pngBytes() }, handle), null);
	}

	// ⑧ 根本没装 / 预设是"不转换"
	{
		const { app } = createApp();
		check("转换：没有转码器", await convertImageBytes(app, { name: 'a.png', bytes: pngBytes() }, null), null);
		const none = fakeConverter(() => webpBytes(), settingsWith({ name: 'None', outputFormat: 'NONE' }));
		check("转换：预设是 NONE",
			await convertImageBytes(app, { name: 'a.png', bytes: pngBytes() }, none.handle), null);
		check("转换：NONE 时也不调转码器", none.calls.length, 0);
	}

	// ⑨ 根目录（没有附件夹）：路径算出来是 `a.webp`
	{
		const { app } = createApp({ 'a.webp': webpBytes('existing') });
		const { handle } = fakeConverter(() => webpBytes());
		check("转换：根目录也会查撞名",
			await convertImageBytes(app, { name: 'a.png', bytes: pngBytes() }, handle), null);
	}
}

// ------------------------------------------------ 8. 没装插件时的退路与提示
function fallbackTests(): void {
	// 设置里的目标格式 → 传给转码器的格式
	check("目标格式：跟随预设", vaultConvertOverride('preset'), undefined);
	check("目标格式：大小写无所谓", vaultConvertOverride('PRESET'), undefined);
	check("目标格式：空值也表示不覆盖", vaultConvertOverride(''), undefined);
	check("目标格式：点名 webp", vaultConvertOverride('webp'), 'WEBP');
	check("目标格式：点名 jpg", vaultConvertOverride('jpg'), 'JPEG');
	check("目标格式：认不出来的不覆盖（宁可照预设走）", vaultConvertOverride('bmp'), undefined);

	// 提示文案里的格式标签
	check("标签：webp", formatLabel('WEBP'), 'webp');
	check("标签：jpeg 说成 jpg", formatLabel('JPEG'), 'jpg');
	check("标签：认不出来就原样", formatLabel('NONE'), 'NONE');

	// 该不该转
	const webp = readConverterPreset(settingsWith(WEBP_PRESET))!.values;
	check("该转：png → webp", shouldConvertFile('a.png', webp), true);
	check("该转：bmp → webp", shouldConvertFile('a.bmp', webp), true);
	check("不转：已经是 webp", shouldConvertFile('a.webp', webp), false);
	check("不转：动图 gif（转了只有一帧）", shouldConvertFile('a.gif', webp), false);
	check("不转：没有扩展名", shouldConvertFile('图片', webp), false);
	check("不转：命中预设的跳过模式", shouldConvertFile('a.gif', webp), false);
	const nonePreset = readConverterPreset(settingsWith({ name: 'None', outputFormat: 'NONE' }));
	check("不转：预设是「不转换」时读不出预设", nonePreset, null);

	// 全库筛选
	const files = [
		{ name: 'a.png', extension: 'png' },
		{ name: 'b.webp', extension: 'webp' },
		{ name: 'c.gif', extension: 'gif' },
		{ name: 'd.svg', extension: 'svg' },   // 矢量图不归它管
		{ name: 'e.jpg', extension: 'jpg' },
		{ name: 'f.md', extension: 'md' },
	];
	check("全库筛选：只留下该转的",
		selectConvertibleImages(files, webp).map(f => f.name), ['a.png', 'e.jpg']);

	// 提示只出现一次
	const said: string[] = [];
	const hint = new ConversionHint(message => said.push(message));
	check("提示：第一次不说", said.length, 0);
	hint.maybeShow();
	check("提示：这一次说了", said.length, 1);
	check("提示：内容是让人去装 image converter", said[0]?.includes('image converter') ?? false, true);
	hint.maybeShow();
	check("提示：同一会话不重复", said.length, 1);
	hint.forget();
	hint.maybeShow();
	check("提示：忘了之后能再说一次", said.length, 2);
}

// ------------------------------------------------------------ 9. 全库单张转换
async function vaultConvertTests(): Promise<void> {
	// ① 转好之后：改名（换扩展名）+ 写回内容，链接由 Obsidian 跟着改
	{
		const { app, files, log } = createApp({ 'attachments/a.png': pngBytes() });
		const { handle } = fakeConverter(() => webpBytes());
		const name = await convertVaultImage(app, tf('attachments/a.png'), handle);
		check("全库转换：返回新文件名", name, 'a.webp');
		check("全库转换：改名走 Obsidian（链接会自动更新）", log.renamed, ['attachments/a.png -> attachments/a.webp']);
		check("全库转换：新内容写回去了", log.modified, ['attachments/a.webp']);
		check("全库转换：新文件是 webp", looksLikeFormat(files.get('attachments/a.webp') ?? new ArrayBuffer(0), 'WEBP'), true);
		check("全库转换：旧文件没了", files.has('attachments/a.png'), false);
	}

	// ② 已经是目标格式 / 动图 / 没装插件：一律不动文件
	{
		const a = createApp({ 'a.webp': webpBytes() });
		const { handle } = fakeConverter(() => webpBytes());
		check("全库转换：已是 webp 不动",
			await convertVaultImage(a.app, tf('a.webp'), handle), null);
		check("全库转换：已是 webp 不改名", a.log.renamed, []);

		const b = createApp({ 'b.gif': pngBytes() });
		check("全库转换：gif 不动", await convertVaultImage(b.app, tf('b.gif'), handle), null);
		check("全库转换：gif 不改名", b.log.renamed, []);

		const c = createApp({ 'c.png': pngBytes() });
		check("全库转换：没有插件就不动", await convertVaultImage(c.app, tf('c.png'), null), null);
		check("全库转换：没有插件不改名", c.log.renamed, []);
	}
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 目标格式与文件名 ===");
namingTests();

console.log("=== 2. 跳过模式 ===");
patternTests();

console.log("=== 3. 预设读取 ===");
presetTests();

console.log("=== 4. 魔数 ===");
magicTests();

console.log("=== 5. 划算判定 ===");
savingsTests();

console.log("=== 6. 找插件实例 ===");
findTests();

console.log("=== 7. 真转换 ===");
await convertTests();

console.log("=== 8. 没装插件时的退路与提示 ===");
fallbackTests();

console.log("=== 9. 全库单张转换 ===");
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
