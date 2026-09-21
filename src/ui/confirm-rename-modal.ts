import { App, Modal } from 'obsidian';

/**
 * 批量重命名确认对话框（从 main.ts 抽出）。
 *
 * 重命名会调用 Obsidian 原生接口改写全库引用，条数多时先让用户确认一次 ——
 * 这是唯一一个会动很多文件的破坏性操作。
 */
export class ConfirmRenameModal extends Modal {
	private imageCount: number;
	private onConfirm: () => Promise<void>;

	constructor(app: App, imageCount: number, onConfirm: () => Promise<void>) {
		super(app);
		this.imageCount = imageCount;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '确认批量重命名' });
		contentEl.createEl('p', {
			text: `发现 ${this.imageCount} 张图片将被重命名为预设格式，确认执行？`
		});
		contentEl.createEl('p', {
			text: '⚠️ 此操作会调用 Obsidian 原生接口，自动更新全库所有引用链接，不会产生断链。',
			cls: 'mod-warning'
		});

		const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });

		const cancelBtn = buttonContainer.createEl('button', { text: '取消' });
		cancelBtn.addEventListener('click', () => this.close());

		const confirmBtn = buttonContainer.createEl('button', { text: '确认重命名', cls: 'mod-cta' });
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
