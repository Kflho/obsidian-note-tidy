/**
 * QQ/微信聊天记录排版引擎。
 *
 * 从 main.ts 中抽出为纯函数：输入原始文本，输出排版后的文本，除参数外不依赖任何
 * Obsidian API。这样既能保持 main.ts 精简，也便于脱离 Obsidian 单独验证幂等性。
 *
 * 严格幂等：重复执行不会产生多余空行、不会破坏已有排版。
 */

/** 一条消息内同时含图片与文字时，图片的位置 */
export type ChatImageOrder = 'keep' | 'above' | 'below';

/** 正文缩进方式 */
export type ChatIndent = 'tab' | '2' | '4' | 'none';

export interface ChatLogOptions {
	/** 是否输出用户名 */
	showUsername: boolean;
	/** 是否输出日期 */
	showDate: boolean;
	/** 是否输出时间 */
	showTime: boolean;
	/** 实际缩进字符串，空字符串表示不缩进 */
	indent: string;
	/** 图片与文字的相对位置 */
	imageOrder: ChatImageOrder;
	/**
	 * 相邻消息之间是否留空行（**总开关**，与头部信息开不开无关）：
	 * - 关（默认）：消息紧挨着，**源文里带的空行也去掉**（QQ / 微信 复制出来的记录常在消息之间带空行，
	 *   而它们本来就由头部或缩进分开）；
	 * - 开：相邻消息之间恰好留一行（源文里空了几行也只留一行）。
	 *
	 * 中间夹着作者自己的正文时不算"相邻消息"，那一段空白原样保留。
	 */
	blankLineBetweenMessages: boolean;
	/** 相邻消息的时间戳与粘贴顺序不一致时，是否按时间先后输出（见 sortAdjacentMessages） */
	sortByTime: boolean;
	/** 是否去掉正文里的 `@昵称` 提及（见 stripMentions） */
	stripMentions: boolean;
}

/**
 * 默认：用户名/日期/时间全显示、Tab 缩进、不调整图片顺序、相邻消息之间不留空行。
 *
 * ⚠️ 「不留空行」现在连**源文里消息之间的空行**一起收掉（见 `blankLineBetweenMessages`），
 * 所以默认值不再等于"旧版本原样"：已经排好版的聊天记录不含时间戳，不会被重新排版，
 * 只有**新粘进来的**记录才会看出差别。
 */
export const DEFAULT_CHAT_LOG_OPTIONS: ChatLogOptions = {
	showUsername: true,
	showDate: true,
	showTime: true,
	indent: '\t',
	imageOrder: 'keep',
	blankLineBetweenMessages: false,
	sortByTime: true,
	// 删正文是不可逆的改动，默认不开；要用的在设置里打开
	stripMentions: false,
};

/**
 * 正文里的 @ 提及：`@昵称`（QQ / 微信 复制出来的回复标记）。
 *
 * - 半角 `@` 与全角 `＠` 都认；
 * - 前面不能是字母数字等下划线以外的"词字符" —— 否则 `foo@bar.com` 里的 `@bar.com` 会被误当成提及
 *   （行首、空白、标点后面都算提及的位置）。用后顾断言看**原文**，所以
 *   `@张三 @李四 大家好` 这种连着写的也能两个都匹配上；
 * - 昵称取"连续的非空白字符"（昵称里带空格的情况没法从纯文本判断，只能取到空格为止）；
 * - 提及后面的空白一并吃掉，前面那格留着当分隔（`你好 @张三 再见` → `你好 再见`）。
 */
const MENTION_RE = /(?<![\w@＠])[@＠][^\s@＠]+[ \t\u00A0\u2005]*/g;

/**
 * 去掉正文里的 `@昵称` 提及（聊天记录排版的可选步骤，默认关）。
 *
 * 逐行处理：提及被删掉后整行变空的（例如一条消息的正文就是 `@张三`），整行也一并去掉 ——
 * 否则会留下只剩缩进的空行。原本就是空行的行保持原样（那是作者写的段落间隔）。
 *
 * @param text 消息正文（可多行）
 * @returns 去过提及的正文；没有提及或不需要改动时原样返回
 */
export function stripMentions(text: string): string {
	if (!text || !/[@＠]/.test(text)) return text;

	const lines = text.split('\n').map(line => {
		const before = line;
		const after = line.replace(MENTION_RE, '').trim();
		return { before, after };
	});

	// 原本就空的行留着，被提及"清空"的行丢掉
	const kept = lines.filter(item => item.after !== '' || item.before === '');
	const result = kept.map(item => item.after).join('\n');
	return result === text ? text : result;
}

