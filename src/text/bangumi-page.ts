/**
 * Bangumi 讨论页的网页层：网址校验 + HTML → 结构化楼层。
 *
 * 不走 `DOMParser`：`src/text/` 是纯函数区（不 import obsidian，测试在 Node 里执行），
 * 而 bangumi 的讨论页结构很稳定（`div#post_<id>` 一件一件排开），用正则切块就够，
 * 还能把页面快照直接当测试夹具。
 */
import type { BangumiPost } from './bangumi';

/** 支持的页面：小组讨论 / 条目讨论 */
export interface BangumiPageRef {
	kind: 'group-topic' | 'subject-topic';
	id: string;
	/** 规范化后的地址（去掉 hash / 查询参数，统一 https + bgm.tv） */
	url: string;
}

const BANGUMI_HOSTS = new Set([
	'bgm.tv',
	'www.bgm.tv',
	'm.bgm.tv',
	'bangumi.tv',
	'www.bangumi.tv',
	'm.bangumi.tv',
]);

/**
 * 校验并规范化用户输入的网址。
 *
 * 接受省略协议的写法（`bgm.tv/group/topic/435751`）；只认小组 / 条目讨论页，
 * 其他页面返回 null（调用方给"暂不支持"的提示，别硬解析）。
 */
export function parseBangumiUrl(input: string): BangumiPageRef | null {
	let raw = input.trim();
	if (!raw) return null;
	if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (!BANGUMI_HOSTS.has(url.hostname.toLowerCase())) return null;

	const matched = url.pathname.match(/^\/(group|subject)\/topic\/(\d+)\/?$/);
	if (!matched) return null;
	const kind = matched[1];
	const id = matched[2];
	if (!kind || !id) return null;
	return {
		kind: kind === 'group' ? 'group-topic' : 'subject-topic',
		id,
		url: `https://bgm.tv/${kind}/topic/${id}`,
	};
}

/** HTML 实体解码（先数字、后具名；`&amp;` 放最后，避免二次解码） */
function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_whole, hex: string) => fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_whole, dec: string) => fromCodePoint(Number(dec)))
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&amp;/gi, '&');
}

function fromCodePoint(code: number): string {
	try {
		return String.fromCodePoint(code);
	} catch {
		return '';
	}
}

/** 去标签 + 解实体（用于用户名、签名、标题这类纯文本字段） */
export function stripHtmlTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, '')).trim();
}

/** 读一个 HTML 属性；单双引号都认 */
function readAttribute(tag: string, name: string): string {
	const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
	const matched = tag.match(pattern);
	return decodeEntities(matched?.[1] ?? matched?.[2] ?? '');
}

/** 站内相对地址补成绝对地址；协议相对（`//lain.bgm.tv/...`）补 https */
function absoluteUrl(href: string): string {
	const trimmed = href.trim();
	if (!trimmed) return '';
	if (trimmed.startsWith('//')) return `https:${trimmed}`;
	if (trimmed.startsWith('/')) return `https://bgm.tv${trimmed}`;
	return trimmed;
}

