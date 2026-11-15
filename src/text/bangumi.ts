/**
 * Bangumi（bgm.tv）讨论页排版引擎。
 *
 * 与 QQ / 微信聊天记录（`chat-log.ts`）分开：那边靠"用户名 + 时间戳"认消息，
 * Bangumi 讨论页复制出来的纯文本没有用户名时间戳，只有楼层头 `#1 - 2025-9-15 20:15`，
 * 每条消息还带一段页面控件（`N 回复` / `收集` / `贴贴` / `顺序`）和贴贴计数。
 *
 * 结构化数据（网页导入那条路）由 `bangumi-page.ts` 解析 HTML 得到；这里只做纯文本：
 * 解析 → 组装 → 按设置输出。**必须幂等**：排版结果里没有楼层头，再跑一次原样返回。
 */

/** Bangumi 讨论页排版选项 */
export interface BangumiOptions {
	/** 在名字后显示楼层号（`#3` / `#3-1`） */
	showFloor: boolean;
	/** 在名字后显示楼层时间（`2025-09-15 20:15`，刻意不带秒，避免被 QQ 时间戳识别误伤） */
	showTime: boolean;
	/** 保留用户签名（`(无可救药的百合豚)`） */
	showSignature: boolean;
	/** 去掉贴贴计数（正文之后那 1–4 行纯数字，以及页面控件） */
	stripReactions: boolean;
	/** 去掉表情：`(bgm38)` 这种文本 / `img.smile` 图片 */
	stripSmiles: boolean;
	/** 有用户主页地址时，把用户名做成 Markdown 链接（网页导入才有地址） */
	linkUsers: boolean;
	/** 同一楼层内部段落之间是否留空行 */
	blankLineWithinPost: boolean;
	/** 不同楼层之间是否留空行 */
	blankLineBetweenPosts: boolean;
}

export const DEFAULT_BANGUMI_OPTIONS: BangumiOptions = {
	showFloor: false,
	showTime: false,
	showSignature: true,
	stripReactions: true,
	stripSmiles: false,
	linkUsers: true,
	blankLineWithinPost: false,
	blankLineBetweenPosts: true,
};

/** 一条讨论楼层（主楼层或子回复） */
export interface BangumiPost {
	/** 楼层号：`1` 或 `3-1`（不含 `#`） */
	floor: string;
	/** 楼层时间：`YYYY-MM-DD HH:mm`（补零） */
	date: string;
	/** 用户名（纯文本） */
	user: string;
	/** 用户主页绝对地址；纯文本粘贴没有地址时为空串 */
	url: string;
	/** 签名（不含两侧括号） */
	signature: string;
	/** 正文（Markdown，可能含引用行 / 表情图片 / 段首空格） */
	body: string;
}

/** 纯文本解析结果：楼层列表 + 第一个楼层头之前的内容（通常就是主题标题） */
export interface ParsedBangumiText {
	posts: BangumiPost[];
	prefix: string;
}

/**
 * 楼层头：`#1 - 2025-9-15 20:15`、`#3-1 - 2025-9-15 20:32`。
 * 时间只有时分（没有秒）—— 这正是它不会和 QQ 聊天记录头部混淆的原因。
 */
const RAW_HEADER_RE = /^#(\d+)(?:-(\d+))? - (\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{2})[ \t]*$/gm;

interface RawHeader {
	floor: string;
	date: string;
	start: number;
	end: number;
}

function pad2(value: string): string {
	return value.padStart(2, '0');
}

/** 扫出所有楼层头（位置用于切块） */
function findRawHeaders(text: string): RawHeader[] {
	const headers: RawHeader[] = [];
	const regex = new RegExp(RAW_HEADER_RE.source, 'gm');
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		headers.push({
			floor: match[2] ? `${match[1]}-${match[2]}` : (match[1] ?? ''),
			date: `${match[3] ?? ''}-${pad2(match[4] ?? '')}-${pad2(match[5] ?? '')} ${pad2(match[6] ?? '')}:${match[7] ?? ''}`,
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	return headers;
}

/** 楼层头与用户名行之间那些复制残留：空行、`...` 折叠标记、`回复` 控制 */
function isLeadingNoise(line: string): boolean {
	const trimmed = line.trim();
	if (trimmed === '') return true;
	if (/^\.{2,}$/.test(trimmed) || /^…+$/.test(trimmed)) return true;
	return /^(?:回复|删除了回复)$/.test(trimmed);
}

/** 页面控件行：一条消息末尾的 `36 回复` / `收集` / `贴贴` / `顺序` */
function isPageControl(line: string): boolean {
	return /^(?:\d+\s*回复|收集|贴贴|顺序|举报|回复)$/.test(line.trim());
}

/** 贴贴计数行：正文之后的一行小整数 */
function isReactionCount(line: string): boolean {
	return /^\d{1,6}$/.test(line.trim());
}

/**
 * 拆用户名行：`Kflho` / `金刚可怜 (无可救药的百合豚)` / `我是谁，你又是谁？ (…)`。
 * 只把**末尾**那对括号当签名 —— 用户名本身带括号时也能保留。
 */
function splitUserLine(line: string): { user: string; signature: string } {
	const trimmed = line.trim();
	const matched = trimmed.match(/^([\s\S]*?)\s*[（(]([^（）()]*)[)）]\s*$/);
	if (matched && (matched[1] ?? '').trim()) {
		return { user: (matched[1] ?? '').trim(), signature: (matched[2] ?? '').trim() };
	}
	return { user: trimmed, signature: '' };
}

/** 去掉表情：网页导入得到的是 `![(bgm38)](…)`，纯文本是 `(bgm38)` */
function stripSmiles(text: string): string {
	return text
		.replace(/!\[[^\]]*\]\([^)\n]*\/img\/smiles\/[^)\n]*\)/gi, '')
		.replace(/[（(]\s*bgm\d+\s*[)）]/gi, '');
}

