import { App, TFile } from 'obsidian';
import { MANAGED_IMAGE_EXTENSIONS } from './constants';
import { vaultPathFor } from './naming';

/**
 * 「导入 / 全库的图片交给 Image Converter 转格式」。
 *
 * ## 为什么需要这一层
 *
 * Image Converter（xRyul）只在**剪贴板里带图片文件**的粘贴上自动转换：它的 `editor-paste`
 * 钩子看到 `kind === "file"` 的图片项才动手（而且它一旦接手就 `preventDefault`，正文文字它是不管的）。
 * 我们处理的是正文里的 `file:///D:\…` **文本路径**与仓库里已有的图片，它的钩子看不到，
 * 于是图片进了库却一直是 png/jpg（2026-09 用户报的"图片进了库但没转 webp"，全库 108 张非 webp 都是这么来的）。
 *
 * ## 只借转码器与预设，不借粘贴
 *
 * 它的单图处理是**弹窗驱动**的（`Process Image: xxx` 那种），没法自动调用；能自动调用的只有
 * 它内部那句转码：
 *
 * ```js
 * imageProcessor.processImage(blob, preset.outputFormat, preset.quality / 100, …,
 *                             preset, settings)
 * ```
 *
 * 所以我们只调这一句（同一个转码器、同一份预设 —— 出来的字节与"粘贴让它转"完全一致），
 * **改名与写链接由我们自己做**：不必先保存笔记、不会触发它"全库正则替换链接"
 * （`updateLinksInAllNotes` 是 `vault.read` + `vault.modify`，对我们这种还没落盘的编辑器改动
 * 只会帮倒忙），也不碰系统剪贴板、不往撤销历史里塞东西。
 *
 * ## 一切失败都退回原样
 *
 * 它没装 / 没启用 / 方法改名 / 预设是"不转换" / 撞名 / 转出来不是目标格式 —— 全部返回 `null`，
 * 调用方按原格式留着图片。**图片一定丢不了**，转格式只是锦上添花。
 */

/** 转换预设里我们用得上的字段（都做了收敛，缺失时按它自己的默认值兜底） */
export interface ConverterPreset {
	/** `WEBP` / `JPEG` / `PNG` / `AVIF` / `PNGQUANT`；`NONE`、`ORIGINAL` 表示不转换 */
	outputFormat: string;
	/** 0–100（它内部要的是 0–1，调用前除以 100） */
	quality: number;
	colorDepth: number;
	resizeMode: string;
	desiredWidth: number;
	desiredHeight: number;
	desiredLongestEdge: number;
	enlargeOrReduce: string;
	allowLargerFiles: boolean;
	/** 转完没省下多少（或更大）时用回原图 —— 判定见 `shouldUseConverted` */
	revertToOriginalIfLarger: boolean;
	/** 「至少省这么多 KB」，默认 30（它自己的默认值） */
	minimumCompressionSavingsInKB: number;
	/** 跳过的文件名模式（逗号分隔，支持 `*` `?` 通配与 `/正则/`），例如 `*.gif` */
	skipConversionPatterns: string;
}

/** Image Converter 的插件实例里我们用到的那两块（未类型化的内部 API，全部按结构访问） */
export interface ConverterHandle {
	settings: unknown;
	imageProcessor: { processImage: (...args: unknown[]) => unknown };
}

/** 没装它 / 预设读不出来、但用户点名要某个格式时用的参数（照它自己的默认：质量 100、不缩放） */
const FALLBACK_VALUES: Omit<ConverterPreset, 'outputFormat'> = {
	quality: 100,
	colorDepth: 1,
	resizeMode: 'None',
	desiredWidth: 800,
	desiredHeight: 600,
	desiredLongestEdge: 1000,
	enlargeOrReduce: 'Auto',
	allowLargerFiles: false,
	revertToOriginalIfLarger: false,
	minimumCompressionSavingsInKB: 30,
	skipConversionPatterns: '',
};

/** 认出来的目标格式 → 扩展名；`null` 表示这个格式我们不接（不转换或未知） */
export function targetExtension(format: string): string | null {
	switch (format) {
		case 'WEBP': return 'webp';
		case 'JPEG': return 'jpg';
		case 'PNG': return 'png';
		case 'AVIF': return 'avif';
		// pngquant 是 PNG 的压缩器，出来的还是 PNG
		case 'PNGQUANT': return 'png';
		default: return null;
	}
}

/** 文件名的小写扩展名（没有点号时为空串） */
function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
}

