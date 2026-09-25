/**
 * 「文字 + 图片」混排复制：给聊天窗口准备 HTML。
 *
 * ## 为什么单独来一套
 *
 * 只放"文件拖放列表"（CF_HDROP）时，QQ / 微信 贴出来只有图片，正文那句文字没了 ——
 * 而选区里明明是一段带图的文字。Windows 上让聊天窗口贴出**图文混排**的标准做法是
 * **HTML Format**（CF_HTML）：把文字与 `<img>` 一起写进去，程序自己解析。
 *
 * ## 几条踩过的规矩（改这个模块前先看）
 *
 * 1. **混排这条复制里不能有文件列表**（2026-09 用户实测：只放文件列表时 QQ 贴出来只有图片）。
 *    QQ 的粘贴处理是先看有没有文件，有文件就直接当图片上传 —— 那段文字根本没机会出现。
 *    所以混排只写 HTML 与纯文本，**不写 CF_HDROP**；纯图片（选区里没文字）才走文件列表那条路。
 *    代价：混选复制粘不到文件夹里（要图片文件就选纯图片，或者用「复制图片」菜单项）；
 * 2. **图片内嵌成 data URI**（`<img src="data:image/png;base64,…">`）：`file:///` 只在 Word
 *    这类允许读本地文件的程序里好使，浏览器内核的程序（QQ NT / 微信）从非 file 页面加载
 *    `file:///` 子资源会被拦掉，贴出来就是一张裂图。读不到 / 太大时退回 `file:///`（见 `imageSourceMap`）；
 * 3. **不要同时放位图**：剪贴板里一旦有 CF_BITMAP，微信 / 企业微信 就不再解析 HTML
 *    （贴出来只剩一张图）—— 所以混排那条路一份位图也不放；
 * 4. **CF_HTML 是 UTF-8 字节流**，头里的偏移量是**字节**偏移不是字符偏移 ——
 *    中文一个字三字节，按字符数算头就会错位，程序解析出来就是乱码；
 * 5. 头里的偏移量位数固定（这里补零到 10 位），否则"先算头再填数"会把头本身撑长、数值全错。
 */

import * as fs from 'fs/promises';

/** 要放进 HTML 的一张图：磁盘路径 + 它在原文里的位置（左闭右开） */
export interface RichImage {
	/** 磁盘绝对路径 */
	path: string;
	/** 在原文里的起始位置 */
	from: number;
	/** 在原文里的结束位置 */
	to: number;
}

/** 单张图最多内嵌多少字节（再大就退回 `file:///`：剪贴板塞几十兆会把两边都卡住） */
export const MAX_EMBED_BYTES = 8 * 1024 * 1024;

/** 一次复制里所有图内嵌的总上限 */
export const MAX_EMBED_TOTAL_BYTES = 16 * 1024 * 1024;

/**
 * 编辑器里这次选中的内容。
 *
 * `from` 是选区在**整篇笔记**里的起点：引用位置是整篇的坐标，减去它才是选区里的位置。
 */
export interface CopySelection {
	/** 选中的原文 */
	text: string;
	/** 选区在整篇笔记里的起始偏移 */
	from: number;
}

/** 扩展名 → MIME；不认识的返回 null（那就别内嵌，退回 `file:///`） */
export function mimeTypeOf(filePath: string): string | null {
	const extension = /\.([a-z0-9]+)$/i.exec(filePath)?.[1]?.toLowerCase() ?? '';
	const table: Record<string, string> = {
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		bmp: 'image/bmp',
		webp: 'image/webp',
		avif: 'image/avif',
		heic: 'image/heic',
		svg: 'image/svg+xml',
	};
	return table[extension] ?? null;
}