/**
 * 解析纯文本复制出来的讨论页。
 *
 * 返回 `null`：一个楼层头都没有（不像讨论页）——调用方据此保持原文不动。
 *
 * 块边界只认下一个楼层头；最后一块一直取到文末（与 QQ 聊天记录的"末条消息不截断"
 * 同一个取舍：混在笔记中间时，末尾的作者正文会被算进最后一条消息，要精确控制就用
 * 「排版选中内容」只选讨论页那一段）。
 */
export function parseBangumiText(
	text: string,
	options: Pick<BangumiOptions, 'stripReactions' | 'stripSmiles'> = DEFAULT_BANGUMI_OPTIONS
): ParsedBangumiText | null {
	const normalized = text.replace(/\r\n?/g, '\n');
	const headers = findRawHeaders(normalized);
	if (headers.length === 0) return null;

	const posts: BangumiPost[] = [];
	for (let i = 0; i < headers.length; i++) {
		const header = headers[i];
		if (!header) continue;
		const next = headers[i + 1];
		const blockEnd = next ? next.start : normalized.length;
		const lines = normalized.slice(header.end, blockEnd).split('\n');

		let cursor = 0;
		while (cursor < lines.length && isLeadingNoise(lines[cursor] ?? '')) cursor++;
		const userLine = (lines[cursor] ?? '').trim();
		if (!userLine) continue;
		cursor++;

		const { user, signature } = splitUserLine(userLine);
		const bodyLines = lines.slice(cursor);

		// 块尾的空白与页面控件：控件永远不是正文
		while (bodyLines.length > 0 && (bodyLines[bodyLines.length - 1] ?? '').trim() === '') bodyLines.pop();
		while (bodyLines.length > 0 && isPageControl(bodyLines[bodyLines.length - 1] ?? '')) bodyLines.pop();

		// 贴贴计数：只剥块尾连续纯数字（最多 8 行），正文中间的数字行不动
		if (options.stripReactions !== false) {
			let removed = 0;
			while (
				bodyLines.length > 0 &&
				removed < 8 &&
				isReactionCount(bodyLines[bodyLines.length - 1] ?? '')
			) {
				bodyLines.pop();
				removed++;
			}
			// 计数与下一楼之间也可能夹控件（#1 就是这种形状）
			while (bodyLines.length > 0 && isPageControl(bodyLines[bodyLines.length - 1] ?? '')) bodyLines.pop();
		}

		while (bodyLines.length > 0 && (bodyLines[0] ?? '').trim() === '') bodyLines.shift();

		const rawBody = bodyLines.join('\n').replace(/[ \t]+$/gm, '').trim();
		const body = options.stripSmiles ? stripSmiles(rawBody).trim() : rawBody;

		posts.push({
			floor: header.floor,
			date: header.date,
			user,
			url: '',
			signature,
			body,
		});
	}

	if (posts.length === 0) return null;
	return { posts, prefix: normalized.slice(0, headers[0]?.start ?? 0) };
}

/** 引用行：`某人 说: …`（网页复制成纯文本时没有 `>` 或引号） */
export function formatQuoteLine(line: string): string {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('“')) return line;
	// 已经是新格式（`> “**某人** 说：…”`）时保持原样，保证幂等
	if (/^>?\s*“\*\*.+?\*\*\s+说[:：]/.test(trimmed)) return line;
	const matched = trimmed.match(/^([^\s:：][^:：]{0,60}?)\s+说[:：]\s*([\s\S]*)$/);
	if (!matched) return line;
	const text = (matched[2] ?? '').trim();
	return `> “**${(matched[1] ?? '').trim()}** 说：${text}”`;
}

