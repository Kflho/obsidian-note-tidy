import { App, TFile } from 'obsidian';
import { MANAGED_IMAGE_EXTENSIONS } from './constants';
import { vaultPathFor } from './naming';

/**
 * 图片格式转换（**自带编码器**，不依赖任何别的插件）。
 *
 * ## 为什么要自己写
 *
 * 以前这一层是借 Image Converter 的转码器（`imageProcessor.processImage`）：
 * 解码、缩放、编码都由它做。但它那边的粘贴处理是**并发**跑的（`handlePaste` 里
 * `files.map(async …)`，一批图各算各的输出名，同一秒算出来的名字撞在一起），
 * 2026-09 用户实测"粘两张图只剩第一张 / `File already exists`"；它的转码器也经不起
 * 两次调用叠在一起。与其隔着插件边界求它别并发，不如自己来：
 *
 * - **编码用浏览器自带的 canvas**（`canvas.toBlob('image/webp', quality)`）——
 *   这正是它转 webp/jpg/png 用的东西，几十行就够，没有额外依赖、没有许可证问题；
 * - **一次一张、名字不撞**：调用方（`transfer.ts` 的导入、「粘贴图片」、两条转换命令、
 *   「整理图片」）本来就一张一张 `await`，这里不需要额外的队列。
 *
 * 它真正比我们多出来的能力（AVIF 走 ffmpeg、pngquant、HEIC/TIFF 解码、非破坏性缩放）
 * 我们不做：解不了的格式按原样留着，用户要那些就继续用 Image Converter 自己。
 *
 * ## 三条硬规矩
 *
 * 1. **`.gif` 一律不转** —— canvas 转出来只有一帧，动图会被拍成静图，那是不可逆的损坏；
 * 2. **已经是目标格式的不再压一遍**（代际失真）；
 * 3. **转完更大就留原图** —— 小图（已经是压缩过的截图）转完常常更大，
 *    留着原格式比"统一格式"重要。
 */

/** 我们自己能编出来的目标格式（浏览器 canvas 的编码器就这三种） */
export type ConvertFormat = 'WEBP' | 'JPEG' | 'PNG';

/** 一次转换要用的参数：目标格式 + 质量 */
export interface ConvertPlan {
	format: ConvertFormat;
	/** 0–100（canvas 的 `toBlob` 要 0–1，调用前除以 100） */
	quality: number;
}

/** 编码器：把字节转成目标格式。默认实现用 canvas，测试里换成替身 */
export type EncodeImage = (request: EncodeRequest) => Promise<ArrayBuffer | null>;

/** 交给编码器的东西 */
export interface EncodeRequest {
	bytes: ArrayBuffer;
	/** 源 MIME（照扩展名给；解码器自己会按魔数再认一遍） */
	sourceMime: string;
	/** 目标 MIME */
	targetMime: string;
	/** 0–100 */
	quality: number;
}

/** 目标格式 → MIME */
const MIME_FOR_FORMAT: Record<ConvertFormat, string> = {
	WEBP: 'image/webp',
	JPEG: 'image/jpeg',
	PNG: 'image/png',
};

/** 认出来的目标格式 → 扩展名；`null` 表示这个格式我们不接 */
export function targetExtension(format: string): string | null {
	switch (format) {
		case 'WEBP': return 'webp';
		case 'JPEG': return 'jpg';
		case 'PNG': return 'png';
		default: return null;
	}
}

/**
 * 设置里的「目标格式」+「转换质量」→ 转换计划；认不出来时 `null`（= 这一步不做）。
 *
 * 手改过 data.json、老版本留下的 `preset` / `avif` 都在这里被挡下 —— 宁可什么都不转，
 * 也不猜一个格式下手。四个调用方（导入 / 粘贴 / 两条命令 / 整理图片）共用这一份收敛。
 */
export function convertPlanFrom(formatSetting: string, qualitySetting: string): ConvertPlan | null {
	const raw = (formatSetting ?? '').trim().toUpperCase();
	const format: ConvertFormat | null =
		raw === 'WEBP' ? 'WEBP'
			: raw === 'JPG' || raw === 'JPEG' ? 'JPEG'
				: raw === 'PNG' ? 'PNG'
					: null;
	if (!format) return null;

	const quality = Number((qualitySetting ?? '').trim());
	return { format, quality: Number.isFinite(quality) ? Math.min(100, Math.max(1, Math.round(quality))) : 75 };
}

