/**
 * 「粘贴图片」：剪贴板里的图片文件由本插件自己接管。
 *
 * ## 为什么是我们接管
 *
 * 编辑器里粘贴图片时，本来一直是 Image Converter 的自动粘贴在管。但它那边是
 * **并发**跑的（`handlePaste` 里 `files.map(async …)`）：一批图各算各的输出名，
 * 同一秒算出来的名字撞在一起，后写的那个直接 `File already exists` 丢图 ——
 * 2026-09 用户实测"粘两张只剩第一张"。它既没有开关、也不看 `defaultPrevented`，
 * 我们抢不了这次粘贴，只能让它别再管（它的「Never process filenames」填 `*`），
 * 由我们把这件事做对：**一张一张来**，名字用本插件那套不撞名的规矩。
 *
 * ## 分工
 *
 * 这里只放**纯函数**（挑出剪贴板里的图、拼要写进正文的文字），
 * 落盘与写正文在 `tasks.ts` 的 `ImageTasks.pasteImages` / 存图在 `image/transfer.ts`
 * 的 `importImageBytes`，事件接线在 `ui/paste-watch.ts`。
 */

/** 图片扩展名（小写，不带点）：按 MIME 兜底补文件名时用 */
const EXTENSION_BY_MIME: Record<string, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/gif': 'gif',
	'image/bmp': 'bmp',
	'image/webp': 'webp',
	'image/heic': 'heic',
	'image/heif': 'heic',
	'image/avif': 'avif',
};

/** 受管的图片扩展名（剪贴板里没有 MIME 时按它认） */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'heic', 'heif', 'avif'];

/** 这张剪贴板里的图算不算我们要接管的图片 */
export function isImageFile(file: File): boolean {
	const type = (file.type ?? '').toLowerCase();
	if (type.startsWith('image/')) return true;
	const dot = file.name.lastIndexOf('.');
	if (dot <= 0) return false;
	return IMAGE_EXTENSIONS.includes(file.name.substring(dot + 1).toLowerCase());
}

/**
 * 剪贴板里的图片文件（按剪贴板里的先后顺序）。
 *
 * 先看 `items`（它有 `kind`，能区分"图片文件"与"文本"），拿不到再退回 `files`
 * —— 两条路给的是同一批文件，不要合并，否则会存两遍。
 */
export function imageFilesFromClipboard(clipboard: DataTransfer | null): File[] {
	if (!clipboard) return [];

	const fromItems: File[] = [];
	if (clipboard.items) {
		for (let i = 0; i < clipboard.items.length; i++) {
			const item = clipboard.items[i];
			if (!item || item.kind !== 'file') continue;
			const file = item.getAsFile();
			if (file && isImageFile(file)) fromItems.push(file);
		}
	}
	if (fromItems.length > 0) return fromItems;

	const fromFiles: File[] = [];
	if (clipboard.files) {
		for (let i = 0; i < clipboard.files.length; i++) {
			const file = clipboard.files[i];
			if (file && isImageFile(file)) fromFiles.push(file);
		}
	}
	return fromFiles;
}

/**
 * 这张图存进仓库时用什么名字（命名模板靠扩展名判"要不要转格式"）。
 *
 * 剪贴板里的图常常没有文件名、或只有 `image` 这种没有扩展名的名字，那时按 MIME 补一个；
 * 实在认不出来就给 `pasted-image.png`（存图那一步还会按魔数再认一遍，认不出就保持原样）。
 */
export function pastedImageName(file: File): string {
	const name = file.name ?? '';
	const dot = name.lastIndexOf('.');
	if (dot > 0 && dot < name.length - 1) return name;

	const extension = EXTENSION_BY_MIME[(file.type ?? '').toLowerCase()] ?? 'png';
	return name === '' ? `pasted-image.${extension}` : `${name}.${extension}`;
}

/**
 * 接管这次粘贴后要写进正文的内容：**剪贴板的文字在前、图片链接在后**（各占一行）。
 *
 * 图片与文字的相对位置剪贴板里给不出来（`text/plain` 里没有图片占位符），
 * 所以只能是"文字 + 图"；要精确摆放，粘完再用「排版选中内容」或聊天记录排版去排。
 */
export function buildPasteText(text: string, links: string[]): string {
	const body = links.join('\n');
	if (body === '') return text;
	if (text === '') return body;
	return text.endsWith('\n') ? `${text}${body}` : `${text}\n${body}`;
}