/** 正文里的引用行用 `>` + 双引号标出；引用下方补空行，避免 Markdown 显示异常 */
function markQuoteLines(body: string): string {
	const output: string[] = [];
	for (const line of body.split('\n')) {
		const marked = formatQuoteLine(line);
		output.push(marked);
		if (marked !== line) output.push('');
	}
	return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 正文清理：去行尾空白、收掉 3 行以上空行、去首尾空行 */
function cleanupBody(body: string, options: BangumiOptions): string {
	let result = body.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
	if (options.stripSmiles) result = stripSmiles(result);
	return result
		.replace(/\n{2,}/g, options.blankLineWithinPost ? '\n\n' : '\n')
		.replace(/^\n+|\n+$/g, '');
}

/** 一条楼层的头部行 */
function renderHeader(post: BangumiPost, options: BangumiOptions): string {
	const name = post.user.trim();
	const linked = options.linkUsers && post.url ? `[${name}](${post.url})` : name;
	const signature = options.showSignature && post.signature ? `(${post.signature})` : '';
	const meta = [
		options.showFloor && post.floor ? `#${post.floor}` : '',
		options.showTime && post.date ? post.date : '',
	].filter(Boolean).join(' · ');
	return `**${linked}**${signature}${meta ? ` ${meta}` : ''}`;
}

/**
 * 把结构化楼层排成 Markdown：头部、空行、正文；楼层之间一个空行。
 * 网页导入那条路也走这里（纯文本那条路先解析成同样的结构）。
 */
export function formatBangumiPosts(
	posts: BangumiPost[],
	options: BangumiOptions = DEFAULT_BANGUMI_OPTIONS
): string {
	const blocks: string[] = [];
	for (const post of posts) {
		if (!post.user.trim()) continue;
		const header = renderHeader(post, options);
		const body = markQuoteLines(cleanupBody(post.body, options));
		blocks.push(body ? `${header}\n${body}` : header);
	}
	return blocks.join(options.blankLineBetweenPosts ? '\n\n' : '\n');
}

/**
 * 复制品开头那一行是不是主题标题（需要去掉）。
 *
 * 只在第一楼是 `#1`、且楼层头之前恰好只有一行非空内容、且那行不像 Markdown 结构时成立。
 * 这样"把讨论页粘在已有笔记中间"时，前面的作者正文不会被误删。
 */
function isTopicTitle(prefix: string, posts: BangumiPost[]): boolean {
	const first = posts[0];
	if (!first || first.floor !== '1') return false;
	const lines = prefix.split('\n').map(line => line.trim()).filter(Boolean);
	if (lines.length !== 1) return false;
	const line = lines[0] ?? '';
	return !/^(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|!\[|\||```|%%|---)/.test(line);
}

/**
 * 排版一段 Bangumi 讨论页纯文本（用于流水线与"排版选中内容"）。
 *
 * @param text 原始文本
 * @param options 排版选项
 * @returns 排版后的文本；没有楼层头时原样返回（保证幂等）
 */
export function formatBangumiLog(
	text: string,
	options: BangumiOptions = DEFAULT_BANGUMI_OPTIONS
): string {
	const parsed = parseBangumiText(text, options);
	if (!parsed) return text;
	const formatted = formatBangumiPosts(parsed.posts, options);
	if (!formatted) return text;

	const prefix = isTopicTitle(parsed.prefix, parsed.posts)
		? ''
		: parsed.prefix.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
	return prefix ? `${prefix}\n\n${formatted}` : formatted;
}

/** 主题标题转成可用的文件名：去掉 Windows / Obsidian 不允许的字符，限长、去尾部点与空格 */
export function titleAsFileName(title: string): string {
	const cleaned = title
		// eslint-disable-next-line no-control-regex -- 要匹配的就是控制字符本身
		.replace(/[\u0000-\u001f]/g, ' ')
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/[. ]+$/g, '')
		.replace(/\.md$/i, '')
		.trim();
	return (cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned) || 'bangumi 讨论';
}

/**
 * 这段文本像不像复制进来的 Bangumi 讨论页（决定粘贴后要不要自动排版）。
 *
 * 判据分两档：
 * - 两个及以上楼层：认；
 * - 单个楼层：要有楼层头、用户名、正文，并且还留着 `...` / `贴贴` / `收集` / `顺序` /
 *   `回复` 这些复制残留之一 —— 单行手写的 `#1 - 2025-9-15 20:15` 不会被误认。
 */
export function looksLikeBangumiLog(text: string): boolean {
	const parsed = parseBangumiText(text);
	if (!parsed) return false;
	if (parsed.posts.length >= 2) return true;
	const first = parsed.posts[0];
	if (!first || !first.body.trim()) return false;
	return /(?:^|\n)\s*(?:\.{2,}|…+|贴贴|收集|顺序|回复)\s*(?:\n|$)/.test(text);
}
