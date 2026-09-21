import { Menu, MenuItem, TFolder, TFile } from 'obsidian';
import type { App, Plugin, TAbstractFile } from 'obsidian';
import type { TaskActions } from '../tasks';

/**
 * 文件 / 文件夹右键菜单（从 main.ts 抽出）。
 *
 * 顶层只放「图片功能」与「文本排版」两个二级栏入口，避免菜单过长。
 * 文件与文件夹共用同一套实现，只靠 files / where / label 三个参数区分。
 * 菜单里的每个操作都在命令面板里有对应命令（test/commands.test.ts 会对照检查）。
 */

/**
 * MenuItem 的运行时扩展：Obsidian 一直有原生子菜单，只是没写进公开类型定义。
 * 调用 setSubmenu() 后菜单项会获得 `has-submenu` 类，并在最右侧自动画出 › 箭头
 * （`div.menu-item-icon.mod-submenu`，配合 `.menu-item-title { flex: 1 0 0 }` 顶到行尾）。
 * 拿不到时（旧版本 / 未来被移除）回退到"点击后在光标处弹出"，功能不受影响。
 */
type MenuItemWithSubmenu = MenuItem & { setSubmenu?: () => Menu };

/** 注册 file-menu 事件（由插件负责清理：走 registerEvent） */
export function registerFileMenu(plugin: Plugin, actions: TaskActions): void {
	const app: App = plugin.app;
	plugin.registerEvent(
		app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === 'md') {
				addImageSubmenu(menu, actions, [file], '本文件内', file.name);
				addTextSubmenu(menu, actions, [file], '本文件内');
			} else if (file instanceof TFolder) {
				const prefix = file.path === '/' ? '' : file.path + '/';
				const files = app.vault.getMarkdownFiles().filter(f => f.path.startsWith(prefix));
				addImageSubmenu(menu, actions, files, '该文件夹下', `文件夹 ${file.name}`);
				addTextSubmenu(menu, actions, files, '该文件夹下');
			}
		})
	);
}

/**
 * 往父菜单里添加一个二级栏入口。
 *
 * 优先使用 Obsidian 的原生子菜单（MenuItem.setSubmenu）：它负责在菜单项最右边
 * 画出 › 箭头，并在悬停/点击时于旁边展开子菜单，父菜单保持打开 —— 与系统菜单一致，
 * 用户一眼就能看出"这里还有下一级"。
 *
 * 该接口没有写进公开类型定义，所以运行时探测；万一某天没了，就退回到旧做法：
 * 点击后在光标处弹出子菜单，标题自带 › 以免看不出层级。
 */
function addSubmenuEntry(parent: Menu, title: string, icon: string, build: (menu: Menu) => void) {
	parent.addItem((item) => {
		const nativeSetSubmenu = (item as MenuItemWithSubmenu).setSubmenu;
		const hasNativeSubmenu = typeof nativeSetSubmenu === 'function';

		// 原生子菜单的箭头由 Obsidian 自己画，只有退化路径需要手工补 ›
		item.setTitle(hasNativeSubmenu ? title : `${title} ›`).setIcon(icon);

		if (hasNativeSubmenu) {
			build(nativeSetSubmenu.call(item));
			return;
		}

		item.onClick((evt: MouseEvent | KeyboardEvent) => {
			const submenu = new Menu();
			build(submenu);
			// 用坐标判断而不是 instanceof MouseEvent：弹出窗口里的 MouseEvent
			// 与主窗口不是同一个构造器，instanceof 会误判成键盘事件
			const pointer = evt as MouseEvent;
			if (typeof pointer.clientX === 'number' && typeof pointer.clientY === 'number') {
				submenu.showAtMouseEvent(pointer);
			} else {
				// 键盘触发时没有坐标，退化为在窗口中上部弹出
				submenu.showAtPosition({ x: window.innerWidth / 2, y: window.innerHeight / 3 });
			}
		});
	});
}

/**
 * 图片功能二级菜单
 * @param files 参与处理的笔记
 * @param where 菜单文案片段（「本文件内」/「该文件夹下」）
 * @param label 弹窗里的影响范围描述
 */
function addImageSubmenu(parent: Menu, actions: TaskActions, files: TFile[], where: string, label: string) {
	addSubmenuEntry(parent, '图片功能', 'image', (menu) => {
		menu.addItem((item) => {
			item
				.setTitle(`转换${where}的外部图片`)
				.setIcon('image-plus')
				.onClick(async () => {
					await actions.transferExternal(files, where);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle(`重命名${where}的乱码图片`)
				.setIcon('image-minus')
				.onClick(async () => {
					await actions.renameGarbled(files, where);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle(`将${where}的所有图片重命名为预设格式`)
				.setIcon('image')
				.onClick(async () => {
					await actions.renameToPreset(files, where, false);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle(`强制将${where}的所有图片重命名为预设格式`)
				.setIcon('image')
				.onClick(async () => {
					await actions.renameToPreset(files, where, true);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle(`整理${where}图片位置`)
				.setIcon('folder')
				.onClick(async () => {
					await actions.organizeImages(files, where);
				});
		});

		menu.addItem((item) => {
			item
				.setTitle(`设置${where}图片的大小`)
				.setIcon('image')
				.onClick(() => {
					actions.openImageSize(files, label);
				});
		});
	});
}

/** 文本排版二级菜单 */
function addTextSubmenu(parent: Menu, actions: TaskActions, files: TFile[], where: string) {
	addSubmenuEntry(parent, '文本排版', 'message-square', (menu) => {
		menu.addItem((item) => {
			item
				.setTitle(`修复${where}的排版（空格 / 缩进 / 聊天记录 / 标签 / 公式）`)
				.setIcon('message-square')
				.onClick(async () => {
					await actions.typeset(files, where);
				});
		});
	});
}
