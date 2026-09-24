/**
 * 行内扫描的共用判定（纯函数，不依赖 Obsidian API）。
 *
 * 「空格排版」与「智能公式」都要在同一行文字里找出"不能碰的地方"：
 * 行内代码、双链与图片、markdown 链接、链接与地址（URL / 邮箱 / 裸域名 / 主机端口）、
 * HTML 标签与实体、`%%注释%%`、`#标签`，
 * 以及已经写好的行内公式 `$…$`。各写一份必然各有各的边界 bug，
 * 所以统一放这里，两个模块共用同一套实现。
 */
import { inlineCodeRanges } from './line-scan';

/**
 * 空白字符：半角空格、Tab，以及从 Word / PDF 粘进来时常见的 **NBSP（U+00A0）**。
 *
 * NBSP 看起来和空格一模一样，但规则只认 0x20 的话就完全看不见它 ——
 * `设\u00A0$A$`、`矩阵\u00A0A\u00A0中` 这类行会一直是"看着排好了、其实一个字没动"。
 */
export function isSpaceChar(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\u00a0';
}

// ------------------------------------------------------------- 链接与地址

/**
 * 为什么链接要单独成组保护 —— 一次真实事故：
 *
 * 磁力链接 `magnet:?xt=urn:btih:…&dn=…&xl=…` 里没有 `//`，
 * 而原来的裸 URL 规则只认 `http(s)://` `file://` `obsidian://` 三种写法，
 * 于是整条链接被当成正文排版：`:` 后补一格（`magnet:? xt=urn: btih:`）、
 * `&` 两边各补一格、百分号里的 `10bit` 被"数字 ↔ 单位"拆成 `10 bit` ——
 * 复制出来就是一条废链接。同一条毛病的还有：
 *
 * - `ed2k://|file|…|`：scheme 不在白名单里，`abc.mkv` 被拆成 `abc. mkv`；
 * - `data:image/png;base64,…`、`mailto:a@b.com`、`tel:+86…`：没有 `//`；
 * - 裸域名 `www.example.com/x?y=1` → `www. example. com/x? y=1`；
 * - `localhost:8080` → `localhost: 8080`；`main.ts` → `main. ts`；
 * - UNC 路径 `\\server\share\file.txt` 里的文件名同样被拆；
 * - HTML 实体 `&nbsp;` → `&nbsp；`（分号被"半角标点换全角"吃掉）。
 *
 * 保护方式与其它区间一致：整段当一个"英文单词"，**里面一个字符都不动**，
 * 只按"中文 ↔ 英文"规则决定它与左右邻居之间那一格。
 */

/**
 * 链接的"尾巴"：URL 里能出现的字符，遇到这些就停 ——
 * 空白、尖括号、圆括号与方括号、中日韩标点、全角括号与引号。
 *
 * 中日韩**文字**照收：`https://a.com/中文English?x=1.2.2` 是作者写的地址，整体保住
 * （test/spacing.test.ts 钉着这一条）；中日韩**标点**一律不收 ——
 * `见 https://a.com/b，然后` 里那个逗号是正文的，吃进来会把后半句一起冻住。
 */
const URI_TAIL_CHAR = String.raw`[^\s<>()\[\]（）【】〖〗《》〈〉「」『』〔〕“”‘’′″、。，；：！？…‥—～·]`;
const URI_TAIL = `${URI_TAIL_CHAR}+`;

/** `scheme://…`：`//` 是硬标志，任何 scheme 都认（http / file / obsidian / smb / ed2k / ws…） */
const SLASH_SCHEME_RE = new RegExp(String.raw`[A-Za-z][A-Za-z0-9+.\-]*://${URI_TAIL}`, 'g');

/**
 * 不带 `//` 的 `scheme:…`：`magnet:`、`data:`、`mailto:`、`tel:`、`bitcoin:`…
 *
 * 这种写法跟"某个英文词 + 冒号"长得一模一样（`Note:this`），所以要求冒号后面
 * **紧贴着的那一段里得有 URI 记号**（`?` `=` `&` `%` `#` `@` `/` `+` `;`）才认：
 * `magnet:?xt=…`（`?`）、`data:text/plain;base64,…`（`/`）、`mailto:a@b.com`（`@`）、
 * `tel:+86…`（`+`）都算；`Note:this`、`word:word` 不算。
 */
const OPAQUE_SCHEME_RE = new RegExp(
	String.raw`[A-Za-z][A-Za-z0-9+.\-]*:(?=${URI_TAIL_CHAR}*[?=&%#@/+;])${URI_TAIL}`,
	'g'
);

/** 邮箱：`someone@example.com`（本地部分允许 `._%+-`，域名部分与 HOST_RE 同一套写法） */
const EMAIL_RE =
	/[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}/g;