/** 行内 HTML → Markdown（只覆盖 Bangumi 讨论页实际用到的标签） */
export function htmlToMarkdown(html: string): string {
	let text = html.replace(/\r\n?/g, '\n');

	// 引用块：`<div class="quote"><q><span>某人</span> 说: …</q></div>`
	text = text.replace(/<div class="quote">([\s\S]*?)<\/div>/gi, (_whole, inner: string) =>
		`\n${stripHtmlTags(inner)}\n`
	);

	// 视频 / 音频 / 嵌入：不下载，保留成链接（GIF 图片也走下面的普通图片链接）
	text = text.replace(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi, (_whole, attrs: string, inner: string) => {
		const src = readAttribute(attrs, 'src') || readAttribute(inner, 'src');
		return src ? `[视频](${absoluteUrl(src)})` : '';
	});
	text = text.replace(/<(?:video|audio)\b([^>]*)\/?>/gi, (_whole, attrs: string) => {
		const src = readAttribute(attrs, 'src');
		return src ? `[媒体](${absoluteUrl(src)})` : '';
	});
	text = text.replace(/<iframe\b([^>]*)>([\s\S]*?)<\/iframe>/gi, (_whole, attrs: string) => {
		const src = readAttribute(attrs, 'src');
		return src ? `[嵌入](${absoluteUrl(src)})` : '';
	});

	// 表情与其他图片
	text = text.replace(/<img\b[^>]*>/gi, tag => {
		const alt = readAttribute(tag, 'alt');
		const src = absoluteUrl(readAttribute(tag, 'src'));
		if (!src) return alt;
		return `![${alt}](${src})`;
	});

	// 链接
	text = text.replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, inner: string) => {
		const label = stripHtmlTags(inner);
		const target = absoluteUrl(decodeEntities(href));
		return target ? `[${label}](${target})` : label;
	});
	text = text.replace(/<a\b[^>]*href\s*=\s*'([^']*)'[^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, inner: string) => {
		const label = stripHtmlTags(inner);
		const target = absoluteUrl(decodeEntities(href));
		return target ? `[${label}](${target})` : label;
	});

	text = text.replace(/<br\s*\/?>/gi, '\n');
	text = text.replace(/<(?:strong|b)>([\s\S]*?)<\/(?:strong|b)>/gi, (_whole, inner: string) => {
		const body = stripHtmlTags(inner);
		return body ? `**${body}**` : '';
	});
	text = text.replace(/<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/gi, (_whole, inner: string) => {
		const body = stripHtmlTags(inner);
		return body ? `*${body}*` : '';
	});
	text = text.replace(/<code>([\s\S]*?)<\/code>/gi, (_whole, inner: string) => {
		const body = stripHtmlTags(inner);
		return body ? `\`${body}\`` : '';
	});
	text = text.replace(/<(?:del|s)>([\s\S]*?)<\/(?:del|s)>/gi, (_whole, inner: string) => {
		const body = stripHtmlTags(inner);
		return body ? `~~${body}~~` : '';
	});

	text = text.replace(/<[^>]*>/g, '');
	text = decodeEntities(text);
	return text
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** 从页面里取标题（`<h1>` 里 `<br />` 之后那一段；没有就拿 h1 全文） */
function extractTitle(html: string): string {
	const matched = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
	if (!matched) return '';
	const chunks = (matched[1] ?? '').split(/<br\s*\/?>/i);
	return stripHtmlTags(chunks[chunks.length - 1] ?? '');
}

/** 一个 `div#post_<id>` 块的种类 */
type PostKind = 'topic' | 'reply' | 'sub';

function postKind(className: string): PostKind | null {
	if (/\bpostTopic\b/.test(className)) return 'topic';
	if (/\bsub_reply_bg\b/.test(className)) return 'sub';
	if (/\brow_reply\b/.test(className)) return 'reply';
	return null;
}

/**
 * 取一个 `div.<className>` 的**内部 HTML**，按 div 嵌套配对到对应的 `</div>`。
 *
 * 不能用 `[\s\S]*?</div>`：楼层正文里可能嵌 quote / 图片容器等 div，非贪婪会停在
 * 第一个内层 `</div>`；主楼越长、嵌套越多，丢得越多。
 */
function divInner(html: string, className: string): string | null {
	const open = new RegExp(`<div\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>`, 'i').exec(html);
	if (!open) return null;
	const start = open.index + open[0].length;
	let depth = 1;
	let cursor = start;
	while (depth > 0) {
		const nextOpen = html.indexOf('<div', cursor);
		const nextClose = html.indexOf('</div>', cursor);
		if (nextClose < 0) break;
		if (nextOpen >= 0 && nextOpen < nextClose) {
			depth++;
			cursor = nextOpen + 4;
		} else {
			depth--;
			if (depth === 0) return html.slice(start, nextClose);
			cursor = nextClose + 6;
		}
	}
	return html.slice(start);
}

