import { MarkdownView, Notice } from 'obsidian';
import type { Editor, MarkdownFileInfo, Plugin } from 'obsidian';
import type { ImageTasks } from './tasks';
import { editorImagePicks, TIDY_IMAGES_LABEL } from './ui/image-menu';

/**
 * 命令注册（从 main.ts 抽出）。
 *
 * 命令与右键菜单里的操作一一对应：**命令 ID 是已发布版本的稳定接口，不能改名**
 * （test/commands.test.ts 会逐条比对菜单与命令表，漏注册就失败）。
 *
 * 「当前笔记」类命令在没打开笔记时立刻提示；「整个仓库」类命令直接铺开执行。
 * 唯一的例外是「复制图片」：它放在**编辑器 / 图片的右键菜单**上（不是文件菜单），
 * 所以审计表里单独列在 EDITOR_OPERATIONS。
 */

/** 命令里反复用到的「拿当前文件」检查 */
const NO_FILE_MESSAGE = '请先打开一篇笔记。';

export function registerCommands(plugin: Plugin, tasks: ImageTasks): void {
	const app = plugin.app;
	const currentFile = (ctx: MarkdownView | MarkdownFileInfo) => ctx.file ?? null;

	// ---------------------------------------------------------- 外部图片转换
	plugin.addCommand({
		id: 'transfer-images-current-note',
		name: '导入当前笔记的外部图片',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			await tasks.transferCurrentNote(currentFile(ctx));
		}
	});

	plugin.addCommand({
		id: 'transfer-images-entire-vault',
		name: '导入整个仓库的外部图片',
		callback: async () => {
			await tasks.transferEntireVault();
		}
	});

	plugin.addCommand({
		id: 'convert-images-entire-vault',
		name: '转换整个仓库的图片格式',
		callback: async () => {
			await tasks.convertEntireVault();
		}
	});

	plugin.addCommand({
		id: 'convert-images-current-note',
		name: '转换当前笔记的图片格式',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			await tasks.convertNoteImages(currentFile(ctx));
		}
	});

	plugin.addCommand({
		id: 'tidy-images',
		name: TIDY_IMAGES_LABEL,
		callback: async () => {
			await tasks.tidyImages(true);
		}
	});

	plugin.addCommand({
		id: 'clear-unused-images',
		name: '清理未引用的图片',
		callback: async () => {
			await tasks.clearUnusedImagesWithConfirm();
		}
	});

	// ---------------------------------------------------------- 图片重命名
	plugin.addCommand({
		id: 'rename-all-images-entire-vault',
		name: '按预设格式重命名整个仓库的图片',
		callback: async () => {
			await tasks.renameEntireVaultToPreset(false);
		}
	});

	plugin.addCommand({
		id: 'force-rename-all-images-entire-vault',
		name: '强制按预设格式重命名整个仓库的图片',
		callback: async () => {
			await tasks.renameEntireVaultToPreset(true);
		}
	});

	plugin.addCommand({
		id: 'rename-garbled-images-current-note',
		name: '重命名当前笔记中的乱码图片',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = currentFile(ctx);
			if (!file) {
				new Notice(NO_FILE_MESSAGE);
				return;
			}
			await tasks.renameGarbled([file], '本文件内');
		}
	});

	plugin.addCommand({
		id: 'rename-garbled-images-entire-vault',
		name: '重命名整个仓库中的乱码图片',
		callback: async () => {
			await tasks.renameGarbled(app.vault.getMarkdownFiles(), '整个仓库');
		}
	});

	// ---------------------------------------------------------- 图片位置与大小
	plugin.addCommand({
		id: 'organize-images-current-note',
		name: '整理当前笔记的图片位置',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = currentFile(ctx);
			if (!file) {
				new Notice(NO_FILE_MESSAGE);
				return;
			}
			await tasks.organizeImages([file], '当前笔记');
		}
	});

	plugin.addCommand({
		id: 'organize-images-entire-vault',
		name: '整理整个仓库的图片位置',
		callback: async () => {
			await tasks.organizeImages(app.vault.getMarkdownFiles(), '整个仓库');
		}
	});

	plugin.addCommand({
		id: 'set-image-size-current-note',
		name: '设置当前笔记的图片大小',
		editorCallback: (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = currentFile(ctx);
			if (!file) {
				new Notice(NO_FILE_MESSAGE);
				return;
			}
			tasks.openImageSize([file], '当前笔记');
		}
	});

	plugin.addCommand({
		id: 'set-image-size-entire-vault',
		name: '设置整个仓库的图片大小',
		callback: () => {
			tasks.openImageSize(app.vault.getMarkdownFiles(), '整个仓库');
		}
	});

	plugin.addCommand({
		id: 'quick-set-image-size-current-note',
		name: '快速设置当前笔记的图片大小',
		// 不用 editorCallback：那个在阅读模式下会让命令从面板里消失，而笔记多半是在阅读模式里看的
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			if (!file) return false;
			if (!checking) {
				void tasks.quickSetImageSize(file);
			}
			return true;
		}
	});

	plugin.addCommand({
		id: 'copy-images-to-clipboard',
		name: '复制图片到剪贴板',
		// 不用 editorCallback：那个在阅读模式下会让命令变灰，而图片多半是在阅读模式里右键的
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			const editor = view?.editor;
			if (!file || !editor) return false;
			if (!checking) {
				const picks = editorImagePicks(editor);
				void tasks.copyImages(file, picks.refs, picks.selection);
			}
			return true;
		}
	});

	plugin.addCommand({
		id: 'manage-image-menu',
		name: '管理右键菜单',
		callback: () => {
			tasks.openMenuManager();
		}
	});

	// ---------------------------------------------------------- 文本排版
	plugin.addCommand({
		id: 'format-chat-log-current-note',
		name: '修复当前笔记的排版',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = currentFile(ctx);
			if (!file) {
				new Notice(NO_FILE_MESSAGE);
				return;
			}
			await tasks.typeset([file], '本文件内');
		}
	});

	plugin.addCommand({
		id: 'format-chat-log-entire-vault',
		name: '修复整个仓库的排版',
		callback: async () => {
			await tasks.typeset(app.vault.getMarkdownFiles(), '整个仓库');
		}
	});

	plugin.addCommand({
		id: 'typeset-selection',
		name: '排版选中内容',
		// 不用 editorCallback：那个在阅读模式下会让命令从面板里消失；这里本来也要求有选区
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			const editor = view?.editor;
			if (!file || !editor) return false;
			if (!checking) {
				void tasks.typesetSelection(file, editor);
			}
			return true;
		}
	});

	plugin.addCommand({
		id: 'paste-as-chat-log',
		name: '粘贴为聊天记录',
		// 和「排版选中内容」一样走 checkCallback：阅读模式下命令也要在面板里看得到
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			const editor = view?.editor;
			if (!file || !editor) return false;
			if (!checking) {
				void tasks.pasteAsChatLog(file, editor);
			}
			return true;
		}
	});

	plugin.addCommand({
		id: 'quick-fix-chat-log-current-note',
		name: '快速修复聊天记录',
		// 不用 editorCallback：那个在阅读模式下会让命令从面板里消失，而聊天记录多半是在阅读模式里看的
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			if (!file) return false;
			if (!checking) {
				void tasks.quickFixChatLog(file);
			}
			return true;
		}
	});

	plugin.addCommand({
		id: 'import-bangumi-topic',
		name: '从 bgm.tv 网页导入讨论到当前笔记',
		checkCallback: (checking: boolean) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			const file = view?.file ?? null;
			if (!file) return false;
			if (!checking) {
				void tasks.importBangumiTopic();
			}
			return true;
		}
	});
}
