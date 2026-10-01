/**
 * 「一段内容在笔记里的上下文缩进」。
 *
 * 用在哪：**粘贴聊天记录自动修复**与**排版选中内容**（`tasks.ts` 的 `typesetEditorRange`）。
 * 两者都只把一段文字（刚粘进来的那一段 / 选中的那一段）交给排版流水线，而流水线只看这段文字本身
 * —— 它不知道这段文字落在笔记的哪一层。于是就出现了两个毛病：
 *
 * 1. **缩进对不上上下文**：在列表项里按回车（Obsidian 自动缩进 2 格）后粘贴，第一行落在光标那一列，
 *    后面几行却从第 0 列开始；排版结果整块也就"挂"在半空中，看着与上下文不是一层。
 * 2. **接缝多出空行**：排版结果最后总会带一个换行（消息正文按行收尾），写回编辑器时
 *    与后面的内容一拼就多出一个空行 —— 粘贴块与上下文之间凭空多了一行。
 *
 * 这个模块只做几件纯函数的事：**算出这一段该用哪个缩进前缀**（`resolveRangeIndent`）、
 * **排版前把原本那一层缩进剥掉**（`dedentBy`）、**排完版把整块放到光标那一层**（`placeBlockAt`）、
 * **把整块平移到某一层**（`shiftBlockTo`：粘进来的那一段不像聊天记录时只做这一件）、
 * **把首尾换行数还原成粘贴前的样子**（`keepEdgeNewlines`）。顺序不能换：先剥后放，
 * 否则"排完版再剥"会连流水线自己写的缩进一起剥掉（光标缩进与正文缩进都是 tab 时就是这条踩的坑）。
 *
 * ## 缩进按谁算：光标在哪儿就是哪儿
 *
 * 按**光标（选区起点）处的"续行前缀"**算：行首的空白与 `>` 链（`> `、`  > `）。
 * 光标放在第几层，这一段就排在第几层 —— 与编辑器自动缩进的结果一致：在列表项里按回车后粘贴，
 * 整块都留在列表项里；在引用块里粘贴，每一行都带 `>`。
 *
 * **不参考上下文的其它行**：那是猜。用户把光标放在哪一列是明确的意思，拿上下相邻行的缩进去
 * 否掉它（"上下都是顶格，所以你也不许缩进"）只会让结果莫名其妙 —— 2026-09 先加过后又撤掉。
 *
 * 前缀前面已经有正文时（`- 记录：|`、`前面一句话 |`）没有可用的缩进参照，这一段保持顶格 ——
 * 猜"该不该另起一行"只会把用户自己写的行拆坏（宁可不动，见 `structure.chat-log` 的取舍）。
 */

/**
 * 行首的"续行前缀"：整段只由空白与 `>`（可跟一格空格）组成时返回它，否则返回 null。
 *
 * - 返回 null：光标前面已经有正文或列表符号（`- 记录：|`、`前面一句 |`）——
 *   这一段不是从行首开始的，没有可用的缩进参照；
 * - 返回 `''`：顶格；
 * - `>` 一律归一成 `> `（与本插件的标记排版同一条规矩）。
 */
export function continuationPrefix(linePrefix: string): string | null {
	let out = '';
	let i = 0;
	while (i < linePrefix.length) {
		const char = linePrefix.charAt(i);
		if (char === ' ' || char === '\t') {
			out += char;
			i++;
			continue;
		}
		if (char === '>') {
			out += '> ';
			i++;
			if (linePrefix.charAt(i) === ' ' || linePrefix.charAt(i) === '\t') i++;
			continue;
		}
		return null;
	}
	return out;
}

/** 两段文本的共同开头 */
function sharedPrefix(a: string, b: string): string {
	let i = 0;
	while (i < a.length && i < b.length && a.charAt(i) === b.charAt(i)) i++;
	return a.substring(0, i);
}

/**
 * 这一段**自己**各行共有的行首缩进（纯空白）。
 *
 * 两处用得上：选区（缩进常常已经包含在选区里，那就按它自己这一层来）与排版结果
 * （整块自己的那一层，见 `placeBlockAt`）。各行对不上（例如只有第一行带缩进）时返回 ''。
 */
export function commonIndent(text: string): string {
	let common: string | null = null;
	for (const line of text.split('\n')) {
		if (line.trim() === '') continue;
		const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
		common = common === null ? indent : sharedPrefix(common, indent);
	}
	return common ?? '';
}

export interface RangeIndent {
	/** 要加到这一段每一行前面的前缀；`''` = 不缩进（整块顶格） */
	prefix: string;
	/**
	 * 这一段原本的缩进（决定 `prefix` 的那一层）。
	 * 排版**之前**要先用 `dedentBy` 把它从行首剥掉：流水线不认识这一层，
	 * 留着它就会与"消息正文缩进"叠在一起（见 `dedentBy` 的说明）。
	 */
	baseIndent: string;
	/** 替换范围的起点：起始行已有的结构前缀会被一起吃掉重写（只吃空白与 `>` 链） */
	from: number;
}

/**
 * 算出 `[from, to)` 这一段该用的缩进前缀，以及替换范围该从哪儿开始。
 *
 * @param document 编辑器里的整篇内容（偏移按它算）
 * @param from 这一段在文档里的起点（粘贴起点 / 选区起点）
 * @param to 这一段的终点（粘贴后的光标处 / 选区终点）
 */