/** 从一块 HTML 里抠出一条楼层；不是楼层（缺标题行 / 用户名）时返回 null */
function parsePostSegment(segment: string, kind: PostKind): BangumiPost | null {
	const header = segment.match(/<small>([\s\S]*?)<\/small>/i);
	if (!header) return null;
	const headerText = stripHtmlTags(header[1] ?? '');
	const floorMatch = headerText.match(/#(\d+(?:-\d+)?)\s*-\s*(.+)/);
	if (!floorMatch) return null;
	const floor = floorMatch[1] ?? '';
	const date = (floorMatch[2] ?? '').trim();

	const userMatch = segment.match(/<strong[^>]*>\s*<a[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
	if (!userMatch) return null;
	const url = absoluteUrl(decodeEntities(userMatch[1] ?? ''));
	const user = stripHtmlTags(userMatch[2] ?? '');
	if (!user) return null;

	const signMatch = segment.match(/<span class="sign[^"]*">([\s\S]*?)<\/span>/i);
	const signature = signMatch
		? stripHtmlTags(signMatch[1] ?? '').replace(/^[（(]\s*/, '').replace(/\s*[）)]$/, '').trim()
		: '';

	let bodyHtml = '';
	if (kind === 'topic') {
		bodyHtml = divInner(segment, 'topic_content') ?? '';
	} else if (kind === 'reply') {
		const matched = segment.match(/<div class="reply_content">([\s\S]*?)(?=<div class="likes_grid"|<div class="topic_sub_reply")/i);
		if (matched) {
			bodyHtml = divInner(matched[1] ?? '', 'message') ?? matched[1] ?? '';
		}
	} else {
		bodyHtml = divInner(segment, 'cmt_sub_content') ?? '';
	}

	return {
		floor,
		date,
		user,
		url,
		signature,
		body: htmlToMarkdown(bodyHtml),
	};
}

export interface BangumiPage {
	/** 主题标题（可能为空 —— 不是讨论页或结构变了） */
	title: string;
	posts: BangumiPost[];
}

/**
 * 从页面里找出「同一讨论的其他页」链接（`?page=2` 这类）。
 *
 * 页面只给当前页的楼层；抓网页时要靠这些链接把后面的页也拉下来。
 * 返回绝对地址、去重、按页号排序，并排除当前页。
 */
export function extractBangumiPageUrls(html: string, currentUrl: string): string[] {
	const found = new Map<string, number>();
	const linkRe = /<a\b[^>]*href\s*=\s*["']([^"']*[?&](?:page|p)=(\d+)[^"']*)["'][^>]*>/gi;
	let currentPath = '';
	let current: URL | null = null;
	try {
		current = new URL(currentUrl);
		currentPath = current.pathname;
	} catch {
		// 网址不合法时不做路径约束，交给调用方处理
	}
	let matched: RegExpExecArray | null;
	// 属性里的查询串可能被转义成 `&amp;page=2`；先解码再扫，否则正则看不到 `&page`
	const decodedHtml = html.replace(/&amp;/g, '&');
	while ((matched = linkRe.exec(decodedHtml)) !== null) {
		// 属性里的查询串也可能被转义成 `&amp;page=2`
		const href = (matched[1] ?? '').replace(/&amp;/g, '&');
		const page = Number(matched[2] ?? '0');
		let absoluteUrl: URL;
		try {
			absoluteUrl = new URL(href, currentUrl);
		} catch {
			continue;
		}
		if (!BANGUMI_HOSTS.has(absoluteUrl.hostname.toLowerCase())) continue;
		if (currentPath && absoluteUrl.pathname !== currentPath) continue;
		// 第 1 页就是当前讨论的基址：去掉 page / p，避免把第一页重复抓一遍
		if (page <= 1) {
			absoluteUrl.searchParams.delete('page');
			absoluteUrl.searchParams.delete('p');
		}
		absoluteUrl.hash = '';
		const absolute = absoluteUrl.href;
		if (current && absolute === current.href) continue;
		if (!found.has(absolute)) found.set(absolute, page);
	}
	return [...found.entries()]
		.sort((a, b) => a[1] - b[1])
		.map(([url]) => url);
}

/**
 * 从已下载的讨论页 HTML 里取出所有楼层（主楼层 + 子回复，按页面顺序）。
 *
 * 贴贴计数在页面里是 `div.likes_grid` 加一段页面脚本（`data_likes_list`），
 * 这里根本不去读它 —— 网页导入那条路从源头就没有"贴贴"。
 */
export function parseBangumiPage(html: string): BangumiPage {
	const normalized = html.replace(/\r\n?/g, '\n');
	const starts: Array<{ index: number; className: string }> = [];
	const startRe = /<div id="post_\d+" class="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = startRe.exec(normalized)) !== null) {
		starts.push({ index: match.index, className: match[1] ?? '' });
	}

	const posts: BangumiPost[] = [];
	for (let i = 0; i < starts.length; i++) {
		const start = starts[i];
		if (!start) continue;
		const kind = postKind(start.className);
		if (!kind) continue;
		const end = starts[i + 1]?.index ?? normalized.length;
		const parsed = parsePostSegment(normalized.slice(start.index, end), kind);
		if (parsed) posts.push(parsed);
	}

	return { title: extractTitle(normalized), posts };
}
