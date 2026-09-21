import { Notice, Plugin } from 'obsidian';
import { BatchRunner } from './batch';
import { registerCommands } from './commands';
import { DEFAULT_SETTINGS, ImageTransferSettingTab } from './settings';
import type { ImageTransferSettings } from './settings';
import { ImageTasks } from './tasks';
import { registerFileMenu } from './ui/menus';
import { NoticeSuppressor } from './ui/notice-suppressor';
import { StatusBarProgress } from './ui/progress';

/**
 * 插件入口：只管生命周期与装配。
 *
 * 排版流水线、图片功能的实现都在各自模块里（见 CLAUDE.md 的源码结构）；
 * 这里只做三件事：读设置、把各部件接起来、注册命令与右键菜单。
 */
export default class ImageTransferPlugin extends Plugin {
	settings!: ImageTransferSettings;
	private tasks!: ImageTasks;

	async onload() {
		await this.loadSettings();

		// 状态栏进度条目（初始为空，批量操作时才显示）
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('');
		const progress = new StatusBarProgress(statusBarItemEl);

		// 批量任务外壳：互斥锁 + 通知屏蔽 + 状态栏进度
		const runner = new BatchRunner(this.app, progress, new NoticeSuppressor());
		this.tasks = new ImageTasks(this.app, () => this.settings, runner, progress);

		registerCommands(this, this.tasks);
		registerFileMenu(this, this.tasks);

		this.addSettingTab(new ImageTransferSettingTab(this.app, this));

		new Notice(`Note Tidy v${this.manifest.version} reloaded`);
	}

	async loadSettings() {
		const data = (await this.loadData()) as ImageTransferSettings | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