/**
 * 裸域名 / 主机名，连带后面的路径、查询串与端口：
 * `www.bilibili.com/video/BV1xx?p=1`、`example.com:8080/admin`。
 *
 * 三条限制都是为了让"英文句子里的句号"不被当成域名：
 * 域名一律**小写**（`Hello.World!Yes` 该排成 `Hello. World! Yes`，`main.ts`、
 * `data.json` 这类文件名却是全小写的）、顶层域名要**两个字母以上**且**只由字母组成**。
 * 于是 `e.g.` `i.e.` `U.S.`、版本号 `v1.2.2`、小数点 `3.14`、IP `192.168.1.1`
 * 都不会被卷进来。
 */
const HOST_RE = new RegExp(
	String.raw`(?:[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?\.)+[a-z]{2,}(?::[0-9]{1,5})?(?:/${URI_TAIL})?`,
	'g'
);

/** `主机:端口`（名字里没有点的那种）：`localhost:8080`、`localhost:8080/admin` */
const HOST_PORT_RE = new RegExp(
	String.raw`[A-Za-z][A-Za-z0-9\-]*:[0-9]{1,5}(?![0-9])(?:/${URI_TAIL})?`,
	'g'
);

/**
 * HTML 实体：`&amp;` `&nbsp;` `&#39;` `&#x27;`。
 * 不收的话 `&` 会被当成"和号"补空格、`;` 会被"半角标点换全角"改成 `；`，
 * `&nbsp;` 就成了 `&nbsp；`。
 */
const HTML_ENTITY_RE = /&(?:[A-Za-z][A-Za-z0-9]{1,31}|#[0-9]{1,7}|#[xX][0-9A-Fa-f]{1,6});/g;

/**
 * 一行里"整体看待"的区间（左闭右开）：里面的字符不参与排版规则，
 * 只决定这个整体与左右邻居之间的距离。这也顺带挡住了里面的 `$`、`#`、`(`。
 */
export function collectMaskedRanges(line: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = inlineCodeRanges(line);

	/** 第二个元素是"前缀组"的长度：区间从 match.index + 前缀 开始，前缀本身不属于整体 */
	const patterns: Array<[RegExp, number]> = [
		[/!?\[\[[^\]\n]*\]\]/g, 0],                              // 双链与图片嵌入
		[/!?\[[^\]\n]*\]\([^()\n]*\)/g, 0],                      // markdown 链接与图片
		[/\[\^[^\]\n]*\]/g, 0],                                  // 脚注引用
		[SLASH_SCHEME_RE, 0],                                    // `scheme://…`
		[OPAQUE_SCHEME_RE, 0],                                   // `scheme:…`（磁力 / data / mailto…）
		[EMAIL_RE, 0],                                           // 邮箱
		[HOST_RE, 0],                                            // 裸域名 / 主机名（含路径与端口）
		[HOST_PORT_RE, 0],                                       // `主机:端口`
		[HTML_ENTITY_RE, 0],                                     // HTML 实体
		[/<[^<>\n]*>/g, 0],                                      // HTML 标签与自动链接
		[/%%[^%\n]*%%/g, 0],                                     // %%注释%%
		[/(?:^|[\s(（[【])#[^\s#，。、；：！？（）【】《》“”'"]+/g, 1], // #标签
	];

	for (const [pattern, prefix] of patterns) {
		for (const match of line.matchAll(pattern)) {
			if (match.index === undefined) continue;
			const start = match.index + prefix;
			const end = match.index + match[0].length;
			if (end > start) ranges.push([start, end]);
		}
	}

	// 合并重叠区间：`[[a]](b)` 可能被两条规则同时命中
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Array<[number, number]> = [];
	for (const range of ranges) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) {
			last[1] = Math.max(last[1], range[1]);
			continue;
		}
		merged.push([range[0], range[1]]);
	}
	return merged;
}

/**
 * 一行里"未被转义、也不在行内代码里"的 `$$` 位置。
 */
export function dollarPositions(line: string): number[] {
	const positions: number[] = [];
	const codeRanges = inlineCodeRanges(line);
	let at = line.indexOf('$$');

	while (at >= 0) {
		const escaped = at > 0 && line.charAt(at - 1) === '\\';
		const inCode = codeRanges.some(([start, end]) => at < end && at + 2 > start);
		if (!escaped && !inCode) positions.push(at);
		at = line.indexOf('$$', at + 2);
	}

	return positions;
}

/**
 * 整篇笔记里所有 `$$` 标记的位置（行号 + 列号），跳过保护区。
 * 公式排版的区块配对用它，配对逻辑见 mathRanges —— 扫描只有 dollarPositions 一份。
 */
export function dollarMarks(lines: string[], protectedLines: boolean[]): Array<{ line: number; column: number }> {
	const marks: Array<{ line: number; column: number }> = [];

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		for (const column of dollarPositions(lines[i] ?? '')) marks.push({ line: i, column });
	}

	return marks;
}

