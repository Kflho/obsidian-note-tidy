import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { MENU_SCOPES, MENU_SCOPE_LABELS, emptyHiddenItems, menuItemsForPanel, withHiddenItem } from './menu-hidden';
import type { HiddenItems, MenuScope } from './menu-hidden';
import { OWN_ITEMS, OWN_ITEM_SCOPES } from './image-menu';
import type { OwnItemKey } from './image-menu';

/**
 * 右键菜单管理面板：**按 图片 / 笔记 / 文件夹 三层，看每层菜单里各有哪些项，决定哪些开着哪些关掉**。
 *
 * 清单来自"最近一次右键"：菜单要显示时我们会看一眼它（见 menu-injector.ts），
 * 谁往那份菜单里加了什么都能看到 —— 原生项、其它插件加的项都在内。
 *
 * 两条规矩（都是踩过坑才定下来的）：
 *
 * 1. **开关一律"开着 = 显示"**。早先做成"勾上 = 隐藏"，用户想"开启管理菜单"就把那一项
 *    勾掉了，再也点不开这个面板；
 * 2. **本插件自己的项由各自的开关管，不进隐藏名单**（不然"管理右键菜单"会被自己藏掉）。
 *    同一个开关可能出现在两层里（比如「复制图片」图片菜单与笔记菜单都有）——
 *    所以改完会重画一遍，让两处的开关保持一致。
 *
 * 还有一条是 2026-09 补上的：**已经隐藏的项也必须一直列着**（见 `menuItemsForPanel`）。
 * 隐藏是靠"把项从菜单里摘掉"实现的，摘掉之后就检测不到了 —— 面板要是只列检测结果，
 * 用户关掉一项就再也找不到那个开关，等于永远打不开（用户报的就是这个：文件夹菜单的「删除」）。
 * 所以每层列的是"检测到的 + 名单里的"，另外给一个"全部恢复显示"按钮，一次清空名单。
 *
 * 面板只做"开关 + 写回设置"，不碰菜单逻辑，所以能脱离 Obsidian 单测。
 */
export interface MenuManageModalOptions {
	/** 三个菜单各自最近一次检测到的项（不含本插件自己的项） */
	detected: Record<MenuScope, string[]>;
	/** 当前被隐藏的项（按作用域分） */
	hidden: HiddenItems;
	/** 本插件五项各自的开关 */
	ownItems: Record<OwnItemKey, boolean>;
	/** 写回设置并落盘 */
	save: (next: { hidden: HiddenItems; ownItems: Record<OwnItemKey, boolean> }) => Promise<void>;
}


/** 三层各自"还没打开过"时的提示：告诉用户怎么把清单弄出来 */
const EMPTY_HINTS: Record<MenuScope, string> = {
	image: '暂时没有可显示的项目。请先在笔记中右键一次图片，再打开本面板。',
	note: '暂时没有可显示的项目。请先在笔记正文中右键一次，再打开本面板。',
	folder: '暂时没有可显示的项目。请先在左侧文件列表中右键一次文件或文件夹，再打开本面板。',
};

/**
 * 已隐藏那一行的说明。
 *
 * "这次还检测得到"与"检测不到"要分开讲：后者是名单里攒下的、当前菜单里见不到的记录
 * （旧版本的名单、或者菜单项本身变了名字），用户看到一串陌生的名字时不至于以为坏了。
 */
function hiddenHint(detectedNow: boolean): string {
	return detectedNow
		? '已隐藏：打开开关即可恢复显示'
		: '已隐藏：最近一次检测这个菜单时没有见到它（可能是旧版本留下的记录），打开开关即可恢复显示';
}

export class MenuManageModal extends Modal {
	private hidden: HiddenItems;
	private ownItems: Record<OwnItemKey, boolean>;
	/** 首屏渲染期间别把 setValue 当成用户操作（有些控件版本会回调 onChange） */
	private rendering = true;

	constructor(app: App, private readonly config: MenuManageModalOptions) {
		super(app);
		this.hidden = { image: [...config.hidden.image], note: [...config.hidden.note], folder: [...config.hidden.folder] };
		this.ownItems = { ...config.ownItems };
	}