/**
 * 设置里的「目标格式」→ 传给转码器的格式。
 *
 * `preset`（`跟随 Image Converter 的预设`）与空值都返回 `undefined` —— 表示不覆盖，
 * 用它当前选中的预设；认不出来的值同样不覆盖（宁可照预设走，也不要瞎猜）。
 */
export function vaultConvertOverride(setting: string): string | undefined {
	const value = (setting ?? '').trim().toUpperCase();
	if (value === '' || value === 'PRESET') return undefined;
	// 设置里写 `jpg`，它内部叫 `JPEG` —— 这类别名在这里对齐
	const aliases: Record<string, string> = {
		WEBP: 'WEBP', JPG: 'JPEG', JPEG: 'JPEG', PNG: 'PNG', AVIF: 'AVIF',
	};
	return aliases[value];
}

/** 格式的小写标签（提示文案里用：`WEBP` → `webp`） */
export function formatLabel(format: string): string {
	return targetExtension(format) ?? format;
}

/** 同名的目标格式文件名（`a.png` → `a.webp`）；没有扩展名映射时返回 `null` */
export function convertedFileName(name: string, format: string): string | null {
	const ext = targetExtension(format);
	if (!ext) return null;
	const dot = name.lastIndexOf('.');
	const stem = dot > 0 ? name.substring(0, dot) : name;
	if (!stem) return null;
	return `${stem}.${ext}`;
}

/**
 * 文件名是否命中它的跳过模式（语义照抄 `FolderAndFilenameManagement.matchesPattern`）：
 *
 * - `/正则/`、`r/正则/`、`regex:正则` → 不区分大小写的正则；
 * - 其余按通配：`*` 不跨 `/`、`**` 跨、`?` 一个字符，首尾锚定，`.` 转义。
 *
 * 最要紧的一条是预设 `WEBP(Exclude gif)` 里的 `*.gif`：**动图不能转**。
 */
export function matchesAnyPattern(name: string, patterns: string): boolean {
	const list = patterns.split(',').map(p => p.trim()).filter(p => p.length > 0);
	if (list.length === 0) return false;
	for (const pattern of list) {
		try {
			if (pattern.startsWith('/') && pattern.endsWith('/')) {
				if (new RegExp(pattern.slice(1, -1), 'i').test(name)) return true;
				continue;
			}
			if (pattern.startsWith('r/') && pattern.endsWith('/')) {
				if (new RegExp(pattern.slice(2, -1), 'i').test(name)) return true;
				continue;
			}
			if (pattern.startsWith('regex:')) {
				if (new RegExp(pattern.slice(6), 'i').test(name)) return true;
				continue;
			}
			// `**` 先换成哨兵再做单星号替换（它自己的实现也是这个套路）
			const glob = pattern
				.replace(/\./g, '\\.')
				.replace(/\*\*/g, '@@DOUBLESTAR@@')
				.replace(/\*/g, '[^/]*')
				.replace(/@@DOUBLESTAR@@/g, '.*')
				.replace(/\?/g, '.');
			if (new RegExp(`^${glob}$`, 'i').test(name)) return true;
		} catch {
			// 它自己遇到坏正则也是"跳过这一条"，不炸
			continue;
		}
	}
	return false;
}

/**
 * 从它的 data.json 里读出当前选中的转换预设。
 *
 * @param formatOverride 点名要某个格式（`WEBP` / `JPEG` / `PNG` / `AVIF`…）：此时**不看预设里的格式**，
 *   但质量、缩放、跳过模式这些仍照预设来；连预设都没有（它没装、或预设是"不转换"）时用 `FALLBACK_VALUES`
 * @returns 不转换 / 格式不认识时 `null`
 */