/**
 * 每行"可以排版"的区间（左闭右开）；`null` 表示整行跳过。
 *
 * - **同一行里成对的 `$$…$$`**（`公式如下：$$e^{At} = …$$`）不是区块：整行照常排版，
 *   公式本身由 token 层当成一段整体跳过。整行跳过的话，
 *   `1.矩阵指数$e^{At}$是…$$…$$` 里 `1.` 后面缺的空格、公式两侧缺的空格全都修不了。
 * - **跨行的 `$$ … $$` 区块**：中间那些行整行是 LaTeX 代码，必须跳过；
 *   起始行 `$$` **之前**、结束行 `$$` **之后**的正文仍要排版。
 * - **落单的 `$$`**（没配成对）：不当区块，整行按普通文字处理，免得吃掉后面整篇。
 */
export function mathRanges(lines: string[], protectedLines: boolean[]): Array<[number, number] | null> {
	const ranges: Array<[number, number] | null> = lines.map((line) => [0, (line ?? '').length]);
	let open = -1;

	for (let i = 0; i < lines.length; i++) {
		if (protectedLines[i]) continue;
		const line = lines[i] ?? '';
		const positions = dollarPositions(line);
		if (positions.length === 0) {
			if (open >= 0) ranges[i] = null;
			continue;
		}

		if (open < 0) {
			// 成对 → 行内显示公式，整行照排；奇数 → 这一行开启一个跨行区块
			if (positions.length % 2 === 0) continue;
			open = i;
			ranges[i] = [0, positions[0] as number];
			continue;
		}

		// 区块内部的行：整行是代码
		for (let k = open + 1; k < i; k++) ranges[k] = null;
		if (positions.length % 2 === 1) {
			// 收尾：`$$` 之后若还有正文，那部分照排
			ranges[i] = [(positions[0] as number) + 2, line.length];
			open = -1;
			continue;
		}
		// 收尾又在同一行开启新块：中间那段落在两个公式之间，保守起见整行不排
		ranges[i] = null;
		open = i;
	}

	// 没闭合：不算区块，把这批行恢复成整行排版
	if (open >= 0) {
		for (let k = open; k < lines.length; k++) {
			if (!protectedLines[k]) ranges[k] = [0, (lines[k] ?? '').length];
		}
	}

	return ranges;
}

/**
 * 「整行别碰」的公式行 —— 只从 mathRanges 派生，判定只有一条：
 * **这一行不能整行当普通文字排**。
 *
 * - `null`（跨行 `$$` 区块内部，整行是 LaTeX 代码）→ 别碰：里面的 `#fff`、`|` 都不是正文；
 * - 起始行 `$$` 之前、结束行 `$$` 之后（只有一部分可排）→ 也整行别碰 ——
 *   行级消费者（标签归位、板块排序）没有"只排某一段"的能力，缩成整行跳过最安全，
 *   否则标签可能被挪进公式代码里；
 * - **同一行里成对的 `$$…$$`**（`正文 $$e^{At}$$ 后面`）→ 整行照常排版，不算别碰：
 *   公式本身在 token 层当一段整体跳过，标签归位挪的是行内文字，碰不到公式。
 *
 * 最后这条正是以前两套判定打架的地方：`line-scan.markMathLines` 把含 `$$` 的行一律当保护区，
 * 而 `mathRanges` 认为成对 `$$` 的行整行可排 —— 「标签该不该归位」于是表现不一致。
 * 现在两种问法都由这里回答，`markMathLines` 已删除。
 */
export function mathOpaqueLines(lines: string[], protectedLines: boolean[]): boolean[] {
	return mathRanges(lines, protectedLines).map((range, index) => {
		if (range === null) return true;
		return !(range[0] === 0 && range[1] === (lines[index] ?? '').length);
	});
}

/**
 * 读一段行内公式。
 *
 * 识别方式与 Obsidian、latex.ts 保持一致：`$` 内侧紧贴内容才算公式，
 * `$ 5 与 $` 这种不会误判；`$$…$$` 整体当一段公式。
 *
 * @returns 公式文本与下一个位置；不是公式时返回 null
 */
export function readInlineMath(
	line: string,
	start: number,
	inCode: (at: number) => boolean
): { text: string; next: number } | null {
	if (line.charAt(start) !== '$') return null;
	if (inCode(start)) return null;

	// `$$ … $$`（同一行内成对）
	if (line.charAt(start + 1) === '$') {
		for (let i = start + 2; i < line.length - 1; i++) {
			if (line.charAt(i) !== '$' || line.charAt(i + 1) !== '$') continue;
			return { text: line.substring(start, i + 2), next: i + 2 };
		}
		return null;
	}

	if (/\s/.test(line.charAt(start + 1))) return null;

	for (let i = start + 1; i < line.length; i++) {
		if (line.charAt(i) !== '$') continue;
		if (line.charAt(i - 1) === '\\' || line.charAt(i + 1) === '$' || inCode(i)) continue;
		// 收尾 `$` 前面紧贴内容才算公式
		if (/\s/.test(line.charAt(i - 1))) return null;
		return { text: line.substring(start, i + 1), next: i + 1 };
	}
	return null;
}
