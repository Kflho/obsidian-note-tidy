import { collectImageTargets } from './dedupe';

/**
 * 清理**没人引用的图片附件**（自己实现，不依赖 Clear Unused Images）。
 *
 * ## 判定只有一条
 *
 * 「有人引用」= 文件名出现在**任何一篇笔记或 canvas** 里：`![[图.png]]`、`[[图.png]]`、
 * `![](路径/图.png)`、canvas 里的 `"file": "路径/图.png"` 都算（判定复用 `dedupe.ts` 的
 * `collectImageTargets`，与合并重复副本用的是同一份扫描）。**按文件名比、不区分大小写** ——
 * 链接里写的是 `图.png` 还是 `attachments/图.png` 都指向同一张图。
 *
 * **表格里的写法也算**：GFM 表格里 `|` 必须先转义成 `\|`（`![[图.png\|100]]`），
 * 扫描时由 `unescapeTableTarget` 还原 —— 2026-09 的误删事故就是漏了这一种：
 * 表格里的图被判成"没人引用"，整个笔记的图被清空（修法与回归测试见 `image.table-escape`）。
 *
 * 三条刻意的保守：
 *
 * - **只清图片**（png/jpg/gif/bmp/webp/heic/avif/svg）—— 别的附件（pdf、docx、音频…）一个都不碰，
 *   它们的引用写法五花八门，误判的代价比"少清几个"大得多；
 * - **只认笔记与 canvas 里的引用**：`.md` 与 `.canvas` 之外的文件（导出的 html、别的插件的数据文件）
 *   一概不看 —— 这也是 Clear Unused Images 的口径；
 * - 删除走 `fileManager.trashFile`（用户设的回收站），不是永久删除，误伤了还能捞回来。
 *
 * 纯函数部分在这里（`selectUnusedImages`），读盘与删除在 `tasks.ts`。
 */

/** 会被清理的图片后缀（比受管位图宽一点：svg 也是图片，但不归"转换格式"管） */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|heic|avif|svg)$/i;

/** 只看文件名：这张图会不会被我们清理 */
export function isImageFileName(name: string): boolean {
	return IMAGE_EXT_RE.test(name);
}

/**
 * 从一批图片里挑出**没有任何文档引用**的那些。
 *
 * @param images 仓库里的图片文件（要用 `name`）
 * @param documentTexts 全库笔记 / canvas 的正文
 * @returns `images` 里没人引用的那些（保持原顺序，便于结果可复现）
 */
export function selectUnusedImages<T extends { name: string }>(images: T[], documentTexts: string[]): T[] {
	const referenced = new Set<string>();
	for (const text of documentTexts) {
		for (const target of collectImageTargets(text)) referenced.add(target);
	}
	return images.filter(image => !referenced.has(image.name.toLowerCase()));
}