/** 时间戳锚点（与旧实现一致） */
const TIME_ANCHOR_RE =
	/(?:\d{1,4}[-/]\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}[-/]\d{1,2}(?::?\s+)?\d{1,2}:\d{2}:\d{2})|(?:\d{1,2}:\d{2}:\d{2})/g;

/** 一个时间戳锚点在原文中的位置与原文 */
interface TimeAnchor {
	start: number;
	end: number;
	text: string;
}

/** 扫出文本里所有时间戳锚点（排版与"这像不像聊天记录"共用同一把尺子） */
function findTimeAnchors(text: string): TimeAnchor[] {
	const anchors: TimeAnchor[] = [];
	const regex = new RegExp(TIME_ANCHOR_RE.source, 'g');
	let m: RegExpExecArray | null;
	while ((m = regex.exec(text)) !== null) {
		anchors.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
	}
	return anchors;
}

/** 时间戳之前最后一个非空白 token —— 旧实现用来识别用户名 */
const USER_BEFORE_ANCHOR_RE = /([^\n[\]\s:|：]+)\s*[:：]?\s*$/;

/**
 * 本插件排版结果的"无用户名头部"：整行只有归一化后的时间戳。
 * 归一化 = 用 `/` 分隔且补零，与旧实现写出的头部格式一致。
 * 原始聊天文本常用 `-` 分隔或未补零（2024/1/5 14:30:25），不会命中。
 */
const NORMALIZED_HEADER_RE = /^(?:\d{4}\/\d{2}\/\d{2} )?\d{2}:\d{2}:\d{2}$/;

/**
 * 图片链接识别：Obsidian 双链嵌入（限定图片扩展名，避免误伤笔记嵌入）
 * 或 Markdown 图片语法。每次调用返回新的正则对象，避免 /g 状态残留。
 */
function imageTokenRegex(): RegExp {
	return /!\[\[[^\]\n]*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)(?:\|[^\]\n]*)?\]\]|!\[[^\]\n]*\]\([^)\n]*\)/gi;
}

/** 缩进选项 → 实际缩进字符串（未知取值回退为 Tab，兼容手改 data.json） */
export function resolveIndent(indent: string): string {
	switch (indent) {
		case 'tab':
			return '\t';
		case '2':
			return '  ';
		case '4':
			return '    ';
		case 'none':
			return '';
		default:
			return '\t';
	}
}

/**
 * 按设置拼装头部行。用户名/日期/时间可分别开关：
 * - 全部开启 → `用户名: 2024/01/05 14:30:25`（与旧版本一致）
 * - 仅用户名 → `用户名:`
 * - 隐藏用户名 → `2024/01/05 14:30:25`
 * - 全部关闭 → 空字符串，调用方不输出头部行
 */
function buildHeaderLine(
	userName: string,
	dateVal: string,
	timeVal: string,
	options: ChatLogOptions
): string {
	const timePart = [
		options.showDate ? dateVal : '',
		options.showTime ? timeVal : '',
	].filter(Boolean).join(' ');

	if (options.showUsername) {
		return timePart ? `${userName}: ${timePart}` : `${userName}:`;
	}
	return timePart;
}

/**
 * 收集所有图片链接在原文中的区间。
 *
 * 用途：用户名正则是"时间戳前最后一个非空白 token"，当正文以 Markdown 图片
 * `![说明](D:\pic\a.png)` 结尾时，它会抓走 `a.png)` 这种图片路径片段当成用户名，
 * 导致图片链接被切断。落在图片区间内的候选一律不算用户名。
 */
function collectImageRanges(rawContent: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const re = imageTokenRegex();
	let m: RegExpExecArray | null;
	while ((m = re.exec(rawContent)) !== null) {
		ranges.push([m.index, m.index + m[0].length]);
		if (m.index === re.lastIndex) re.lastIndex++;
	}
	return ranges;
}

/** 候选区间是否与任一图片链接区间重叠 */
function overlapsImageToken(ranges: Array<[number, number]>, start: number, end: number): boolean {
	for (const [rangeStart, rangeEnd] of ranges) {
		if (start < rangeEnd && end > rangeStart) return true;
	}
	return false;
}

/**
 * 返回"用户名之前的行首缩进"的起点。
 *
 * 头部行自身带的缩进（`" \t李四 2024/1/5 14:31:02"` 里 `"李四"` 前面那截）不属于
 * 上一条消息的正文：用户名被抽出来重新拼头部后，这截空白如果不丢掉，就会以
 * "只剩空格与 Tab 的一行"留在两条消息之间 —— 也就是 `" \t"` 这类脏缩进的来源之一，
 * 每排一次版就多留一行。
 */