export function readConverterPreset(
	settings: unknown,
	formatOverride?: string
): { values: ConverterPreset; raw: unknown } | null {
	const bag = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
	const list = Array.isArray(bag.conversionPresets) ? bag.conversionPresets : [];
	const wanted = typeof bag.selectedConversionPreset === 'string' ? bag.selectedConversionPreset : '';
	const raw = list.find(item => !!item && typeof item === 'object'
		&& (item as Record<string, unknown>).name === wanted) as Record<string, unknown> | undefined;

	const override = typeof formatOverride === 'string' && formatOverride !== ''
		? formatOverride.toUpperCase()
		: '';
	if (!raw && !override) return null;

	const preset = raw ?? {};
	const format = override !== ''
		? override
		: (typeof preset.outputFormat === 'string' ? preset.outputFormat.toUpperCase() : '');
	if (!targetExtension(format)) return null;

	const num = (value: unknown, fallback: number): number =>
		typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	const savings = num(preset.minimumCompressionSavingsInKB, num(bag.minimumCompressionSavingsInKB, 30));

	return {
		values: {
			outputFormat: format,
			// 质量按它的链条兜底：预设 → 它设置里的全局质量 → 100（它自己的默认）
			quality: num(preset.quality, num(bag.quality, FALLBACK_VALUES.quality)),
			colorDepth: num(preset.colorDepth, FALLBACK_VALUES.colorDepth),
			resizeMode: typeof preset.resizeMode === 'string' ? preset.resizeMode : FALLBACK_VALUES.resizeMode,
			desiredWidth: num(preset.desiredWidth, FALLBACK_VALUES.desiredWidth),
			desiredHeight: num(preset.desiredHeight, FALLBACK_VALUES.desiredHeight),
			desiredLongestEdge: num(preset.desiredLongestEdge, FALLBACK_VALUES.desiredLongestEdge),
			enlargeOrReduce: typeof preset.enlargeOrReduce === 'string'
				? preset.enlargeOrReduce
				: FALLBACK_VALUES.enlargeOrReduce,
			allowLargerFiles: preset.allowLargerFiles === true,
			revertToOriginalIfLarger: preset.revertToOriginalIfLarger === undefined
				? bag.revertToOriginalIfLarger === true
				: preset.revertToOriginalIfLarger === true,
			// 它自己的规矩：负数 / 非数字都当默认的 30
			minimumCompressionSavingsInKB: savings >= 0 ? savings : 30,
			skipConversionPatterns: typeof preset.skipConversionPatterns === 'string'
				? preset.skipConversionPatterns
				: FALLBACK_VALUES.skipConversionPatterns,
		},
		raw,
	};
}

/**
 * 这张图该不该转（纯判定）。
 *
 * 两条比"预设说什么"更硬的规矩：
 * - **已经是目标格式的不转** —— 再压一遍只会一代比一代糊；
 * - **`.gif` 一律不转** —— canvas 转出来的 webp 只有一帧，动图会被拍成一张静图，
 *   这是不可逆的损坏，宁可留给 Image Converter 自己去转。
 */
export function shouldConvertFile(name: string, values: ConverterPreset): boolean {
	const ext = targetExtension(values.outputFormat);
	if (!ext) return false;
	const current = extensionOf(name);
	if (current === '') return false;
	if (current === ext) return false;
	if (current === 'gif') return false;
	return !matchesAnyPattern(name, values.skipConversionPatterns);
}

/** 转换结果是不是真的那个格式（按魔数认，别信它返回了什么） */
export function looksLikeFormat(bytes: ArrayBuffer, format: string): boolean {
	const head = new Uint8Array(bytes.slice(0, 16));
	if (head.length < 12) return false;
	const ascii = (from: number, to: number): string =>
		Array.from(head.slice(from, to)).map(code => String.fromCharCode(code)).join('');

	switch (format) {
		case 'WEBP':
			return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
		case 'PNG':
		case 'PNGQUANT':
			return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
		case 'JPEG':
			return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
		case 'AVIF': {
			if (ascii(4, 8) !== 'ftyp') return false;
			const brand = ascii(8, 12).toLowerCase();
			return brand === 'avif' || brand === 'avis';
		}
		default:
			return false;
	}
}

/**
 * 转出来的字节要不要用（照抄它的判定，见 `handlePaste` 里那段）。
 *
 * 它只在预设开了「转完更大就用原图」时才有这一关：没省下 `minimumCompressionSavingsInKB`
 * （默认 30 KB）就算不划算 —— 小图（20 KB 的截图）转完常常一点没省，于是保持原样。
 */
export function shouldUseConverted(
	preset: ConverterPreset,
	originalSize: number,
	convertedSize: number
): boolean {
	if (!preset.revertToOriginalIfLarger) return true;
	return convertedSize + 1024 * preset.minimumCompressionSavingsInKB <= originalSize;
}

/** 扩展名 → MIME（它自己会按魔数再认一遍，这里只是别塞个明显不对的） */
function mimeForExtension(ext: string): string {
	switch (ext.toLowerCase()) {
		case 'png': return 'image/png';
		case 'jpg':
		case 'jpeg': return 'image/jpeg';
		case 'gif': return 'image/gif';
		case 'bmp': return 'image/bmp';
		case 'webp': return 'image/webp';
		case 'avif': return 'image/avif';
		case 'heic':
		case 'heif': return 'image/heic';
		case 'tif':
		case 'tiff': return 'image/tiff';
		default: return 'application/octet-stream';
	}
}

