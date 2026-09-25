import { Notice, Plugin } from 'obsidian';
import { BatchRunner } from './batch';
import { registerCommands } from './commands';
import { DEFAULT_SETTINGS, ImageTransferSettingTab } from './settings';
import type { ImageTransferSettings } from './settings';
import { ImageTasks } from './tasks';
import { registerFileMenu } from './ui/menus';
import { registerImageMenu } from './ui/image-menu';
import { registerCopyShortcut } from './ui/copy-shortcut';
import { NoticeSuppressor } from './ui/notice-suppressor';
import { StatusBarProgress } from './ui/progress';
import { SelectionImageCount } from './ui/selection-count';
import { selectionCountExtension } from './ui/selection-status';

/**
 * 插件入口：只管生命周期与装配。
 *
 * 排版流水线、图片功能的实现都在各自模块里（见 CLAUDE.md 的源码结构）；
 * 这里只做三件事：读设置、把各部件接起来、注册命令与右键菜单。
 */
export default class ImageTransferPlugin extends Plugin {
	settings!: ImageTransferSettings;
	private tasks!: ImageTasks;
	private selectionCount!: SelectionImageCount;

	async onload() {
		await this.loadSettings();

		// 状态栏进度条目（初始为空，批量操作时才显示）
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('');
		const progress = new StatusBarProgress(statusBarItemEl);

		// 状态栏的「选中内容的图片张数」——另占一格：批量进度会反复改写自己那格、
		// 完成后还延时清空，两者共用一个元素会互相覆盖
		this.selectionCount = new SelectionImageCount(
			this.addStatusBarItem(),
			() => this.settings.showSelectionImageCount === true
		);
		// Obsidian 没有"选区变化"事件，只能挂一个 CodeMirror 扩展（见 ui/selection-status.ts）
		this.registerEditorExtension(selectionCountExtension(text => this.selectionCount.update(text)));

		// 批量任务外壳：互斥锁 + 通知屏蔽 + 状态栏进度
		const runner = new BatchRunner(this.app, progress, new NoticeSuppressor());
		this.tasks = new ImageTasks(this.app, () => this.settings, runner, progress, () => this.saveSettings());

		registerCommands(this, this.tasks);
		registerFileMenu(this, this.tasks, () => this.settings);
		// 「复制图片」挂在编辑器 / 图片的右键菜单上（不是文件菜单）
		registerImageMenu(this, this.tasks, () => this.settings);
		// 可选的 Ctrl+C 接管（设置里开启后才生效）
		registerCopyShortcut(this, this.tasks, () => this.settings);

		this.addSettingTab(new ImageTransferSettingTab(this.app, this));

		new Notice(`Note Tidy v${this.manifest.version} 已加载`);
	}

	async loadSettings() {
		const data = (await this.loadData()) as ImageTransferSettings | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// 面板里可能刚改了状态栏那个开关：立刻按新设置刷一次，不用等用户下次动选区
		this.refreshSelectionCount();
	}

	/** 按编辑器里当前的选区刷新状态栏那一格（拿不到编辑器时当作"没有选中"） */
	private refreshSelectionCount(): void {
		const editor = this.app.workspace.activeEditor?.editor;
		const selected = editor && editor.somethingSelected() ? editor.getSelection() : '';
		this.selectionCount.update(selected);
	}
}