function skipIndentBefore(content: string, index: number): number {
	let start = index;
	while (start > 0) {
		const previous = content.charAt(start - 1);
		if (previous !== ' ' && previous !== '\t') break;
		start--;
	}
	return start;
}

/**
 * 判断某个时间戳是否为本插件排版结果的"无用户名头部"，是则返回该行起始位置，否则返回 -1。
 *
 * 隐藏用户名时，头部是独占一行的归一化时间戳。重新解析这类内容必须直接按
 * "无用户名消息"处理 —— 否则上一条正文的末行（或聊天记录上方笔记的最后一个词）
 * 会被用户名正则误判成用户名并丢弃，造成内容丢失。
 *
 * 返回行首位置，供调用方把该行之前的文本原样保留。
 */
function findUsernameLessHeaderLine(rawContent: string, anchorStart: number, anchorEnd: number): number {
	const lineStart = rawContent.lastIndexOf('\n', anchorStart - 1) + 1;
	// 时间戳必须独占一行：前面不能有用户名，后面不能有正文
	if (rawContent.substring(lineStart, anchorStart).trim() !== '') return -1;

	let lineEnd = rawContent.indexOf('\n', anchorEnd);
	if (lineEnd === -1) lineEnd = rawContent.length;
	if (rawContent.substring(anchorEnd, lineEnd).trim() !== '') return -1;

	return NORMALIZED_HEADER_RE.test(rawContent.substring(anchorStart, anchorEnd)) ? lineStart : -1;
}

/** 这个时间戳是不是"一条消息的头部" */
function isMessageHeader(text: string, anchor: TimeAnchor): boolean {
	// ① 本插件写出的无用户名头部：整行只有归一化时间戳
	if (findUsernameLessHeaderLine(text, anchor.start, anchor.end) >= 0) return true;
	// ② QQ / 微信 的头部：时间戳在同一行，前面是用户名
	const lineStart = text.lastIndexOf('\n', anchor.start - 1) + 1;
	return USER_BEFORE_ANCHOR_RE.test(text.substring(lineStart, anchor.start));
}

/**
 * 这一条头部**单独就够确定**是聊天记录吗（见 `looksLikeChatLog` 的两条判据）。
 *
 * 两条都要求**头部后面确实还有正文**（这一行剩下的、或下面还有行）：孤零零一行
 * `会议 14:30:25` 不算 —— 那更像作者自己写的一行记录，被当成消息排掉就是丢字
 * （头部信息全关时那行会整个消失）。
 */
function isDecisiveHeader(text: string, anchor: TimeAnchor): boolean {
	const after = text.substring(anchor.end);
	if (after.trim() === '') return false;

	// ① 带日期的头部：`2024/1/5 14:30:25`、`09-27 19:41:38`（日期分隔符必是 `/` 或 `-`），
	//    以及本插件写出的 `2024/01/05 14:30:25`。这种形状在正文里几乎不会出现，
	//    而 QQ / 微信 复制单条消息给出的正是它。
	if (/[-/]/.test(anchor.text)) return true;

	// ② 只有时分秒的头部：时间戳必须**独占行尾**（正文在下一行）。
	//    `会议 14:30:25 开始` 这种后面还跟着字的就不算 —— 那是正文里提了一句时间。
	const lineEnd = text.indexOf('\n', anchor.end);
	const restOfLine = lineEnd === -1 ? after : text.substring(anchor.end, lineEnd);
	return restOfLine.trim() === '';
}

/**
 * 这段文本像不像"粘贴进来的聊天记录"（决定要不要自动执行「快速修复聊天记录」）。
 *
 * 判据用的是排版引擎自己的那把尺子，**分两档**：
 *
 * - **一条就够**（`isDecisiveHeader`）：带日期的头部（`张三 2024/1/5 14:30:25`、
 *   本插件写出的 `2024/01/05 14:30:25`），或者时间戳独占行尾、下面还有正文的时分秒头部。
 *   2026-09 用户要的"单条消息也算聊天记录"—— 复制一条 QQ 消息（"两张图 + 一段话"）
 *   就只有一条头部，只认两条等于永远不认；
 * - **两条才算**（其余形状）：`张三: 14:30:25 你好 李四: 14:30:30 在的` 这种同一行的
 *   多条消息，头部后面紧跟着正文，单独一条与正文里提一句时间（`会议 14:30:25 开始`）
 *   分不开 —— 那就还是老规矩，两条才动手。
 */