/** 格式的小写标签（提示文案里用：`WEBP` → `webp`） */
export function formatLabel(format: string): string {
	return targetExtension(format) ?? format;
}

/** 文件名的小写扩展名（没有点号时为空串） */
function extensionOf(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.substring(dot + 1).toLowerCase() : '';
}

/** 扩展名 → MIME */
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
 * 这张图该不该转（纯判定）。
 *
 * - **已经是目标格式的不转**（再压一遍只会一代比一代糊）；
 * - **`.gif` 一律不转**（动图会被拍成一张静图，不可逆）；
 * - 没有扩展名 / 不在受管位图清单里的不转（svg 这类矢量图当文本处理更合适）。
 */
export function shouldConvertFile(name: string, plan: ConvertPlan | null): boolean {
	if (!plan) return false;
	const ext = targetExtension(plan.format);
	if (!ext) return false;
	const current = extensionOf(name);
	if (current === '') return false;
	if (current === ext) return false;
	if (current === 'gif') return false;
	return (MANAGED_IMAGE_EXTENSIONS as readonly string[]).includes(current);
}

/**
 * 这张图最终会是什么扩展名（不带点）：会转格式就是目标格式那个，不转时 `null`。
 *
 * 用途只有一个 —— 起名字**之前**先问一句（`transfer.ts` 的导入循环）：落盘的是
 * 目标格式那个文件，命名就得按最终扩展名来。按源扩展名生成会出这种事：同一秒里的
 * png 与 jpg 只差扩展名，两个名字各自"没被占"，可两张最终都叫 `xxx.webp`
 * （2026-09 用户报的"粘贴多张图只有第一张转了 webp"）。
 */
export function plannedExtension(fileName: string, plan: ConvertPlan | null): string | null {
	if (!plan || !shouldConvertFile(fileName, plan)) return null;
	return targetExtension(plan.format);
}

/** 全库扫描用：这批文件里哪些该转换（纯判定，便于测试） */
export function selectConvertibleImages<T extends { name: string; extension: string }>(
	files: T[],
	plan: ConvertPlan
): T[] {
	const managed = new Set<string>(MANAGED_IMAGE_EXTENSIONS);
	return files.filter(file => managed.has(file.extension.toLowerCase()) && shouldConvertFile(file.name, plan));
}

/** 编码结果是不是真的那个格式（按魔数认，别信编码器说了什么） */
export function looksLikeFormat(bytes: ArrayBuffer, format: string): boolean {
	const head = new Uint8Array(bytes.slice(0, 16));
	if (head.length < 12) return false;
	const ascii = (from: number, to: number): string =>
		Array.from(head.slice(from, to)).map(code => String.fromCharCode(code)).join('');

	switch (format) {
		case 'WEBP':
			return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
		case 'PNG':
			return head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
		case 'JPEG':
			return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
		default:
			return false;
	}
}

/** 解码出来的图：能画进 canvas 的东西 + 它的尺寸 + 怎么释放 */
interface DecodedImage {
	draw: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
}

/**
 * 把图片字节解码成能画进 canvas 的东西。
 *
 * 优先 `createImageBitmap`：它带 `imageOrientation: 'from-image'`，手机拍的 JPEG 不会躺倒。
 * 它解不了的（HEIC/TIFF 这类 Chromium 原生不认的）退回 `<img>` 试一次，再不行返回 `null`
 * —— 调用方按"没转成"处理，图片保持原格式，一个字都不会丢。
 */
async function decodeImage(blob: Blob): Promise<DecodedImage | null> {
	try {
		const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
		return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => { bitmap.close(); } };
	} catch {
		// 换个解码器再试（<img>）
	}

	const url = URL.createObjectURL(blob);
	try {
		const element = await new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => { resolve(img); };
			img.onerror = () => { reject(new Error('图片解不开')); };
			img.src = url;
		});
		return {
			draw: element,
			width: element.naturalWidth,
			height: element.naturalHeight,
			close: () => { URL.revokeObjectURL(url); },
		};
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
}