	onOpen(): void {
		this.contentEl.addClass('ait-image-menu-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** 画面板：三层各一节，每节先列本插件的项，再列这一层菜单里的其它项目 */
	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.rendering = true;

		contentEl.createEl('h2', { text: '右键菜单' });
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: '按 图片 / 笔记 / 文件夹 三层分别列出最近一次打开该菜单时其中的项目，包括 Obsidian 自带的和其它插件添加的。打开开关即在菜单中显示该项，关闭即隐藏；关掉的项会一直留在下面的清单里，随时可以再打开。',
		});

		for (const scope of MENU_SCOPES) {
			const detected = this.config.detected[scope];
			const hiddenCount = this.hidden[scope].length;
			const heading = `${MENU_SCOPE_LABELS[scope]}菜单`;
			contentEl.createEl('h3', { text: hiddenCount > 0 ? `${heading}（已隐藏 ${hiddenCount} 项）` : heading });

			// 本插件在这一层加的项（开关是同一个，改完重画让两层保持一致）
			const keys = (Object.keys(OWN_ITEM_SCOPES) as OwnItemKey[])
				.filter(key => OWN_ITEM_SCOPES[key].includes(scope));
			for (const key of keys) {
				this.addToggle(OWN_ITEMS[key].title, this.ownItems[key], OWN_ITEMS[key].desc, (value) => {
					this.ownItems = { ...this.ownItems, [key]: value };
				});
			}

			// 检测到的 + 已经隐藏的：隐藏项在菜单里已经被摘掉，下次检测不到，只能靠名单列出来
			const items = menuItemsForPanel(detected, this.hidden[scope]);
			if (items.length === 0) {
				contentEl.createEl('p', { cls: 'setting-item-description', text: EMPTY_HINTS[scope] });
				continue;
			}

			const detectedTitles = new Set(detected.map(title => title.trim()));
			contentEl.createEl('p', {
				cls: 'setting-item-description',
				text: detected.length === 0
					? '最近一次没有检测到这个菜单（可能还没在它上面右键过）。下面是已经隐藏的项目：'
					: '以下为该菜单中的其它项目，含已经关掉的（关掉的项也留在这里，随时能再打开）：',
			});
			for (const title of items) {
				const hidden = this.isHidden(scope, title);
				this.addToggle(title, !hidden, hidden ? hiddenHint(detectedTitles.has(title)) : '', (value) => {
					this.setHidden(scope, title, !value);
				});
			}
		}

		// 名单是一段文本，攒久了会混进旧版本的记录；给一个一次清空的出口
		contentEl.createEl('h3', { text: '恢复' });
		new Setting(contentEl)
			.setName('全部恢复显示')
			.setDesc('清空隐藏名单：三个菜单里被关掉的项全部恢复显示。本插件自己的五项由上面的开关控制，不受影响。')
			.addButton(button => button
				.setButtonText('全部恢复显示')
				.onClick(async () => {
					this.hidden = emptyHiddenItems();
					await this.persist();
				}));

		this.rendering = false;
	}

	/** 一行开关：`value` 是"开着 = 显示" */
	private addToggle(name: string, value: boolean, desc: string, apply: (value: boolean) => void): void {
		new Setting(this.contentEl)
			.setName(name)
			.setDesc(desc)
			.addToggle(toggle => toggle
				.setValue(value)
				.onChange(async (next: boolean) => {
					apply(next);
					if (this.rendering) return;
					await this.persist();
				}));
	}

	private isHidden(scope: MenuScope, title: string): boolean {
		const key = title.trim();
		return this.hidden[scope].some(item => item.trim() === key);
	}

	private setHidden(scope: MenuScope, title: string, hide: boolean): void {
		this.hidden = withHiddenItem(this.hidden, scope, title, hide);
	}

	/** 存盘并重画：同一个开关可能出现在两层里，重画才能让两处一致 */
	private async persist(): Promise<void> {
		await this.config.save({ hidden: this.hidden, ownItems: this.ownItems });
		this.render();
	}
}