export function looksLikeChatLog(text: string): boolean {
	let headers = 0;
	for (const anchor of findTimeAnchors(text)) {
		if (!isMessageHeader(text, anchor)) continue;
		if (isDecisiveHeader(text, anchor)) return true;
		headers++;
		if (headers >= 2) return true;
	}
	return false;
}

/**
 * 调整一条消息内的图文顺序。
 * 仅当图片与文字同时存在时才重排；纯图片或纯文字保持原样，避免无谓改动。
 * 图片与文字原本在同一行时，会被拆分为两行。
 */
function reorderImages(lines: string[], order: 'above' | 'below'): string[] {
	const images: string[] = [];
	const texts: string[] = [];

	for (const line of lines) {
		const tokens = line.match(imageTokenRegex());
		if (!tokens || tokens.length === 0) {
			texts.push(line);
			continue;
		}

		const rest = line.replace(imageTokenRegex(), ' ').replace(/[ \t]+/g, ' ').trim();
		if (rest) texts.push(rest);
		for (const token of tokens) images.push(token);
	}

	// 纯图片 / 纯文字：没有可调整的相对位置
	if (images.length === 0 || texts.length === 0) return lines;

	return order === 'above' ? [...images, ...texts] : [...texts, ...images];
}

/**
 * 输出块：一条消息算一块（可以按时间排序），消息之间的零散文本各算一块。
 * 排序只发生在"相邻消息"之间，见 sortAdjacentMessages。
 */
interface OutputBlock {
	kind: 'text' | 'message';
	text: string;
	/** 这条消息的时间排序键；null = 时间戳不完整，不参与排序 */
	key: number | null;
	/** 时间戳里写了日期（键是"年月日时分秒"），false 表示只有"时分秒" */
	hasDate: boolean;
	/** 这条消息真的输出了正文（只有头部行时为 false） */
	hasBody: boolean;
}

/**
 * 消息的时间排序键：`年月日时分秒`（或只有日期时的 `时分秒`）拼成一个大整数，直接比大小。
 *
 * 只认**同一形状**的时间戳：整段消息都写了日期（`09-27 19:41:38`，年份按当前年补）
 * 或者整段都只有时分秒，才比得出先后；一段里混着两种形状就不排 ——
 * 缺日期的那种跨天无从判断，猜错了就是把作者的消息搬乱。
 *
 * @param withDate 这条消息的时间戳里是否有日期
 */
function messageSortKey(dateVal: string, normalizedTime: string, withDate: boolean): number | null {
	const timeParts = normalizedTime.split(':');
	if (timeParts.length !== 3) return null;
	const timeNumbers = [Number(timeParts[0]), Number(timeParts[1]), Number(timeParts[2])];
	// 时分秒最多两位（补零后是 2 位）；不是数字就当这条消息没有键
	if (timeNumbers.some(n => !Number.isInteger(n) || n < 0 || n > 99)) return null;

	let numbers = timeNumbers;
	if (withDate) {
		const dateParts = dateVal.split('/');
		if (dateParts.length !== 3) return null;
		const year = Number(dateParts[0]);
		const month = Number(dateParts[1]);
		const day = Number(dateParts[2]);
		// 年份是四位（`2024`），月日补零后两位
		if (!Number.isInteger(year) || year < 0 || year > 9999) return null;
		if ([month, day].some(n => !Number.isInteger(n) || n < 0 || n > 99)) return null;
		numbers = [year, month, day, ...timeNumbers];
	}

	let key = 0;
	for (const n of numbers) key = key * 100 + n;
	return key;
}

/**
 * 把**相邻消息**按时间先后重排。
 *
 * ## 为什么需要这一步
 *
 * 粘贴顺序不一定等于聊天窗口里的先后：QQ / 微信 一次选多条复制时，
 * 后一条（常常是图片）可能先落地、前一条（文字）落在它下面 ——
 * 用户看到的就是"图片跑到上一条文字的上方"，而时间戳明明写着文字在前。
 * 排版时手里正好有每条消息的时间戳，顺手把顺序摆正是这里的职责。
 *
 * ## 为什么只排"相邻"的
 *
 * 段与段之间可能夹着作者自己的正文（`03集`、`# 总结` 之类）：
 * 那段正文没法判断该跟着谁走，把它一起搬走只会破坏笔记。
 * 所以**中间夹着非空白内容的段一律不动** —— 排序只在
 * "消息 + 纯空白 + 消息 + …" 这种连续段内做。
 *
 * 段里的时间戳必须**形状一致**才排：全带日期，或全不带（只有时分秒）。
 * 一段里混着两种形状（`09-27 19:41:38` 与 `19:41:38`）就不排 ——
 * 缺日期的那种跨天无从判断，猜错了就是把作者的消息搬乱。
 *
 * @param blocks 输出块（原地重排其中消息块的位置）
 */