/** 它的返回值可能是 ArrayBuffer，也可能是 TypedArray 视图 —— 统一成 ArrayBuffer */
function toArrayBuffer(value: unknown): ArrayBuffer | null {
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) {
		const view = value;
		return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
	}
	return null;
}

/**
 * 「转换不可用」提示：**一次会话只提示一次**。
 *
 * 没装 / 没启用 Image Converter 时，图片照样导得进来，只是保持原格式 —— 这是设计上的退路，
 * 不是错误。但用户默认开着「导入的图片交给 Image Converter 转格式」，什么都不说会让人
 * 以为功能坏了（2026-09 用户就是这么攒下一堆 png 的），所以真因为"没有它"而按原格式导入时
 * 提示一句，之后不再打扰。
 */
export class ConversionHint {
	private shown = false;
	private readonly notify: (message: string) => void;

	constructor(notify: (message: string) => void) {
		this.notify = notify;
	}

	/** 提示一次「没检测到 image converter」；本会话已经提示过就什么都不做 */
	maybeShow(): void {
		if (this.shown) return;
		this.shown = true;
		this.notify('ℹ️ 没检测到 image converter：导入的图片会保持原格式（png/jpg）。装上它就能自动转 webp —— 在社区插件市场搜 "image converter" 即可。');
	}

	/** 忘掉"已经提示过"（测试用） */
	forget(): void {
		this.shown = false;
	}
}

/**
 * 找到 Image Converter 的插件实例（`app.plugins` 不在公开类型里，按结构取）。
 *
 * 拿不到实例、或它的转码器不是函数（版本对不上 / 改了名）→ `null`，调用方按原样导入。
 */
export function findImageConverter(app: App): ConverterHandle | null {
	const manager = (app as unknown as {
		plugins?: { plugins?: Record<string, unknown>; getPlugin?: (id: string) => unknown };
	}).plugins;
	if (!manager) return null;

	const fromMap = manager.plugins?.['image-converter'];
	const instance = fromMap ?? manager.getPlugin?.('image-converter');
	if (!instance || typeof instance !== 'object') return null;

	const candidate = instance as { imageProcessor?: { processImage?: unknown } };
	if (typeof candidate.imageProcessor?.processImage !== 'function') return null;
	return candidate as unknown as ConverterHandle;
}

/** 一次转换计划：预设参数 + 目标文件名 + 目标扩展名 */
interface ConversionPlan {
	values: ConverterPreset;
	raw: unknown;
	/** 转换后的文件名（与源文件名同词干、换扩展名） */
	targetName: string;
	/** 目标扩展名（小写、不带点），例如 `webp` */
	extension: string;
}

/**
 * 这张图交给转码器会怎么转（纯判定，不读字节、不碰仓库）。
 *
 * **判定只有这一处**：`convertImageBytes` 照它决定转不转、写什么名字，
 * `handOffExtension` 拿它回答"这张图最终是什么格式"。
 */
function planConversion(
	handle: ConverterHandle | null,
	sourceName: string,
	formatOverride?: string
): ConversionPlan | null {
	if (!handle) return null;
	const preset = readConverterPreset(handle.settings, formatOverride);
	if (!preset) return null;
	const { values, raw } = preset;
	if (!shouldConvertFile(sourceName, values)) return null;
	const targetName = convertedFileName(sourceName, values.outputFormat);
	const extension = targetExtension(values.outputFormat);
	if (!targetName || !extension) return null;
	return { values, raw, targetName, extension };
}

/**
 * 这张图最终会是什么扩展名（`webp` / `jpg`…，不带点）：没装、预设不转换、
 * 跳过模式命中、已经是目标格式时返回 `null`（= 按原格式导入）。
 *
 * 用途只有一个 —— 起名字**之前**先问一句（`transfer.ts` 的导入循环）：交接转格式时
 * 落盘的是目标格式那个名字，命名得把"转换后那一路"也占上。同一个词干下两张源格式不同的图
 * （png + jpg）落在同一秒时，只检查源格式的名字会让第二张转出来的 `.webp` 撞上第一张，
 * 转码器撞名即放弃 —— 于是"只有第一张转了 webp，后面几张还是 png/jpg"（2026-09 用户报的）。
 *
 * @param fileName 源格式的文件名：判"是不是已经是目标格式"、跳过模式命中与否都看它
 */
export function handOffExtension(
	handle: ConverterHandle | null,
	fileName: string,
	formatOverride?: string
): string | null {
	return planConversion(handle, fileName, formatOverride)?.extension ?? null;
}

