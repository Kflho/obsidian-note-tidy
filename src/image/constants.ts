/**
 * 图片功能共用的常量与正则（从 main.ts 抽出）。
 *
 * ## 为什么有两套扩展名表，且不能合并
 *
 * 它们是两个不同的问题，答案本来就不一样：
 * - **本模块的 `MANAGED_IMAGE_EXT_RE`**：插件会**导入 / 重命名**的位图格式，
 *   由 `MANAGED_IMAGE_EXTENSIONS` 生成 —— 只有这一处清单，加新格式改一行就够；
 * - **`links.ts` 的 `IMAGE_EXT_RE`**：判定「这个链接指向的是不是图片」，比上面宽
 *   （多 `avif` / `svg`）。它只用来解析链接、决定链接写法，不会去动文件本身。
 *
 * 合并两者会让重命名功能开始碰 `.svg`（矢量图，当文本处理更合适），
 * 或者反过来让 `avif` 链接解析不出来。
 */

/** 插件会导入 / 重命名的位图格式（小写，不含点） */
export const MANAGED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'heic'] as const;

/** 上面那份清单拼成的扩展名分支，供下面两个正则复用 */
const EXT_ALTERNATION = MANAGED_IMAGE_EXTENSIONS.join('|');

/** 链接末尾是不是受管的图片扩展名（大小写不敏感） */
export const MANAGED_IMAGE_EXT_RE = new RegExp(`\\.(${EXT_ALTERNATION})$`, 'i');

/**
 * 双链嵌入 `![[目标]]` / `![[目标|别名]]`。
 *
 * **每次调用都要新建一个**：带 `g` 标志的正则实例有 `lastIndex` 状态，
 * 共享一个实例会让两次扫描互相串味（第二次从上次停下的位置开始）。
 *
 * @param withAlias 为 true 时第 2 个捕获组是 `|别名`（含竖线），供需要原样拼回链接的调用方使用
 */
export function wikiEmbedRe(withAlias = false): RegExp {
	return withAlias
		? /!\[\[([^|]+?)(\|.+?)?\]\]/g
		: /!\[\[([^|]+?)(?:\|.+?)?\]\]/g;
}

/**
 * 还原链接目标里的**表格转义**：`![[图.png\|100]]` 里的名字是 `图.png`。
 *
 * GFM 表格里 `|` 必须写成 `\|`，而所有链接正则都是在 `|` 前面停下的 ——
 * 于是 `![[图.png\|100]]` 捕获到的目标末尾会多出一个转义反斜杠，
 * `\.(png|webp|…)$` 就匹配不上：这条链接被当成"没有引用"。
 * 2026-09 的 bug 就是这个（清理未引用图片据此把表格里的图全删了），
 * 同一处转义也让改名 / 复制 / 套尺寸漏掉表格里的图 —— 所以它在这儿只有一份，
 * 每个读链接目标的地方（`dedupe` / `scan` / `links` / `rename` / `organize` / `size`）
 * 拿到 `match[1]` 之后都要过一道。
 *
 * 文件名里不可能有 `|`（Windows 禁止，Obsidian 也拿它当别名分隔符），
 * 所以把 `\|` 还原成 `|`、再去掉末尾那串反斜杠都是安全的。
 *
 * **只在"读"的时候用**：要改写链接时得把原来的转义写回去（表格里漏了 `\`
 * 竖线会把单元格切断），所以那些地方保留原文、只拿它做判断。
 */
export function unescapeTableTarget(raw: string): string {
	return raw.replace(/\\+\|/g, '|').replace(/\\+$/, '');
}

/**
 * 指向磁盘绝对路径的外部图片：`![说明](file:///D:/图.png)`、`![说明](D:\图.png)`。
 * 同样每次调用新建，理由见上。
 */
export function externalImageRe(): RegExp {
	return new RegExp(
		String.raw`!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:${EXT_ALTERNATION})>?)\)`,
		'gi'
	);
}
