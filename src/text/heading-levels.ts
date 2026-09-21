import { markIndentedCodeLines, markProtectedLines } from './line-scan';

/**
 * 标题级别整理（纯函数，不依赖 Obsidian API）。
 *
 * **保证子标题与父标题恰好差一级**：
 * - `# 标题` 下面直接写 `#### 子标题`（跳了两级）→ 压成 `## 子标题`；
 * - 同级标题保持同级（`## 甲` / `## 乙` 不会因为中间夹了个 `####` 就变成父子）；
 * - 回退时回到正确的父级（`# → ### → ##` → 第二、三个标题都变成 `##`，是兄弟不是父子）。
 *
 * ## "同时改多个标题"必须并行算
 *
 * 新级别**全部从原始级别一次算出**：先扫一遍收集标题，再统一改写。
 * 边算边改（拿"上一个标题的新级别"当依据）会把并列的标题推成嵌套 ——
 * `# → ### → ###` 会被算成 `# → ## → ###`，两节并列变成一节套一节，
 * 而且改的标题越多、错得越远。所以这里刻意分成"收集 + 计算"和"改写"两遍。
 *
 * 新级别 = **首个标题的级别** + （在标题树里的深度 − 1）。
 * 首个标题保持原级别：规范里"引用其他笔记的标题内容时需要额外写一个相同的标题防止分级错误"
 * 说的正是从半截开始的标题（`##` 起头的笔记是接着上一层的分级），不能硬掰成 `#`。
 *
 * 不碰的地方：frontmatter、围栏 / 缩进代码块、`#标签`（`#` 后面没有空白就不是标题，
 * 加了空格反而会把它变成标题）、块引用里的标题（`> ## 标题` 属于引用内容，整行不动）。
 * 行首缩进原样保留，只改 `#` 的个数。
 */

/** ATX 标题：`#` 后面必须是空白或行尾（`#标签` 不算，`---` 这类分隔线也不沾边） */
const HEADING_RE = /^([ \t]*)(#{1,6})(?=[ \t]|$)/;

/** 标题最多 6 级 */
const MAX_LEVEL = 6;

interface Heading {
	line: number;
	indent: string;
	/** 原始级别（`#` 的个数） */
	level: number;
	/** `#` 之后的一切（空白 + 标题文字 + 可选的收尾井号），原样保留 */
	rest: string;
	/** 算出来的新级别 */
	newLevel: number;
}

/**
 * 整理标题级别。
 *
 * @param content 笔记原文
 * @returns 处理后的内容；没有任何改动时原样返回（调用方据此避免无谓写盘）
 */
export function fixHeadingLevels(content: string): string {
	if (content === '') return content;

	const lines = content.split('\n');
	const protectedLines = markProtectedLines(lines);
	const codeLines = markIndentedCodeLines(lines);

	// ---- 第一遍：只收集，一个字都不改 ----
	const headings: Heading[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i] || codeLines[i]) continue;
		const line = lines[i] ?? '';
		const match = HEADING_RE.exec(line);
		if (!match) continue;
		headings.push({
			line: i,
			indent: match[1] ?? '',
			level: (match[2] ?? '').length,
			rest: line.substring(match[0].length),
			newLevel: 0,
		});
	}
	if (headings.length === 0) return content;

	// ---- 算新级别：整棵标题树一次算完，彼此只看原始级别 ----
	const base = headings[0]?.level ?? 1;
	/** 祖先链（存的是**原始**级别）：`# → ### → ##` 里第三个标题会把 `###` 弹掉 */
	const ancestors: number[] = [];

	for (const heading of headings) {
		while (ancestors.length > 0 && (ancestors[ancestors.length - 1] ?? 0) >= heading.level) {
			ancestors.pop();
		}
		const depth = ancestors.length + 1;
		heading.newLevel = Math.min(MAX_LEVEL, base + depth - 1);
		ancestors.push(heading.level);
	}

	// ---- 第二遍：统一改写（并行地一次性落地，不边改边算）----
	let changed = false;
	for (const heading of headings) {
		if (heading.newLevel === heading.level) continue;
		lines[heading.line] = `${heading.indent}${'#'.repeat(heading.newLevel)}${heading.rest}`;
		changed = true;
	}

	return changed ? lines.join('\n') : content;
}
