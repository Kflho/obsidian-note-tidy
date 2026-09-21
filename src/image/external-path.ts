import { Platform } from 'obsidian';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 磁盘绝对路径解析（从 main.ts 抽出，纯 Node 逻辑，不碰 vault）。
 *
 * 笔记里的外部图片链接是**手抄或从别处粘来**的，路径里什么字符都可能有：
 * URL 编码残留（`%20`）、Markdown 转义反斜杠（`\(`）、大小写不一致。
 * 直接按字面量找文件基本找不到，所以这里用"逐段弹性匹配"：
 * 从盘符开始，把链接按段拆开，每一段都去和磁盘上的真实条目比对 ——
 * 匹配时忽略大小写、把 `%XX` 解码后再比、跳过 Markdown 转义用的反斜杠。
 */

/**
 * 弹性路径解析：针对特殊字符路径的递归搜索。
 *
 * @param base 当前已经确定存在的目录（以分隔符结尾）
 * @param remaining 还没匹配掉的路径片段
 * @returns 命中的物理文件路径；找不到返回 null
 */
export async function flexibleProbing(base: string, remaining: string): Promise<string | null> {
	const target = remaining.replace(/^[\\/]+/, '');
	if (!target) {
		try {
			const stats = await fs.stat(base);
			return stats.isFile() ? base : null;
		} catch { return null; }
	}

	try {
		const entries = await fs.readdir(base);
		// 长条目优先：`图 1 (1).png` 应该先于 `图` 匹配，避免被短名截胡
		entries.sort((a, b) => b.length - a.length);

		for (const entry of entries) {
			let consumedCount = 0;
			let normalizedMatch = "";

			for (let i = 0; i < target.length; i++) {
				const char = target[i];
				const nextChar = target[i + 1];
				// Markdown 转义：`\(` `\[` 里的反斜杠不是路径的一部分，直接跳过
				const isMarkdownEscape = /[[\]()\s]/.test(nextChar || "");
				if (char === '\\' && nextChar !== undefined && isMarkdownEscape) {
					continue;
				}

				normalizedMatch += char;
				const decodedMatch = (() => {
					try { return decodeURIComponent(normalizedMatch); }
					catch { return normalizedMatch; }
				})();

				if (normalizedMatch.toLowerCase() === entry.toLowerCase() ||
					decodedMatch.toLowerCase() === entry.toLowerCase()) {
					consumedCount = i + 1;
					break;
				}
				// 已经比条目长出一截还没匹配上，说明方向不对，换下一个条目
				if (normalizedMatch.length > entry.length + 10) break;
			}

			if (consumedCount > 0) {
				const nextBase = path.join(base, entry);
				const found = await flexibleProbing(nextBase, target.substring(consumedCount));
				if (found) return found;
			}
		}
	} catch { return null; }

	return null;
}

/**
 * 将原始链接解析为物理磁盘路径。
 * 支持 `file:///D:/…`、`D:\…`、`/home/…` 三种写法。
 */
export async function resolvePhysicalPath(rawPath: string): Promise<string | null> {
	let clean = rawPath.replace(/^<?file:\/+/i, '').replace(/>?$/, '');
	let driveRoot = "";
	let pathBody = clean;

	if (Platform.isWin && /^[a-zA-Z]:/.test(clean)) {
		driveRoot = clean.substring(0, 2).toUpperCase() + path.sep;
		pathBody = clean.substring(2);
	} else if (clean.startsWith('/')) {
		driveRoot = path.sep;
		pathBody = clean.substring(1);
	}

	if (!driveRoot) return null;
	return await flexibleProbing(driveRoot, pathBody);
}
