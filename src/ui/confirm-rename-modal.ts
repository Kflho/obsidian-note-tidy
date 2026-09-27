import { App, Modal } from 'obsidian';

/**
 * 批量操作的确认对话框（从 main.ts 抽出）。
 *
 * 重命名与"转换全库图片格式"都会调用 Obsidian 原生接口改写全库引用、动很多文件，
 * 条数多时先让用户确认一次 —— 文案默认是重命名那一套，另一个入口传自己的文案进来。
 */
export interface ConfirmModalTexts {
	title: string;
	message: string;
	warning: string;
	confirmLabel: string;
}

export class ConfirmRenameModal extends Modal {
	private onConfirm: () => Promise<void>;
	private texts: ConfirmModalTexts;

	constructor(app: App, imageCount: number, onConfirm: () => Promise<void>, texts?: Partial<ConfirmModalTexts>) {
		super(app);
		this.onConfirm = onConfirm;
		this.texts = {
			title: '确认批量重命名',
			message: `发现 ${imageCount} 张图片将被重命名为预设格式，确认执行？`,
			warning: '⚠️ 此操作会调用 Obsidian 原生接口，自动更新全库所有引用链接，不会产生断链。',
			confirmLabel: '确认重命名',
			...texts,
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: this.texts.title });
		contentEl.createEl('p', { text: this.texts.message });
		contentEl.createEl('p', { text: this.texts.warning, cls: 'mod-warning' });

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonContainer.createEl('button', { text: this.texts.confirmLabel, cls: 'mod-cta' });
		confirmBtn.addEventListener('click', () => {
			this.close();
			void this.onConfirm();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
