import type { App, TFile } from 'obsidian';
import { resolvePhysicalPath } from './external-path';
import { buildBasenameIndex, resolveImageLink } from './links';
import type { ImageRef } from './scan';

/**
 * 把笔记里的图片引用解析成**磁盘上真实存在的文件**（"复制图片"用）。
 *
 * 两道安全线沿用图片功能的老规矩：
 * - **同名不猜**：全库有多张同名图、原生解析又失败时，宁可跳过也不复制错的那张
 *   （判定在 `links.ts` 的 `resolveImageLink`）；
 * - **去重**：同一张图在一段选区里出现两次，剪贴板里也只放一份
 *   （放两份的话粘到文件夹里会变成"图.png"和"图 2.png"）。
 *
 * 链接可能是仓库内的（`![[图.png]]`、`![](附件/图.png)`），也可能是外部绝对路径
 * （`![说明](D:\图.png)`，插件还没转换过的那些）—— 后者交给 `external-path.ts` 去磁盘上找。
 */

/** 解析成功的一张图：显示名 + 磁盘绝对路径 */
export interface CopyableImage {
	/** 显示名（提示里说明复制了哪几张） */
	name: string;
	/** 磁盘绝对路径 */
	path: string;
	/** 这条引用在原文里的起始位置（图文混排要按原位置把图放回文字中间） */
	from: number;
	/** 这条引用在原文里的结束位置（左闭右开） */
	to: number;
}

/**
 * 链接目标是不是磁盘绝对路径。
 *
 * 只认盘符（`D:\`）、UNC（`\\server\share`）与 `file://` 三种；
 * **`/开头` 不算** —— 在 Obsidian 里那是"仓库根目录"，当成磁盘根会去扫整个盘。
 */
export function isExternalTarget(target: string): boolean {
	const clean = target.trim();
	return /^file:\/\//i.test(clean) || /^[a-zA-Z]:[\\/]/.test(clean) || clean.startsWith('\\\\');
}

/** 取路径里的文件名（认得 `/` 与 `\` 两种分隔符） */
export function baseNameOf(filePath: string): string {
	const parts = filePath.split(/[\\/]/);
	return parts[parts.length - 1] ?? filePath;
}

/** 仓库在磁盘上的根目录（桌面端适配器提供）；拿不到返回 null */
export function basePathOf(app: App): string | null {
	const adapter = app.vault.adapter as unknown as { getBasePath?: () => string };
	return typeof adapter.getBasePath === 'function' ? adapter.getBasePath() : null;
}

/**
 * 把 Obsidian 的资源 URL（`app://local/D:/仓库/附件/图.png?1699`）还原成仓库内路径。
 *
 * 阅读视图里的 `<img>` 只有这个 src，没有链接文本，`internal-embed` 又拿不到时靠它兜底。
 * Obsidian 的写法是"磁盘绝对路径"接在协议头后面（还常带个时间戳查询串），
 * 所以拿适配器的 basePath 一比就出来了 —— 比不出来（不在仓库里、外链图）返回 null。
 */
export function vaultPathFromResourceUrl(resourceUrl: string, basePath: string): string | null {
	if (!basePath) return null;

	let url: URL;
	try {
		url = new URL(resourceUrl);
	} catch {
		return null;
	}

	let pathname = url.pathname;
	try {
		pathname = decodeURIComponent(pathname);
	} catch {
		// 编码坏了就按原样比，别整个失败
	}

	// Windows 上 pathname 是 `/D:/仓库/图.png`，macOS / Linux 上是 `/仓库/图.png`
	// —— 两边都把开头的斜杠去掉再比，否则 POSIX 上永远比不上
	const base = basePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
	const resource = pathname.replace(/^\/+/, '');
	if (!resource.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null;
	return resource.slice(base.length + 1);
}

/**
 * 仓库文件的磁盘绝对路径。
 *
 * 桌面端适配器（FileSystemAdapter）提供 `getFullPath`；老版本只有 `getBasePath`
 * 时自己拼。都不是函数（比如移动端适配器）就返回 null，由调用方提示。
 */
export function absolutePathOf(app: App, file: TFile): string | null {
	const adapter = app.vault.adapter as unknown as { getFullPath?: (path: string) => string };
	if (typeof adapter.getFullPath === 'function') return adapter.getFullPath(file.path);

	const base = basePathOf(app);
	return base ? `${base.replace(/[\\/]+$/, '')}/${file.path}` : null;
}

/** 解析一条引用；解析不到（同名歧义、文件不在了、仓库外找不到）返回 null */
async function resolveOne(
	app: App,
	sourcePath: string,
	ref: ImageRef,
	index: Map<string, TFile[]>
): Promise<CopyableImage | null> {
	if (ref.kind === 'markdown' && isExternalTarget(ref.target)) {
		const physical = await resolvePhysicalPath(ref.target);
		return physical ? { name: baseNameOf(physical), path: physical, from: ref.from, to: ref.to } : null;
	}

	const { file } = resolveImageLink(app, sourcePath, ref.target, index);
	if (!file) return null;

	const absolute = absolutePathOf(app, file);
	return absolute ? { name: file.name, path: absolute, from: ref.from, to: ref.to } : null;
}

/**
 * 解析一批图片引用，返回去重后的文件清单（按出现顺序）。
 * 解析不到的静默跳过 —— 调用方拿到的就是"这次能复制哪几张"。
 */
export async function resolveImageFiles(app: App, sourcePath: string, refs: ImageRef[]): Promise<CopyableImage[]> {
	const index = buildBasenameIndex(app);
	const found: CopyableImage[] = [];
	const seen = new Set<string>();

	for (const ref of refs) {
		const resolved = await resolveOne(app, sourcePath, ref, index);
		if (!resolved) continue;
		// Windows 上大小写不敏感，去重也跟着不敏感
		const key = resolved.path.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		found.push(resolved);
	}

	return found;
}
