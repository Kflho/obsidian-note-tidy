/**
 * 三个右键菜单各自"要隐藏哪些项"的解析与生成（纯函数，不依赖 Obsidian）。
 *
 * 存法是一段文本，每行 `作用域：菜单项标题`：
 *
 * ```
 * 图片：另存为图片…
 * 笔记：复制
 * 文件夹：在系统中显示
 * ```
 *
 * **不写作用域的按"图片"算** —— 最早的版本只支持图片菜单，写的就是裸标题，
 * 这样老数据不用迁移。作用域也认英文 key（`image:` / `note:` / `folder:`）。
 *
 * 隐藏只按**标题原文**匹配：菜单项文案带动态内容的（比如本插件的"复制 3 张图片"）
 * 没法靠它隐藏，所以本插件自己的项一律走各自的开关，不进这份名单（见 image-menu.ts）。
 */

/** 三个右键菜单：笔记里渲染出来的图片 / 笔记正文 / 文件浏览器 */
export type MenuScope = 'image' | 'note' | 'folder';

/** 面板与设置里的显示顺序 */
export const MENU_SCOPES: MenuScope[] = ['image', 'note', 'folder'];

/** 作用域在界面上的写法（写在设置里时也用这个） */
export const MENU_SCOPE_LABELS: Record<MenuScope, string> = {
	image: '图片',
	note: '笔记',
	folder: '文件夹',
};

/** 每个作用域各自一份隐藏名单 */
export type HiddenItems = Record<MenuScope, string[]>;

const LABEL_TO_SCOPE: Record<string, MenuScope> = {
	'图片': 'image',
	'笔记': 'note',
	'文件夹': 'folder',
	'image': 'image',
	'note': 'note',
	'folder': 'folder',
};

/** 空名单（每个作用域一份空数组） */
export function emptyHiddenItems(): HiddenItems {
	return { image: [], note: [], folder: [] };
}

/** 解析设置里那段文本；认不出作用域的行按"图片"算（老数据的写法） */
export function parseHiddenItems(raw: string): HiddenItems {
	const hidden = emptyHiddenItems();

	for (const line of raw.split('\n')) {
		const text = line.trim();
		if (text === '') continue;

		// `图片：`（冒号后没内容）就是"这条不写了"，直接丢
		const emptyScoped = /^([^:：]{1,10})\s*[:：]\s*$/.exec(text);
		if (emptyScoped && LABEL_TO_SCOPE[(emptyScoped[1] ?? '').trim()]) continue;

		const match = /^([^:：]{1,10})\s*[:：]\s*(.+)$/.exec(text);
		const scope = match ? LABEL_TO_SCOPE[(match[1] ?? '').trim()] : undefined;
		// 认不出前缀（比如标题里本来就有冒号）时，整行都算标题，按图片算
		const title = (scope ? match?.[2] ?? '' : text).trim();
		if (title === '') continue;

		const target = scope ?? 'image';
		if (!hidden[target].includes(title)) hidden[target].push(title);
	}

	return hidden;
}

/** 名单 → 设置里那段文本（面板写回用；只写有内容的作用域） */
export function serializeHiddenItems(hidden: HiddenItems): string {
	const lines: string[] = [];
	for (const scope of MENU_SCOPES) {
		for (const title of hidden[scope]) {
			lines.push(`${MENU_SCOPE_LABELS[scope]}：${title}`);
		}
	}
	return lines.join('\n');
}

/** 这一项在这个菜单里要不要藏起来 */
export function isHiddenItem(scope: MenuScope, title: string, hidden: HiddenItems): boolean {
	const key = title.trim();
	return hidden[scope].includes(key);
}

/**
 * 改一条（面板用）：hide = true 加进名单，false 拿掉。
 *
 * 判重与写入都按去掉首尾空白后的标题（`isHiddenItem` 也是这么比的）——
 * 免得名单里出现"同一个标题的两种写法"，面板上看着像两项。
 */
export function withHiddenItem(hidden: HiddenItems, scope: MenuScope, title: string, hide: boolean): HiddenItems {
	const key = title.trim();
	const current = hidden[scope].filter(item => item.trim() !== key);
	return { ...hidden, [scope]: hide ? [...current, key] : current };
}

/**
 * 管理面板在一层菜单里要列出的项：**检测到的（按用户看到的顺序）+ 名单里那些这次没检测到的**。
 *
 * 为什么必须并上后者（2026-09 用户报的 bug）：隐藏是在菜单里"摘掉"实现的 ——
 * `addItem` 那一刻不加它，来不及拦的还要在显示之后从 DOM 里摘掉。所以下一次右键时
 * **它已经不在菜单里了**，检测结果里当然也没有它；面板要是只列检测结果，用户关掉一项之后
 * 就再也找不到那个开关，等于永远打不开（用户原话："关掉的选项就不显示了，也就是永远打不开了"）。
 * 名单本身一直存在设置里，并回来就能随时恢复。
 *
 * 去重按去掉首尾空白后的标题比（菜单标题与名单标题都不带空白，这里只是兜底）。
 */
export function menuItemsForPanel(detected: string[], hidden: string[]): string[] {
	const items = detected.map(title => title.trim()).filter(title => title !== '');
	const seen = new Set(items);

	for (const title of hidden) {
		const text = title.trim();
		if (text === '' || seen.has(text)) continue;
		seen.add(text);
		items.push(text);
	}

	return items;
}