/** 字节 → data URI（图片内嵌进 HTML 用的就是它） */
export function dataUriOf(bytes: Uint8Array, mime: string): string {
	return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/**
 * 每张图的 `<img src>` 取值：**能内嵌就内嵌**，否则退回 `file:///`。
 *
 * 为什么不一律用 `file:///`：QQ NT / 微信 是浏览器内核，从非 `file` 页面加载 `file:///`
 * 子资源会被安全策略拦掉（贴出来是裂图）；data URI 则哪儿都能渲染。代价是剪贴板变大，
 * 所以有上限（`MAX_EMBED_BYTES` / `MAX_EMBED_TOTAL_BYTES`），超了就退回 `file:///`。
 *
 * @param readBytes 读文件的实现（默认读磁盘；测试里塞个替身，就不碰真文件）
 */
export async function imageSourceMap(
	images: RichImage[],
	readBytes: (path: string) => Promise<Uint8Array> = path => fs.readFile(path)
): Promise<Map<string, string>> {
	const sources = new Map<string, string>();
	let embedded = 0;

	for (const image of images) {
		if (sources.has(image.path)) continue;

		const mime = mimeTypeOf(image.path);
		if (mime === null) {
			sources.set(image.path, fileUrlOf(image.path));
			continue;
		}

		try {
			const bytes = await readBytes(image.path);
			if (bytes.byteLength > MAX_EMBED_BYTES || embedded + bytes.byteLength > MAX_EMBED_TOTAL_BYTES) {
				sources.set(image.path, fileUrlOf(image.path));
				continue;
			}
			embedded += bytes.byteLength;
			sources.set(image.path, dataUriOf(bytes, mime));
		} catch {
			// 读不了（文件没了 / 没权限）就退回 file:///，总比整条复制失败强
			sources.set(image.path, fileUrlOf(image.path));
		}
	}

	return sources;
}

/**
 * 由选区与解析出来的图片拼出"图文混排"那份内容；纯图片（选区里没别的文字）返回 null。
 *
 * 返回的形状与 `clipboard.ts` 的 `RichClipboardContent` 一致（那边只认 `text` 与 `html`）。
 *
 * @param selection 选区（没有选区时传 null，直接走纯图片那条路）
 * @param images 这次解析出来的图片（位置是**整篇**坐标）
 * @param readBytes 读图片字节的实现（默认读磁盘；测不过真文件的测试传替身）
 */
export async function buildRichContent(
	selection: CopySelection | null,
	images: Array<{ path: string; from: number; to: number }>,
	readBytes?: (path: string) => Promise<Uint8Array>
): Promise<{ text: string; html: string } | null> {
	if (!selection) return null;

	// 只认落在选区里的引用：选区之外的那些是"光标处那张图"，不属于这次复制的内容
	const placements: RichImage[] = images
		.map(image => ({ path: image.path, from: image.from - selection.from, to: image.to - selection.from }))
		.filter(image => image.from >= 0 && image.to <= selection.text.length);

	if (placements.length === 0) return null;
	if (!hasTextBesidesImages(selection.text, placements)) return null;

	const sources = await imageSourceMap(placements, readBytes);
	const fragment = buildHtmlFragment(selection.text, placements, path => sources.get(path) ?? fileUrlOf(path));

	return { text: selection.text, html: buildClipboardHtml(fragment) };
}

/** CF_HTML 头的偏移量补零位数（固定宽度，头长度才算得准） */
const OFFSET_WIDTH = 10;

const encoder = new TextEncoder();

/** 一段文本的 UTF-8 字节数（CF_HTML 的偏移量按字节算） */
export function utf8Length(text: string): number {
	return encoder.encode(text).length;
}

/**
 * 选区里除了图片还有别的文字吗？
 *
 * 只有图片（哪怕带一堆空格换行）就算"纯图片"，走原来那条路：文件夹里能粘出文件；
 * 有文字才算图文混排，才需要写 HTML —— 否则给聊天窗口塞一份"只有图片的 HTML"，
 * 反而让只想贴图的场景多绕一道。
 */
export function hasTextBesidesImages(text: string, ranges: Array<{ from: number; to: number }>): boolean {
	let cursor = 0;
	for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
		if (range.from > cursor && /\S/.test(text.slice(cursor, range.from))) return true;
		cursor = Math.max(cursor, range.to);
	}
	return /\S/.test(text.slice(cursor));
}

