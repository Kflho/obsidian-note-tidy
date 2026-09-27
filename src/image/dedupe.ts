import { MANAGED_IMAGE_EXTENSIONS } from './constants';

/**
 * 「合并重复图片」：**内容完全相同**的图片只留一张。
 *
 * ## 只合并同一文件夹里的
 *
 * 重复来源有两种，处理方式完全不同：
 *
 * - **同一文件夹里的孪生文件**：同一张图被粘了两次（时间戳差几秒），或者粘贴时手滑重复 ——
 *   这种纯属浪费，合并掉没有任何副作用；
 * - **跨文件夹的同图**：那是本插件「整理图片位置」**特意**给每篇笔记拷的副本
 *   （笔记走到哪儿都自带图片，原图被删也不影响它）。删掉就破坏了这条设计，
 *   所以 `groupByFolderAndSize` 把"目录"也当作分组条件之一。
 *
 * ## 怎么判"内容相同"
 *
 * 先按 **目录 + 字节数** 粗分组（大小都不一样绝不可能是同一张，这一步不读盘），
 * 再在组内**逐字节比对**（`findIdenticalGroups`）—— 不用哈希：省掉 crypto 依赖，
 * 也没有"哈希碰撞把两张不同的图判成一张"这种理论风险。
 *
 * ## 留哪一张
 *
 * 被笔记引用最多的那张（引用一样多时取名字最小的，保证每次跑结果一致）；
 * 其余的被合并掉，笔记里的链接**改写到留下的那张**（内容相同，显示效果不变）。
 */

/** 一张待查重的图片（只要这几样，便于测试） */
export interface ImageEntry {
	/** 仓库内完整路径 */
	path: string;
	/** 文件名（含扩展名） */
	name: string;
	/** 所在文件夹路径（根目录为 `''` 或 `'/'`） */
	folder: string;
	/** 字节数 */
	size: number;
}

/** 受管的图片扩展名（与本插件导入 / 改名用的是同一张清单） */
export function isManagedImageExtension(ext: string): boolean {
	return (MANAGED_IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

/**
 * 粗分组：同一个文件夹、字节数相同的图片才可能是同一张。
 *
 * 返回的每组至少两张（只有一张的组没必要读盘比对）。
 */
export function groupByFolderAndSize(entries: ImageEntry[]): ImageEntry[][] {
	const buckets = new Map<string, ImageEntry[]>();
	for (const entry of entries) {
		const key = `${entry.folder.replace(/\/+$/, '')}\u0000${entry.size}`;
		const bucket = buckets.get(key);
		if (bucket) bucket.push(entry);
		else buckets.set(key, [entry]);
	}
	return [...buckets.values()].filter(bucket => bucket.length > 1);
}

/** 两个 ArrayBuffer 是不是逐字节相同 */
export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
	if (a.byteLength !== b.byteLength) return false;
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}

/**
 * 在一组"同目录同大小"的图片里，按内容再拆成若干子组（每组内容完全相同）。
 *
 * @param readBytes 读文件字节（真实实现走 `vault.readBinary`；测试里给替身）
 */
export async function findIdenticalGroups(
	group: ImageEntry[],
	readBytes: (path: string) => Promise<ArrayBuffer>
): Promise<ImageEntry[][]> {
	const groups: ImageEntry[][] = [];
	const loaded: Array<{ entry: ImageEntry; bytes: ArrayBuffer }> = [];

	for (const entry of group) {
		let bytes: ArrayBuffer;
		try {
			bytes = await readBytes(entry.path);
		} catch (err) {
			// 读不动就当它自己一组：宁可少合并，也不能拿没读到的文件去比
			console.error(`⚠️ 读取图片失败，跳过查重：${entry.path}`, err);
			groups.push([entry]);
			continue;
		}

		const hit = loaded.find(item => sameBytes(item.bytes, bytes));
		if (hit) {
			const target = groups.find(sub => sub.includes(hit.entry));
			if (target) target.push(entry);
			else groups.push([hit.entry, entry]);
		} else {
			loaded.push({ entry, bytes });
			groups.push([entry]);
		}
	}

	return groups;
}

/**
 * 这一组留哪张：**被引用最多的**；一样多时取名字最小的（结果稳定、可复现）。
 */
export function chooseKeeper(group: ImageEntry[], refCount: (name: string) => number): ImageEntry {
	const sorted = [...group].sort((a, b) => {
		const diff = refCount(b.name) - refCount(a.name);
		if (diff !== 0) return diff;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
	return sorted[0] as ImageEntry;
}

/**
 * 把一段文本里对 `from` 的引用全部改成 `to`。
 *
 * 四种写法一次覆盖：`![[名]]`（含 `|尺寸` / `#片段`）、`[[名]]`、
 * `![](.../名)`（Markdown，路径里带名字）、canvas 里的 `"file": ".../名"` ——
 * 本质都是"名字出现在文本里"，所以按名字替换，两侧卡住词边界：
 *
 * - 左边不许是单词字符、`-` 或 `.`（挡住 `x_名`、`foo-名`、`.名` 这类长名字的一部分）；
 * - 右边不许是单词字符或 `.`（挡住 `名.webp.bak`、`名.png` 这类更长名字的开头）。
 *
 * 名字都是 `pasted_image_…webp` 这种纯 ASCII，不涉及 URL 编码。
 */
export function rewriteImageReferences(text: string, from: string, to: string): string {
	if (!from || from === to) return text;
	const pattern = new RegExp(`(?<![\\w.-])${escapeRegExp(from)}(?![\\w.])`, 'g');
	return text.replace(pattern, to);
}

/** 数一段文本里引用了某个文件名几次（判定"留哪张"用） */
export function countImageReferences(text: string, name: string): number {
	if (!name) return 0;
	const pattern = new RegExp(`(?<![\\w.-])${escapeRegExp(name)}(?![\\w.])`, 'g');
	return (text.match(pattern) ?? []).length;
}

/**
 * 抽出一段文本里引用的**图片文件名**（去重前的原始清单，交给调用方累加计数）。
 *
 * 覆盖 `![[…]]`、`[[…]]`、`![](…)` 与 canvas 的 `"file"` 四种写法；
 * 非图片后缀（笔记双链等）一律不返回。
 */
export function collectImageTargets(text: string): string[] {
	const targets: string[] = [];
	const imageExt = /\.(png|jpe?g|gif|bmp|webp|heic|avif|svg)$/i;

	const take = (raw: string): void => {
		const cleaned = raw.split('#')[0]?.trim() ?? '';
		if (!imageExt.test(cleaned)) return;
		const base = cleaned.split('/').pop();
		if (base) targets.push(base.toLowerCase());
	};

	for (const match of text.matchAll(/\[\[([^\]|#]+)/g)) take(match[1] ?? '');
	for (const match of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
		let link = (match[1] ?? '').trim().replace(/^<|>$/g, '');
		try {
			link = decodeURIComponent(link);
		} catch {
			// 编码坏了就按原样看
		}
		take(link);
	}
	for (const match of text.matchAll(/"file"\s*:\s*"([^"]+)"/g)) take(match[1] ?? '');

	return targets;
}

/** 正则转义（名字里可能有 `.`，必须当字面量） */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
