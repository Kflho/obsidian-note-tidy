import { App, Modal, Setting } from 'obsidian';

/**
 * 「从 Bangumi 网页导入讨论」弹窗：只收一个网址，确认后交给 `ImageTasks` 去抓取。
 *
 * 抓取与解析都不在这里 —— 弹窗只负责输入；联网只在用户点「抓取并排版」之后发生。
 */
export class BangumiImportModal extends Modal {
	private url = '';
	private readonly onSubmit: (url: string) => void;
	private submitButton: HTMLButtonElement | null = null;

	constructor(app: App, onSubmit: (url: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: '从 bgm.tv 网页导入讨论' });
		contentEl.createEl('p', {
			cls: 'setting-item-description',
			text: '粘贴讨论页网址，确认后抓取并插入当前光标处。',
		});

		new Setting(contentEl)
			.setName('讨论页网址')
			.setDesc('例：bgm.tv/group/topic/435751')
			.addText(text => {
				text
					.setPlaceholder('粘贴讨论页网址')
					.setValue(this.url)
					.onChange(value => {
						this.url = value;
						this.refreshSubmit();
					});
				text.inputEl.addEventListener('keydown', event => {
					if (event.key === 'Enter') {
						event.preventDefault();
						this.submit();
					}
				});
			});

		const buttons = contentEl.createDiv({ cls: 'modal-button-container' });
		buttons.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
		this.submitButton = buttons.createEl('button', { text: '抓取并排版', cls: 'mod-cta' });
		this.submitButton.addEventListener('click', () => this.submit());
		this.refreshSubmit();
	}

	private refreshSubmit(): void {
		if (!this.submitButton) return;
		this.submitButton.disabled = this.url.trim() === '';
	}

	private submit(): void {
		const url = this.url.trim();
		if (!url) return;
		this.close();
		this.onSubmit(url);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
