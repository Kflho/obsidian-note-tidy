/**
 * Node 里没有 canvas / `ImageBitmap`：这一小段给测试装一个**能用的替身**。
 *
 * 装了它，`image/convert.ts` 的默认编码器（`encodeWithCanvas`）就能在测试里真跑一遍 ——
 * 验的是"我们调用浏览器的姿势"（源 MIME、目标 MIME、质量、拿回来的字节怎么处置），
 * 而不是 Chromium 编码器本身压得好不好。
 *
 * 用法：
 * ```ts
 * const canvas = installCanvasStub(() => stubWebpBytes());   // 让"编码器"吐出 webp
 * ...跑被测代码...
 * canvas.restore();                                          // 换回 Node 的全局
 * ```
 */
export interface CanvasCall {
	/** `canvas.toBlob` 收到的 MIME */
	mime: string;
	/** `canvas.toBlob` 收到的质量（0–1，我们传 `quality / 100`） */
	quality: number;
	/** 编码时的画布尺寸（应当等于解码出来的图片尺寸） */
	width: number;
	height: number;
}

export interface CanvasStub {
	/** 每次 `toBlob` 记一笔 */
	calls: CanvasCall[];
	/** 每次解码收到的字节数（= 我们要转的那张图的原始大小，按顺序） */
	decodedSizes: number[];
	/** 有没有要求铺白底（JPEG 那条路会铺） */
	filledBackground: () => boolean;
	/** 换回原来的全局 */
	restore: () => void;
}

/** 一张假 webp 的字节（RIFF…WEBP） */
export function stubWebpBytes(payload = 'webp-body'): ArrayBuffer {
	const bytes = new Uint8Array(12 + payload.length);
	const head = 'RIFF\u0000\u0000\u0000\u0000WEBP';
	for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i);
	for (let i = 0; i < payload.length; i++) bytes[12 + i] = payload.charCodeAt(i);
	return bytes.buffer;
}

/** 一张假 png 的字节（魔数对、其余随便） */
export function stubPngBytes(): ArrayBuffer {
	const bytes = new Uint8Array(16);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	return bytes.buffer;
}

/**
 * 装上替身：`createImageBitmap` 给一张 8×4 的假图，`document.createElement('canvas')`
 * 给一块能记账的假画布，`toBlob` 按 `produce()` 吐字节。
 *
 * @param produce 编码器"编"出来的字节（默认一张假 webp；换成 png 字节就能演"编出来不是目标格式"）
 */
export function installCanvasStub(produce: () => ArrayBuffer = () => stubWebpBytes()): CanvasStub {
	const globals = globalThis as unknown as Record<string, unknown>;
	const calls: CanvasCall[] = [];
	const decodedSizes: number[] = [];
	let filled = false;

	const bitmapWidth = 8;
	const bitmapHeight = 4;
	let canvasWidth = 0;
	let canvasHeight = 0;

	const previous = {
		createImageBitmap: globals.createImageBitmap,
		createEl: globals.createEl,
	};

	globals.createImageBitmap = async (blob: Blob): Promise<unknown> => {
		decodedSizes.push(blob.size);
		return {
			width: bitmapWidth,
			height: bitmapHeight,
			close: (): void => undefined,
		};
	};

	// 注意：**在原来的 document 上加一个 createElement**，而不是整个换掉 ——
	// 有的测试（整理图片那条）自己装了 `document.body.classList` 等替身，换掉会把它们弄丢
	const previousDocument = globals.document as Record<string, unknown> | undefined;
	const createElement = (): unknown => ({
		get width(): number { return canvasWidth; },
		set width(value: number) { canvasWidth = value; },
		get height(): number { return canvasHeight; },
		set height(value: number) { canvasHeight = value; },
		getContext: (): unknown => ({
			set fillStyle(_value: string) { filled = true; },
			fillRect: (): void => undefined,
			drawImage: (): void => undefined,
		}),
		toBlob: (callback: (blob: Blob | null) => void, mime: string, quality: number): void => {
			calls.push({ mime, quality, width: canvasWidth, height: canvasHeight });
			callback(new Blob([produce()], { type: mime }));
		},
	});

	globals.document = { ...(previousDocument ?? {}), createElement };
	// Obsidian 的全局助手（`image/convert.ts` 按 lint 要求用它，而不是 document.createElement）
	globals.createEl = createElement;

	return {
		calls,
		decodedSizes,
		filledBackground: () => filled,
		restore: (): void => {
			globals.document = previousDocument;
			globals.createEl = previous.createEl;
			globals.createImageBitmap = previous.createImageBitmap;
			filled = false;
			calls.length = 0;
			decodedSizes.length = 0;
		},
	};
}