/**
 * 默认编码器：**浏览器自带的 canvas**。解码 → 画到画布 → 编成目标格式。
 *
 * `.gif` 不在这里把关（`shouldConvertFile` 已经挡了）：canvas 只会画第一帧。
 */
export const encodeWithCanvas: EncodeImage = async (request: EncodeRequest) => {
	const decoded = await decodeImage(new Blob([request.bytes], { type: request.sourceMime }));
	if (!decoded) return null;

	try {
		// `createEl` 是 Obsidian 的全局助手（等价于 `document.createElement`，也是 lint 要求的写法）
		const canvas = createEl('canvas');
		canvas.width = decoded.width;
		canvas.height = decoded.height;
		const context = canvas.getContext('2d');
		if (!context) return null;
		// JPEG 没有透明通道：先铺一层白底，免得透明区变成黑块
		if (request.targetMime === MIME_FOR_FORMAT.JPEG) {
			context.fillStyle = '#ffffff';
			context.fillRect(0, 0, canvas.width, canvas.height);
		}
		context.drawImage(decoded.draw, 0, 0);

		const blob = await new Promise<Blob | null>(resolve => {
			canvas.toBlob(resolve, request.targetMime, request.quality / 100);
		});
		if (!blob || blob.size === 0) return null;
		return await blob.arrayBuffer();
	} catch (err) {
		console.error('⚠️ 转换图片时出错，按原格式处理这张图', err);
		return null;
	} finally {
		decoded.close();
	}
};

/**
 * 把**一张还没落盘的图片**转成目标格式的字节与新文件名。
 *
 * "先转换、再落盘"是刻意的：先按原格式写进仓库再转换，中间那一刻会多出一个谁也指不到的
 * png（同步插件可能已经把它传走了），转完还得把它删掉 —— 走内存既没有中转文件，也不需要删除步骤。
 *
 * @param input 原文件名（含扩展名，用来判格式）、原始字节，以及要落到哪个附件夹
 * @param plan `null` = 不转换（调用方没开这一步）
 * @param encode 编码器（默认 canvas；测试里换成替身）
 * @returns 转换后的文件名 + 字节；没转（不接的格式 / 动图 / 已是目标格式 / 撞名 / 解不开 / 更大）时 `null`
 */
export async function convertImageBytes(
	app: App,
	input: { name: string; bytes: ArrayBuffer; folder?: string },
	plan: ConvertPlan | null,
	encode: EncodeImage = encodeWithCanvas
): Promise<{ name: string; bytes: ArrayBuffer } | null> {
	if (!plan) return null;
	if (!shouldConvertFile(input.name, plan)) return null;

	const targetName = convertedFileName(input.name, plan.format);
	if (!targetName) return null;

	const targetPath = vaultPathFor(input.folder ?? '', targetName);
	// 撞名就放弃：宁可按原格式留着，也不覆盖仓库里已有的文件
	if (app.vault.getAbstractFileByPath(targetPath)) return null;

	const bytes = await encode({
		bytes: input.bytes,
		sourceMime: mimeForExtension(extensionOf(input.name)),
		targetMime: MIME_FOR_FORMAT[plan.format],
		quality: plan.quality,
	});
	if (!bytes || bytes.byteLength === 0) return null;
	// 编码器没按要求给（解不开、原样返回了输入）：当没转
	if (!looksLikeFormat(bytes, plan.format)) return null;
	// 转完更大：留原图（截图这类本来就压过的图，转 webp 常常更大）
	if (bytes.byteLength >= input.bytes.byteLength) return null;

	return { name: targetName, bytes };
}

/**
 * 转换**仓库里已有的一张图片**：转好之后改名（换扩展名）并写回内容。
 *
 * 改名走 Obsidian 自己的 `fileManager.renameFile` —— 它会跟着更新全库链接
 * （wikilink、Markdown 链接、canvas），比我们自己写正则替换靠谱得多。
 *
 * @returns 转换后的文件名；没转 / 转不动时 `null`
 */
export async function convertVaultImage(
	app: App,
	file: TFile,
	plan: ConvertPlan | null,
	encode: EncodeImage = encodeWithCanvas
): Promise<string | null> {
	if (!plan) return null;

	const converted = await convertImageBytes(
		app,
		{
			name: file.name,
			bytes: await app.vault.readBinary(file),
			folder: file.parent?.path ?? '',
		},
		plan,
		encode
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