function sortAdjacentMessages(blocks: OutputBlock[]): OutputBlock[] {
	const ordered: OutputBlock[] = [];
	let i = 0;

	while (i < blocks.length) {
		if (blocks[i]?.kind !== 'message') {
			ordered.push(blocks[i]!);
			i++;
			continue;
		}

		// 从这条消息开始，往后收集"消息之间只夹空白"的连续段
		let end = i + 1;
		while (end < blocks.length) {
			const next = blocks[end]!;
			if (next.kind === 'message') { end++; continue; }
			// 空白块后面必须还是消息，段才继续；否则段到此为止
			if (next.text.trim() !== '') break;
			if (blocks[end + 1]?.kind !== 'message') break;
			end++;
		}

		// 段尾紧贴着正文（中间既没有空行、那段文字也不是从新行开始的）时整段不动：
		// 那段文字多半是这条消息正文的延续（正文边界没能把它收进去，例如紧跟在后面的时间戳残片），
		// 排序会把别人的消息插到它前面，把它跟自己的消息拆开；而且"谁在最后"一变，
		// 下一次排版对这条消息的取法也跟着变，宁可保持原样。
		// 判据是"这段正文的第一个非空白字符前面有没有换行"：有换行就是另起一行（笔记正文），
		// 没有换行才是紧贴在前一条消息尾部的东西。
		let gluedToText = false;
		for (let k = end; k < blocks.length; k++) {
			const block = blocks[k]!;
			if (block.kind === 'message') break;       // 后面的消息与本段无关
			if (block.text.trim() === '') continue;    // 纯空白块（空行）不算贴着正文
			const leadingWhitespace = /^\s*/.exec(block.text)?.[0] ?? '';
			gluedToText = !leadingWhitespace.includes('\n');
			break;
		}
		if (gluedToText) {
			for (let k = i; k < end; k++) ordered.push(blocks[k]!);
			i = end;
			continue;
		}

		const messagePositions: number[] = [];
		for (let k = i; k < end; k++) {
			if (blocks[k]?.kind === 'message') messagePositions.push(k);
		}
		const run = messagePositions.map(position => blocks[position]!);

		// 整段都要有键，而且形状一致（全带日期或全不带）才排序
		const dated = run.filter(block => block.hasDate).length;
		if (run.length > 1 && (dated === 0 || dated === run.length) && run.every(block => block.key !== null)) {
			// Array.prototype.sort 是稳定排序：时间相同的消息保持原有先后
			const sorted = [...run].sort((a, b) => (a.key as number) - (b.key as number));
			messagePositions.forEach((position, index) => { blocks[position] = sorted[index]!; });
		}

		for (let k = i; k < end; k++) ordered.push(blocks[k]!);
		i = end;
	}

	return ordered;
}

/**
 * 从 `index` 往后看：下一个"有内容"的块是不是消息（中间只允许再夹纯空白块）。
 *
 * 用来判断一段空白是不是"两条消息之间的分隔" —— 只有这种空白才归
 * 「消息之间插入空行」总开关管；夹着作者正文的空白原样保留。
 */
function nextNonBlankIsMessage(blocks: OutputBlock[], index: number): boolean {
	for (let i = index + 1; i < blocks.length; i++) {
		const block = blocks[i];
		if (!block) continue;
		if (block.kind === 'message') return true;
		if (block.text.trim() !== '') return false;
	}
	return false;
}

/**
 * 修复聊天记录排版。
 *
 * @param rawContent 笔记原始内容
 * @param options 排版选项（用户名/日期/时间开关、缩进、图片位置、相邻消息排序）
 * @param now 用于补全缺失日期的"当前时间"，仅在原文没有日期时使用
 * @returns 排版后的内容；无时间戳锚点或无需改动时原样返回
 */