/**
 * 全库扫描用：这批文件里哪些该转换（纯判定，便于测试）。
 *
 * 只认本插件受管的位图格式（`MANAGED_IMAGE_EXTENSIONS`：svg 这类矢量图不在其中），
 * 再叠上 `shouldConvertFile` 的规矩（已是目标格式 / `.gif` / 命中跳过模式 → 不转）。
 */
export function selectConvertibleImages<T extends { name: string; extension: string }>(
	files: T[],
	values: ConverterPreset
): T[] {
	const managed = new Set<string>(MANAGED_IMAGE_EXTENSIONS);
	return files.filter(file => managed.has(file.extension.toLowerCase()) && shouldConvertFile(file.name, values));
}

/**
 * 把**一张还没落盘的图片**交给它的转码器，转成功就返回目标格式的字节与新文件名。
 *
 * "先转换、再落盘"是刻意的：如果先按原格式写进仓库再转换，中间那一刻会多出一个
 * 谁也指不到的 png（同步插件可能已经把它传走了），转完还得把它删掉 ——
 * 走内存既没有中转文件，也不需要删除步骤。
 *
 * @param input 原文件名（含扩展名，用来判格式与跳过模式）、原始字节，以及要落到哪个附件夹
 * @param formatOverride 点名要某个格式（不给就用它当前预设的格式）
 * @returns 转换后的文件名 + 字节；没转（没装 / 预设不转换 / 跳过 / 撞名 / 失败 / 不划算）时 `null`
 */
export async function convertImageBytes(
	app: App,
	input: { name: string; bytes: ArrayBuffer; folder?: string },
	handle: ConverterHandle | null,
	formatOverride?: string
): Promise<{ name: string; bytes: ArrayBuffer } | null> {
	if (!handle) return null;

	try {
		// 转不转、叫什么名字：判定与 `handOffExtension` 共用一份（见 `planConversion`）
		const plan = planConversion(handle, input.name, formatOverride);
		if (!plan) return null;
		const { values, raw, targetName } = plan;

		const folder = input.folder ?? '';
		const targetPath = vaultPathFor(folder, targetName);
		// 撞名就放弃：宁可按原格式留着，也不覆盖仓库里已有的文件
		if (app.vault.getAbstractFileByPath(targetPath)) return null;

		const blob = new Blob([input.bytes], { type: mimeForExtension(extensionOf(input.name)) });
		const produced = await handle.imageProcessor.processImage(
			blob,
			values.outputFormat,
			values.quality / 100,
			values.colorDepth,
			values.resizeMode,
			values.desiredWidth,
			values.desiredHeight,
			values.desiredLongestEdge,
			values.enlargeOrReduce,
			values.allowLargerFiles,
			raw,
			handle.settings
		);

		const bytes = toArrayBuffer(produced);
		if (!bytes || bytes.byteLength === 0) return null;
		// 转码失败时它会**原样返回输入**，所以必须自己认一遍魔数
		if (!looksLikeFormat(bytes, values.outputFormat)) return null;
		if (!shouldUseConverted(values, input.bytes.byteLength, bytes.byteLength)) return null;

		return { name: targetName, bytes };
	} catch (err) {
		console.error('⚠️ 交给 Image Converter 转换时出错，按原格式处理这张图', err);
		return null;
	}
}

/**
 * 转换**仓库里已有的一张图片**：转好之后改名（换扩展名）并写回内容。
 *
 * 改名走 Obsidian 自己的 `fileManager.renameFile` —— 它会跟着更新全库链接
 * （wikilink、Markdown 链接、canvas），比我们自己写正则替换靠谱得多；
 * 这也是 Image Converter 批量转换时用的同一套顺序（先改名、再写新内容）。
 *
 * @returns 转换后的文件名；没转 / 转不动时 `null`
 */
export async function convertVaultImage(
	app: App,
	file: TFile,
	handle: ConverterHandle | null,
	formatOverride?: string
): Promise<string | null> {
	if (!handle) return null;

	const converted = await convertImageBytes(
		app,
		{
			name: file.name,
			bytes: await app.vault.readBinary(file),
			folder: file.parent?.path ?? '',
		},
		handle,
		formatOverride
	);
	if (!converted) return null;

	const folder = file.parent?.path ?? '';
	const newPath = vaultPathFor(folder, converted.name);
	await app.fileManager.renameFile(file, newPath);

	const renamed = app.vault.getAbstractFileByPath(newPath);
	if (!(renamed instanceof TFile)) return null;
	await app.vault.modifyBinary(renamed, converted.bytes);
	return converted.name;
}
