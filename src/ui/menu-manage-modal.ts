import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { MENU_SCOPES, MENU_SCOPE_LABELS, withHiddenItem } from './menu-hidden';
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
			text: '按 图片 / 笔记 / 文件夹 三层分别列出最近一次打开该菜单时其中的项目，包括 Obsidian 自带的和其它插件添加的。打开开关即在菜单中显示该项，关闭即隐藏。',
		});

		for (const scope of MENU_SCOPES) {
			contentEl.createEl('h3', { text: `${MENU_SCOPE_LABELS[scope]}菜单` });

			// 本插件在这一层加的项（开关是同一个，改完重画让两层保持一致）
			const keys = (Object.keys(OWN_ITEM_SCOPES) as OwnItemKey[])
				.filter(key => OWN_ITEM_SCOPES[key].includes(scope));
			for (const key of keys) {
				this.addToggle(OWN_ITEMS[key].title, this.ownItems[key], OWN_ITEMS[key].desc, (value) => {
					this.ownItems = { ...this.ownItems, [key]: value };
				});
			}

			const detected = this.config.detected[scope];
			if (detected.length === 0) {
				contentEl.createEl('p', { cls: 'setting-item-description', text: EMPTY_HINTS[scope] });
				continue;
			}
			contentEl.createEl('p', { cls: 'setting-item-description', text: '以下为该菜单中的其它项目：' });
			for (const title of detected) {
				this.addToggle(title, !this.isHidden(scope, title), '', (value) => {
					this.setHidden(scope, title, !value);
				});
			}
		}

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
		return this.hidden[scope].includes(title);
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