export function formatChatLog(
	rawContent: string,
	options: ChatLogOptions,
	now: Date = new Date()
): string {
	const currentYear = now.getFullYear().toString();

	const anchors = findTimeAnchors(rawContent);

	if (anchors.length === 0) return rawContent;

	// 仅在隐藏用户名时需要识别"无用户名头部"：显示用户名时头部自带用户名，不存在歧义
	const detectUsernameLessHeader = !options.showUsername;

	// 预先判定每个时间戳是否为"无用户名头部"，正文边界计算也要用到
	const headerLineStarts: number[] = anchors.map(a =>
		detectUsernameLessHeader ? findUsernameLessHeaderLine(rawContent, a.start, a.end) : -1
	);

	// 图片链接区间：候选用户名若落在其中，说明是图片路径片段
	const imageRanges = collectImageRanges(rawContent);

	// 归一化图片顺序选项，兼容 data.json 中被手工改成非法值的情况
	const imageOrder: ChatImageOrder =
		options.imageOrder === 'above' || options.imageOrder === 'below' ? options.imageOrder : 'keep';

	// 输出按"块"收集：一条消息一块（带时间键，便于稍后排序），消息之间的零散文本各自成块
	const blocks: OutputBlock[] = [];
	/** 正在拼装的消息块（头部 + 正文）；拼完由 flushMessage 收进 blocks */
	let currentMessage = '';
	let currentKey: number | null = null;
	let currentHasDate = false;
	let currentHasBody = false;

	/** 当前输出的末尾（正在拼装的消息优先） */
	const tail = (): string =>
		currentMessage || (blocks.length > 0 ? blocks[blocks.length - 1]!.text : '');
	const pushText = (text: string): void => {
		if (text) blocks.push({ kind: 'text', text, key: null, hasDate: false, hasBody: false });
	};
	const ensureTrailingNewline = (): void => {
		if (currentMessage) {
			if (!currentMessage.endsWith('\n')) currentMessage += '\n';
			return;
		}
		const last = blocks[blocks.length - 1];
		// 还没有任何输出时什么都不做 —— 与原实现 `result.length > 0` 的判断一致
		if (last && !last.text.endsWith('\n')) last.text += '\n';
	};
	const flushMessage = (): void => {
		if (currentMessage) {
			blocks.push({
				kind: 'message',
				text: currentMessage,
				key: currentKey,
				hasDate: currentHasDate,
				hasBody: currentHasBody,
			});
		}
		currentMessage = '';
		currentKey = null;
		currentHasDate = false;
		currentHasBody = false;
	};

	let lastProcessedIndex = 0;

	for (let i = 0; i < anchors.length; i++) {
		const anchor = anchors[i];
		const nextAnchor = anchors[i + 1];
		if (!anchor) continue;

		const textBefore = rawContent.substring(lastProcessedIndex, anchor.start);
		const userMatch = textBefore.match(USER_BEFORE_ANCHOR_RE);

		// 本条消息的头部信息：用户名 + 头部之前需要原样保留的文本终点
		let userName = "";
		let fragmentEnd = -1;

		const headerLineStart = headerLineStarts[i] ?? -1;

		if (headerLineStart >= 0) {
			// 无用户名头部（本插件隐藏用户名后的排版结果）：整行时间戳，前面全部原样保留
			fragmentEnd = headerLineStart;
		} else if (userMatch && userMatch[1]) {
			const candidateStart = lastProcessedIndex + (userMatch.index ?? 0);
			// 落在图片链接内部的候选是图片路径片段，不能当作用户名（否则图片链接会被切断）
			if (!overlapsImageToken(imageRanges, candidateStart, candidateStart + userMatch[1].length)) {
				userName = userMatch[1].trim();
				// 头部行自己的缩进不留进正文，否则两条消息之间会多出一行纯空白
				fragmentEnd = skipIndentBefore(rawContent, candidateStart);
			}
		}

		if (fragmentEnd < 0) {
			// 无用户名可识别：保持原样，避免误伤笔记正文。
			// 同样要做换行抵消 —— 否则上一段输出末尾的换行与本段开头的空行会叠加，
			// 每执行一次就多出一个空行（无上限增长）。
			let verbatim = rawContent.substring(lastProcessedIndex, anchor.end);
			if (verbatim.startsWith('\n') && tail().endsWith('\n')) {
				verbatim = verbatim.substring(1);
			}
			pushText(verbatim);
			lastProcessedIndex = anchor.end;
			continue;
		}

		// 1. 提取当前聊天记录之前的文本（笔记、空行等）
		//
		// fragmentEnd 可能退到 lastProcessedIndex 之前：多条消息写在同一行、之间只隔一个
		// 空格时（QQ 直接粘贴的常见形态），那截空格已被上一条的正文 trim 掉，
		// 而 skipIndentBefore 会退到它前面。`substring` 在 start > end 时**会自动交换两个参数**
		// （不像 slice 返回空串），于是这里会漏出一个"只剩空格"的行 —— 再经空格排版
		// 变成真正的空行，也就是"选了不插空行却仍然有空行"的来源。
		// 被退掉的那截已经被前面的正文消费过，退不回去就是空串。
		let fragment = rawContent.substring(lastProcessedIndex, Math.max(lastProcessedIndex, fragmentEnd));

		// 核心修复1：重叠换行抵消（防止多次运行导致换行符堆叠生长）
		if (fragment.startsWith('\n') && tail().endsWith('\n')) {
			fragment = fragment.substring(1);
		}

		// 中间夹着笔记正文时，这一块不是空白 —— 排序会因此跳过它所在的段
		pushText(fragment);

		// 确保聊天记录标题独占一行
		if (blocks.length > 0 && !tail().endsWith('\n')) {
			ensureTrailingNewline();
		}

		// 2. 归一化日期与时间
		const rawTime = anchor.text.trim().replace(/-/g, '/');
		const timePartMatch = rawTime.match(/(\d{1,2}:\d{2}:\d{2})$/);
		const datePartStr = rawTime.replace(/\s*(\d{1,2}:\d{2}:\d{2})$/, "").trim();

		let dateVal = datePartStr;
		if (!dateVal) {
			dateVal = `${currentYear}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getDate().toString().padStart(2, '0')}`;
		} else if (dateVal.split('/').length === 2) {
			dateVal = `${currentYear}/${dateVal}`;
		}

		const dParts = dateVal.split('/');
		if (dParts.length === 3) {
			const y = (dParts[0]?.length === 2 ? `20${dParts[0]}` : dParts[0]) || currentYear;
			const mm = (dParts[1] || "").padStart(2, '0');
			const dd = (dParts[2] || "").padStart(2, '0');
			dateVal = `${y}/${mm}/${dd}`;
		}

		const timeVal: string = (timePartMatch && timePartMatch[1]) ? timePartMatch[1] : "00:00:00";
		const tParts = timeVal.split(':');
		const normalizedTime = `${(tParts[0] || "00").padStart(2, '0')}:${(tParts[1] || "00").padStart(2, '0')}:${(tParts[2] || "00").padStart(2, '0')}`;

		// 按设置拼装头部（用户名/日期/时间可分别关闭；全关时不输出头部行）
		const headerText = buildHeaderLine(userName, dateVal, normalizedTime, options);
		if (headerText) currentMessage += `${headerText}\n`;

		// 时间排序键：`09-27 19:41:38` 这种带日期的按"年月日时分秒"比，
		// 只有 `19:41:38` 的按"时分秒"比（两种形状不在同一段里混着比，见 messageSortKey）
		currentHasDate = datePartStr !== '';
		currentKey = messageSortKey(dateVal, normalizedTime, currentHasDate);

		// 3. 正文边界计算：支持空行笔记剥离
		let boundary: number;
		const searchStart = anchor.end;

		if (nextAnchor) {
			const nextHeaderLineStart = headerLineStarts[i + 1] ?? -1;
			let maxOffset: number;

			if (nextHeaderLineStart >= 0) {
				// 下一条是无用户名头部：两者之间的文本全部属于本条正文，
				// 不能再用用户名启发式切分（否则正文末行会被当成下一条的用户名）
				maxOffset = nextHeaderLineStart - searchStart;
			} else {
				const midText = rawContent.substring(searchStart, nextAnchor.start);
				const nextUserMatch = midText.match(USER_BEFORE_ANCHOR_RE);
				let candidateOffset = nextUserMatch ? (nextUserMatch.index ?? midText.length) : midText.length;

				// 候选落在图片链接内部时不能作为正文终点，否则图片链接会被切断
				if (nextUserMatch && nextUserMatch[1] &&
					overlapsImageToken(
						imageRanges,
						searchStart + candidateOffset,
						searchStart + candidateOffset + nextUserMatch[1].length
					)) {
					candidateOffset = midText.length;
				}
				maxOffset = candidateOffset;
			}

			const potentialContent = rawContent.substring(searchStart, searchStart + maxOffset);
			const doubleNewline = potentialContent.match(/\n\s*\n/);

			if (doubleNewline && doubleNewline.index !== undefined) {
				boundary = searchStart + doubleNewline.index;
			} else {
				boundary = searchStart + maxOffset;
			}
		} else {
			// 末条消息：正文一直取到文末（遇到空行就停在空行前）—— 与其它消息**同一条规矩**：
			// 正文只在空行处结束。
			//
			// 这里原先是"只取到第一个换行"，续行以顶格的原文留在消息外面。可末条消息的正文本来就
			// 常常不止一行（"两张图一行 + 一段话"、"多行正文"都是这个形状），于是第二行起
			// **不带缩进**地留在消息外面 —— 2026-09 用户报的"最后一句话没有正确缩进"。
			// 当时那么写是为了"防止跳过同行的文字"（时间戳后面直接跟正文时不要整条丢掉），
			// 现在取到文末同样满足这一点，而且与 `bodyClean` 的 `trim()` 配合得当。
			const potentialContent = rawContent.substring(searchStart);
			const doubleNewline = potentialContent.match(/\n\s*\n/);

			if (doubleNewline && doubleNewline.index !== undefined) {
				boundary = searchStart + doubleNewline.index;
			} else {
				boundary = rawContent.length;
			}
		}

		// 4. 提取正文，按需去掉 @ 提及、调整图文顺序并施加缩进
		const bodyRaw = rawContent.substring(anchor.end, boundary);
		let bodyClean = bodyRaw.replace(/^[:：]\s*/, "").trim();
		// @ 提及是 QQ / 微信 的回复标记，昵称在笔记里指不到具体的人 —— 开了开关就删掉
		if (options.stripMentions) bodyClean = stripMentions(bodyClean);

		if (bodyClean) {
			let lines = bodyClean.split('\n').map(line => line.trim());
			if (imageOrder !== 'keep') {
				lines = reorderImages(lines, imageOrder);
			}
			currentMessage += lines.map(line => `${options.indent}${line}`).join('\n') + '\n';
			currentHasBody = true;
		} else if (!tail().endsWith('\n')) {
			ensureTrailingNewline();
		}

		lastProcessedIndex = boundary;
		flushMessage();
	}

	if (lastProcessedIndex < rawContent.length) {
		const remaining = rawContent.substring(lastProcessedIndex);
		if (remaining.startsWith('\n') && tail().endsWith('\n')) {
			pushText(remaining.substring(1));
		} else {
			pushText(remaining);
		}
	}

	// 相邻消息按时间先后重排：粘贴顺序有时与聊天窗口里的先后不一致，
	// 后一条（常常是图片）先落地、前一条（文字）落在下面 —— 见 sortAdjacentMessages
	const ordered = options.sortByTime === false ? blocks : sortAdjacentMessages(blocks);

	// 拼成最终文本。"消息之间留不留空行"按**重排后**的相邻关系处理，
	// 否则排序换个顺序就会把分隔空行留错地方。
	//
	// 「消息之间插入空行」是总开关（与头部信息开不开无关）：
	// - 关（默认）：两条相邻消息之间一个空行都不留 —— 源文里带的空行一并去掉，
	//   它们本来就由头部或缩进分开，用户要的是"消息紧挨着"；
	// - 开：相邻消息之间恰好留一行（源文里空了几行也只留一行）。
	//
	// 中间夹着作者正文时不算"相邻消息"，那一段空白原样保留；两条消息里只要有一条
	// 没有正文（只有头部行）也不补 —— 没有正文就没有"分隔两段正文"这回事。
	let result = '';
	/** 上一条输出的是消息 */
	let previousWasMessage = false;
	/** 上一条输出的消息带了正文 */
	let previousWasBody = false;

	/** 补一个空行（结果末尾已经是一行完整内容时才补） */
	const ensureBlankLine = (): void => {
		if (result === '') return;
		if (!result.endsWith('\n')) result += '\n';
		if (!result.endsWith('\n\n')) result += '\n';
	};

	for (let i = 0; i < ordered.length; i++) {
		const block = ordered[i];
		if (!block) continue;

		if (block.kind === 'text') {
			// 夹在两条消息之间的纯空白（空行）：归总开关管，这里直接丢掉，
			// 需要空行时由下面"看到下一条消息"的那一步补（那时才知道它有没有正文）
			if (previousWasMessage && block.text.trim() === '' && nextNonBlankIsMessage(ordered, i)) {
				continue;
			}
			result += block.text;
			// 中间夹着笔记正文，下一条消息不算是紧邻上一条消息
			previousWasMessage = false;
			previousWasBody = false;
			continue;
		}

		// 两条消息相邻：关掉开关时它们至少要各占一行（源文里那点空白已经被丢掉），
		// 打开时补一个空行 —— 两种情况都不会让上一条的正文与下一条的头部挤在一行。
		if (previousWasMessage && !result.endsWith('\n')) result += '\n';
		if (options.blankLineBetweenMessages && previousWasBody && block.hasBody) ensureBlankLine();

		result += block.text;
		previousWasMessage = true;
		previousWasBody = block.hasBody;
	}

	return result;
}