/**
 * 磁盘路径 → `file:///` 开头的 URL。
 *
 * **只编会破坏 URL 解析的那几个字符**（空格、`#`、`?`、`%`），中文原样留着：
 * 文档是 UTF-8，中文写在属性里没问题；而 QQ 这类程序拿到 src 后可能直接当路径去开文件
 * （`CreateFile` 认中文、不认 `%E5%9B%BE` 这种转义），Chromium 那边两种写法都能解析 ——
 * 原样留着是唯一两边都稳的写法。反斜杠先统一成正斜杠。
 */
export function fileUrlOf(absolutePath: string): string {
	const normalized = absolutePath.replace(/\\/g, '/');
	const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
	const escaped = prefixed.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\?/g, '%3F').replace(/ /g, '%20');
	return `file://${escaped}`;
}

/** HTML 文本节点转义（`&` 要先换，否则会把后面换出来的实体再编一遍） */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 由原文与图片位置拼出 HTML 片段：图片落在它原来的位置上，其余按文本转义，换行变 `<br>`。
 *
 * @param srcOf 图片路径 → `<img src>` 的取值，默认磁盘 `file:///` 地址
 */
export function buildHtmlFragment(
	text: string,
	images: RichImage[],
	srcOf: (path: string) => string = fileUrlOf
): string {
	const parts: string[] = [];
	let cursor = 0;

	for (const image of [...images].sort((a, b) => a.from - b.from)) {
		// 位置重叠的（同一个位置解析出两条引用）只认前一条，免得片段里文字被吃掉
		if (image.from < cursor || image.to > text.length) continue;
		parts.push(escapeHtml(text.slice(cursor, image.from)));
		parts.push(`<img src="${escapeHtml(srcOf(image.path))}">`);
		cursor = image.to;
	}

	parts.push(escapeHtml(text.slice(cursor)));
	return parts.join('').replace(/\r?\n/g, '<br>');
}

/** 头里的偏移量：补零到固定宽度 */
function padOffset(value: number): string {
	return String(value).padStart(OFFSET_WIDTH, '0');
}

/**
 * 拼出完整的 CF_HTML 数据（头 + 文档），放进剪贴板的就是它。
 *
 * 头里的 StartHTML / EndHTML / StartFragment / EndFragment 都是**字节**偏移，
 * 且头本身也算在里面 —— 所以先把头的长度用同样的补零宽度量出来，再回填真实数值。
 *
 * @param fragment 片段（`buildHtmlFragment` 的结果）
 * @param sourceUrl 可选来源地址，会写进 `SourceURL:`
 */
export function buildClipboardHtml(fragment: string, sourceUrl = ''): string {
	const sourceLine = sourceUrl ? `SourceURL:${encodeURI(sourceUrl)}\r\n` : '';
	const headerWith = (values: [number, number, number, number]): string =>
		'Version:0.9\r\n' +
		`StartHTML:${padOffset(values[0])}\r\n` +
		`EndHTML:${padOffset(values[1])}\r\n` +
		`StartFragment:${padOffset(values[2])}\r\n` +
		`EndFragment:${padOffset(values[3])}\r\n` +
		sourceLine;

	const head = '<html><body><!--StartFragment-->';
	const tail = '<!--EndFragment--></body></html>';

	const headerLength = utf8Length(headerWith([0, 0, 0, 0]));
	const startFragment = headerLength + utf8Length(head);
	const endFragment = startFragment + utf8Length(fragment);
	const endHtml = endFragment + utf8Length(tail);

	return headerWith([headerLength, endHtml, startFragment, endFragment]) + head + fragment + tail;
}
