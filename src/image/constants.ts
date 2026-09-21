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
 * 指向磁盘绝对路径的外部图片：`![说明](file:///D:/图.png)`、`![说明](D:\图.png)`。
 * 同样每次调用新建，理由见上。
 */
export function externalImageRe(): RegExp {
	return new RegExp(
		String.raw`!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:${EXT_ALTERNATION})>?)\)`,
		'gi'
	);
}