export function resolveRangeIndent(document: string, from: number, to: number): RangeIndent {
	const start = Math.max(0, Math.min(from, document.length));
	const end = Math.max(start, Math.min(to, document.length));
	if (end <= start) return { prefix: '', baseIndent: '', from: start };

	// 这一段自己已有的缩进（选区常见：缩进已经在选区里）
	const own = commonIndent(document.substring(start, end));

	const lineStart = document.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
	const structural = continuationPrefix(document.substring(lineStart, start));

	// 光标前已经有正文 / 列表符号：吃不到结构前缀，保持顶格
	if (structural === null) return { prefix: own, baseIndent: own, from: start };
	// 缩进已经在这一段里（选区）：按它自己那一层，别照光标位置重算
	if (own !== '') return { prefix: own, baseIndent: own, from: lineStart };

	// 光标在哪儿就是哪儿
	return { prefix: structural, baseIndent: structural, from: lineStart };
}

/**
 * 把这一段原本那一层缩进从每行行首剥掉 —— 排版**之前**做，让流水线看到的是"顶格的这一段"。
 *
 * ## 为什么必须在排版之前剥
 *
 * 剥掉的那一层要等排完版再加回去（`applyIndentPrefix` 的 `prefix`）。如果反过来"排完版再剥"，
 * 就会把流水线自己写出来的缩进一起剥掉 —— 最典型的是**光标处的缩进与「消息正文缩进」用同一个字符**
 * （都用 tab）时：正文行是 `\t你好`，前缀也是 `\t`，剥掉再补回去等于把正文那一格吃了
 * （2026-09 用户报的"1 层缩进粘贴后还是 1 层、0 层却变成 1 层"）。
 *
 * @param baseIndent 整段共有的那一层缩进（`commonIndent` 的结果），每行都确实带着它
 */
export function dedentBy(text: string, baseIndent: string): string {
	if (baseIndent === '' || text === '') return text;
	return text
		.split('\n')
		.map(line => (line.startsWith(baseIndent) ? line.substring(baseIndent.length) : line))
		.join('\n');
}

/** 给这一段每一行加前缀；空行不加（免得留下只有空白的行） */
export function applyIndentPrefix(text: string, prefix: string): string {
	if (prefix === '' || text === '') return text;
	return text.split('\n').map(line => (line.trim() === '' ? line : prefix + line)).join('\n');
}

/**
 * 把排版结果整块放到 `prefix` 这一层 —— **块的缩进就是这一层，不再往上加**。
 *
 * 先收掉整块自己共有的那一层缩进（`commonIndent`），再加上前缀：于是块的**第一行落在光标那一列**，
 * 块内部的相对缩进原样保留（有头部行时，正文比头部深一格；没有头部行、整块都是正文时，
 * 正文那一格就并入光标这一层 —— 这正是"光标缩进是多少，粘完就是多少"，2026-09 用户报的
 * "稳定多一层"）。
 *
 * ⚠️ 别改成"前缀 + 原文"直接相加：正文行自己已经带着「消息正文缩进」，
 * 加出来就永远比光标处多一层。
 */
export function placeBlockAt(text: string, prefix: string): string {
	return applyIndentPrefix(dedentBy(text, commonIndent(text)), prefix);
}

/**
 * 整块**平移到** `prefix` 这一层：先剥掉**首行**那一层缩进，再给每一行加前缀。
 *
 * 与 `placeBlockAt` 只差一处：剥的是**首行**的缩进，不是"各行共有的那一层"。
 * 粘贴进来的那一段正好是"首行在光标那一列、其余行顶格"：它前面那截缩进在段外，
 * 段内各行共有的缩进是空串 —— 用 `placeBlockAt` 的话一个字符都不会剥，首行会被加出两层。
 * 而首行那一截就是"这一段现在落在哪一层"，按它剥再按光标那一层加，正好落到该在的地方。
 *
 * 整段本来就齐整（聊天记录排版的结果就是这样）时两者一致：`commonIndent` 的结果就是首行那一截，
 * 于是"剥一层再加一层"= 原样。
 *
 * **幂等**：重复执行结果一样（第二次的首行缩进就是 `prefix`，剥掉再加回来还是它）。
 *
 * @param prefix 目标那一层的前缀；空串 = 这一段不动
 */
export function shiftBlockTo(text: string, prefix: string): string {
	if (prefix === '' || text === '') return text;
	const firstIndent = /^[ \t]*/.exec(text)?.[0] ?? '';
	return applyIndentPrefix(dedentBy(text, firstIndent), prefix);
}

/**
 * 接缝处理：把排版结果**首尾的换行数**还原成原文的样子。
 *
 * 排版流水线给聊天记录收尾时总会补一个换行，写回编辑器时与后面的内容一拼就多出一个空行
 * （粘贴块与下文之间凭空多一行）。粘贴进来的那一段本来有没有换行、有几个，
 * 由原文说了算 —— 排版只改中间的内容，不改变这一段与上下文的接缝。
 */
export function keepEdgeNewlines(original: string, formatted: string): string {
	if (formatted === '') return formatted;
	const lead = /^\n*/.exec(original)?.[0].length ?? 0;
	const trail = /\n*$/.exec(original)?.[0].length ?? 0;
	const core = formatted.replace(/^\n+/, '').replace(/\n+$/, '');
	if (core === '') return '\n'.repeat(lead + trail);
	return '\n'.repeat(lead) + core + '\n'.repeat(trail);
}
