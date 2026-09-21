import { Notice } from 'obsidian';
import type { Editor, MarkdownFileInfo, MarkdownView, Plugin } from 'obsidian';
import type { ImageTasks } from './tasks';

/**
 * 命令注册（从 main.ts 抽出）。
 *
 * 12 条命令与右键菜单里的操作一一对应：**命令 ID 是已发布版本的稳定接口，不能改名**
 * （test/commands.test.ts 会逐条比对菜单与命令表，漏注册就失败）。
 *
 * 「当前笔记」类命令在没打开笔记时立刻提示；「整个仓库」类命令直接铺开跑。
 */

/** 命令里反复用到的「拿当前文件」检查 */
const NO_FILE_MESSAGE = '⚠️ 无法获取当前文件，请确保您打开了一篇笔记！';

export function registerCommands(plugin: Plugin, tasks: ImageTasks): void {
	const app = plugin.app;
	const currentFile = (ctx: MarkdownView | MarkdownFileInfo) => ctx.file ?? null;

	// ---------------------------------------------------------- 外部图片转换
	plugin.addCommand({
		id: 'transfer-images-current-note',
		name: '转换当前笔记中的外部图片',
		editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			await tasks.transferCurrentNote(currentFile(ctx));
		}
	});

	plugin.addCommand({
		id: 'transfer-images-entire-vault',
		name: '转换整个仓库中的外部图片',
		callback: async () => {
			await tasks.transferEntireVault();
		}
	});

	// ---------------------------------------------------------- 图片重命名
	plugin.addCommand({
		id: 'rename-all-images-entire-vault',
		name: '将整个仓库中的所有图片重命名为预设格式',
		callback: async () => {
			await tasks.renameEntireVaultToPreset(false);
		}
	});

	plugin.addCommand({
		id: 'force-rename-all-images-entire-vault',
		name: '强制重命名整个仓库中的所有图片（包括已符合格式的图片）',
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

	// ---------------------------------------------------------- 文本排版
	plugin.addCommand({
		id: 'format-chat-log-current-note',
		name: '修复当前笔记的排版（空格 / 缩进 / 聊天记录 / 标签 / 公式）',
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
		name: '修复整个仓库的排版（空格 / 缩进 / 聊天记录 / 标签 / 公式）',
		callback: async () => {
			await tasks.typeset(app.vault.getMarkdownFiles(), '整个仓库');
		}
	});
}
