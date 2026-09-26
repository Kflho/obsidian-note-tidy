/**
 * 「第一章，第一课，附录1 等标题和标题内容之间需要加空格」（文字格式 / 中文 1）的**判定**。
 *
 * 只做一件事：在一行文本里找出所有"标题标记"（`第一章` `第一节` `第一课` `附录A` `附录1`），
 * 并给出标记之后标题内容的位置。两处用它，口径必须是同一份：
 * - **空格排版**（spacing/）：分词器按标记边界把 `第一章矩阵` 切成两块，空格判定再补那一格；
 * - **智能公式**（math-wrap.ts）：扫描前临时在标记与内容之间补一格（只用于识别、不写进结果），
 *   否则 `附录A矩阵` 里的 `A` 会被当成变量包成 `$A$` —— 包完标记就不相连，
 *   空格规则再也认不出这是标题了。
 *
 * 判定一律在**行文本**上按字符位置做，不依赖任何分词结果。
 */

/** 序号：汉字数字或阿拉伯数字 */
const CHAPTER_NUMBER = '[0-9一二三四五六七八九十百千零〇两]+';

/** `第 3 章` `第一章`：序号后面必须跟章 / 课 / 节这类量词，且后面不能再跟数字（`12月` 不算章） */
const CHAPTER_RE = new RegExp(`第${CHAPTER_NUMBER}[章节课讲篇](?![0-9])`, 'g');

/**
 * `附录A` `附录1` `附录一`。
 *
 * ⚠️ 序号**必填**：`附录矩阵的证明` 这种没写序号的标题认不出来 ——
 * "附录"后面直接跟汉字时，"附录里的内容"「附录和正文」这类普通句子与它长得一模一样，
 * 没有任何依据可以分开（排版不猜），所以宁可不认。要享受这条规则就把序号写上。
 */
const APPENDIX_RE = /附录[0-9A-Za-z一二三四五六七八九十百千]+/g;

/** 标题标记：`from` 是标记起点、`boundary` 是标记之后（标题内容）的起点 */
export interface ChapterMarker {
	from: number;
	boundary: number;
}

/** 一行里所有的标题标记（去重、升序） */
export function chapterMarkers(line: string): ChapterMarker[] {
	const seen = new Map<number, ChapterMarker>();

	for (const re of [CHAPTER_RE, APPENDIX_RE]) {
		re.lastIndex = 0;
		for (const match of line.matchAll(re)) {
			const from = match.index ?? 0;
			seen.set(from + match[0].length, { from, boundary: from + match[0].length });
		}
	}

	return [...seen.values()].sort((a, b) => a.boundary - b.boundary);
}

/** 第一个标记在 `at` 处结束就返回它（`at` 就是标题内容的起点），否则返回 null */
export function chapterMarkerAt(line: string, at: number): ChapterMarker | null {
	return chapterMarkers(line).find(marker => marker.boundary === at) ?? null;
}

/** 汉字、假名、谚文、全角字母数字 —— 标题内容必须由这些字开头 */
export const CHAPTER_BODY_RE = /[\u3005-\u3007\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/;

/** 标记后面是这些就不补空格：标点与开括号本身已经隔开了 */
export const CHAPTER_BLOCK = new Set<string>([
	...'、。，；：！？…—～·“”‘’（）【】「」『』〔〕〖〗｛｝《》〈〉',
	',.!?:;',
]);

/**
 * 补格子的位置还要再排除连接词：`第一章的用法`、`第一章中的定理` ——
 * 那是正文在指代第一章，不是"标题 + 标题内容"。`第一章节目单` 这种则照补
 * （`节目单` 是内容，第二个量词只是内容的一部分，这里不猜）。
 */
export const CHAPTER_SKIP = new Set<string>([...'的之与和中里内上下前后所是对把被为以能会要可就也都还而并或等则']);

/**
 * 标记与标题内容紧贴时补一格：`第一章矩阵` → `第一章 矩阵`、`附录A矩阵` → `附录A 矩阵`。
 *
 * - 标记后面没有内容（整行只有 `第一章`、`附录A`）、或后面是标点 / 连接词 → 不补（返回 null）；
 * - 已经空开的保持原样（`第一章  矩阵` 不改成一格 —— 交给"中文与中文之间的空格不动"）。
 *
 * @param line 那一行的完整文本（含行首标记，位置就是行内下标）
 * @param from 标记的开始位置
 * @param boundary 标记的结束位置（标题内容从这里开始）
 */
export function chapterGap(line: string, from: number, boundary: number): string | null {
	if (from < 0 || boundary <= from || boundary >= line.length) return null;
	const body = line.charAt(boundary);
	if (!CHAPTER_BODY_RE.test(body)) return null;
	if (CHAPTER_BLOCK.has(body) || CHAPTER_SKIP.has(body)) return null;
	return ' ';
}

/** `附录` 后面紧跟的序号：`附录A` / `附录1` / `附录一`；没有序号时返回空串 */
const APPENDIX_LABEL_RE = /^[0-9A-Za-z一二三四五六七八九十百千]+$/;

/**
 * 这个 piece 是不是"附录 + 序号"整块（`附录A`）——
 * 序号与"附录"之间不该有空格，分词器要把这种写法并成一个 piece。
 */
export function appendixLabelPiece(text: string): boolean {
	if (!text.startsWith('附录')) return false;
	const label = text.substring(2);
	return label !== '' && APPENDIX_LABEL_RE.test(label);
}
