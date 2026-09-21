/**
 * 状态栏进度指示（从 main.ts 抽出）。
 *
 * 右下角显示 `📷 图片重命名: 3/36`；完成后显示结果并在 5 秒后清空
 * —— 批量操作动辄跑几十秒，没有进度用户会以为插件卡死了。
 */
export class StatusBarProgress {
	constructor(private readonly el: HTMLElement) {}

	/** 显示进度：第 current 篇 / 共 total 篇 */
	show(current: number, total: number, label?: string): void {
		const prefix = label ?? '处理进度';
		this.el.setText(`${prefix}: ${current}/${total}`);
	}

	/** 完成：显示结果，5 秒后自动清空 */
	finish(message: string): void {
		this.el.setText(message);
		window.setTimeout(() => {
			this.el.setText('');
		}, 5000);
	}

	/** 出错 / 没有改动：立刻清空 */
	clear(): void {
		this.el.setText('');
	}
}
