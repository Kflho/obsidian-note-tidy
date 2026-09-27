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
	/** 头部信息全部关闭时，是否在相邻消息之间插入空行作为分隔 */
	blankLineBetweenMessages: boolean;
	/** 相邻消息的时间戳与粘贴顺序不一致时，是否按时间先后输出（见 sortAdjacentMessages） */
	sortByTime: boolean;
}

/** 默认行为与旧版本完全一致：用户名/日期/时间全显示、Tab 缩进、不调整图片顺序、不加空行 */
export const DEFAULT_CHAT_LOG_OPTIONS: ChatLogOptions = {
	showUsername: true,
	showDate: true,
	showTime: true,
	indent: '\t',
	imageOrder: 'keep',
	blankLineBetweenMessages: false,
	sortByTime: true,
};

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
 * 这段文本像不像"粘贴进来的聊天记录"（决定要不要自动执行快速修复）。
 *
 * 判据用的是排版引擎自己的那把尺子：**至少两条消息头部**才算 —— 头部 = 时间戳前面
 * 同一行有用户名（`张三 2024/1/5 14:30:25`），或者整行就是本插件写出的无用户名时间戳。
 *
 * 为什么是两条而不是一条：只认一条太容易误伤（正文里写一句 `会议 14:30:25` 就命中了），
 * 而复制单条消息本来也不带头部 —— QQ / 微信 只在你一次复制多条时才写出"用户名 + 时间戳"。
 */
export function looksLikeChatLog(text: string): boolean {
	let headers = 0;
	for (const anchor of findTimeAnchors(text)) {
		if (!isMessageHeader(text, anchor)) continue;
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
	/** 这条消息没有头部行（用户名/日期/时间全关），只有正文 */
	bodyOnly: boolean;
	/** 这条消息真的输出了正文 */
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

		// 段尾紧贴着正文（中间没有空行）时整段不动：末条消息的正文只取到第一个换行，
		// 余下的续行作为普通文本留在后面 —— 排序会把那段续行跟消息拆开，
		// 而且"谁在最后"一变，下一次排版对这条消息的取法也跟着变，宁可保持原样。
		// 判据是"正文的第一个非空白字符前面有没有换行"：有换行就是另起一行（笔记正文），
		// 没有换行（比如 `第二行` 直接接在正文后面）才是被截断的续行。
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
	let currentBodyOnly = false;
	let currentHasBody = false;

	/** 当前输出的末尾（正在拼装的消息优先） */
	const tail = (): string =>
		currentMessage || (blocks.length > 0 ? blocks[blocks.length - 1]!.text : '');
	const pushText = (text: string): void => {
		if (text) blocks.push({ kind: 'text', text, key: null, hasDate: false, bodyOnly: false, hasBody: false });
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
				bodyOnly: currentBodyOnly,
				hasBody: currentHasBody,
			});
		}
		currentMessage = '';
		currentKey = null;
		currentHasDate = false;
		currentBodyOnly = false;
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
		// 没有头部行时才知道"正文直接相邻"要不要补空行
		currentBodyOnly = !headerText;

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
			const potentialContent = rawContent.substring(searchStart);
			const doubleNewline = potentialContent.match(/\n\s*\n/);

			// 核心修复2：严格定位末条消息内容的实际结束点，防止跳过同行的文字
			let contentStartOffset = 0;
			const leadingSpaceMatch = potentialContent.match(/^[\s\n]+/);
			if (leadingSpaceMatch) {
				contentStartOffset = leadingSpaceMatch[0].length;
			}
			const firstNewline = potentialContent.indexOf('\n', contentStartOffset);

			if (doubleNewline && doubleNewline.index !== undefined) {
				boundary = searchStart + doubleNewline.index;
			} else if (firstNewline !== -1) {
				boundary = searchStart + firstNewline;
			} else {
				boundary = rawContent.length;
			}
		}

		// 4. 提取正文，按需调整图文顺序并施加缩进
		const bodyRaw = rawContent.substring(anchor.end, boundary);
		const bodyClean = bodyRaw.replace(/^[:：]\s*/, "").trim();

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

	// 拼成最终文本。"消息之间插入空行"按**重排后**的相邻关系补，
	// 否则排序换个顺序就会把分隔空行留错地方。
	let result = '';
	let previousOutputWasBody = false;

	for (const block of ordered) {
		if (block.kind === 'text') {
			result += block.text;
			// 中间夹着笔记正文，下一条消息不算是紧邻上一条正文
			previousOutputWasBody = false;
			continue;
		}

		// 头部信息全部关闭时，两条消息的正文会直接相邻，可按设置补一个空行分隔。
		// 有头部信息时头部本身已起分隔作用，不额外插入。
		if (options.blankLineBetweenMessages && block.bodyOnly && block.hasBody && previousOutputWasBody) {
			result += '\n';
		}

		result += block.text;
		if (block.hasBody) previousOutputWasBody = true;
	}

	return result;
}
