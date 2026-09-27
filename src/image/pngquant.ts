import { spawn } from 'child_process';

/**
 * pngquant 这一步（**调用户自己装的那份**，不捆绑、不下载）。
 *
 * ## 为什么是"自己装"
 *
 * pngquant 是 GPL / 商业双许可的**外部可执行文件**（[pngquant.org](https://pngquant.org/)，
 * 源码 GPL 或商业授权）。社区插件把一个 GPL 二进制打进 0-BSD 的包里，既改变整个分发包的许可，
 * 也过不了插件审查（平台相关二进制、体积）。
 * Image Converter 也是这么做的：它只提供一个「pngquant executable path」设置项，
 * 二进制由用户自己下载。我们照抄这个边界。
 *
 * ## 调用方式（与 Image Converter 完全一致，实测它的实现）
 *
 * ```js
 * pngquant --quality 65-80 -      // stdin 进 PNG、stdout 出压缩后的 PNG
 * ```
 *
 * 三条要照抄的行为：
 *
 * - **只吃 PNG**：喂 JPEG 之类进去它会报错退出，所以非 PNG 源在计划阶段就被挡掉（见 `shouldConvertFile`）；
 * - **质量档是 `min-max` 字符串**（`65-80`），不是我们那套 0–100 的单值；
 * - **退出码非 0 一律当"别用这次结果"**：质量达不到 `min` 时它会原样吐 24-bit PNG 并 `exit 99`
 *   （[官方说明](https://pngquant.org/) "won't be saved … will exit with status code 99"），
 *   那正是"压不动、留着原图"的信号 —— 与 Image Converter 的 `code !== 0 → 抛错 → 原图`
 *   是同一个结果。
 */

/** pngquant 这一步的配置：可执行文件路径 + 质量档（`65-80`） */
export interface PngquantSettings {
	path: string;
	quality: string;
}

/** 跑一次 pngquant：成功返回压缩后的 PNG 字节，任何不对劲都返回 `null`（调用方按"这一步不做"处理） */
export type PngquantRunner = (
	settings: PngquantSettings,
	bytes: ArrayBuffer,
	/** 只在测试里换：`node -e <假 pngquant>` 之类 */
	args?: string[]
) => Promise<ArrayBuffer | null>;

/** `--quality` 的默认档（与 Image Converter 自己的默认值一致） */
export const DEFAULT_PNGQUANT_QUALITY = '65-80';

/**
 * 执行 pngquant：把 `bytes` 从 stdin 喂进去，从 stdout 收结果。
 *
 * @param settings 可执行文件路径 + 质量档
 * @param bytes 待压缩的 PNG 字节
 * @param args 覆盖命令行参数（**只有测试用**：换成 `['-e', 脚本]` 跑一个假 pngquant）
 * @returns 压缩后的 PNG 字节；找不到可执行文件 / 非零退出 / 输出为空 / 输出不是 PNG 时 `null`
 */
export const runPngquant: PngquantRunner = async (settings, bytes, args) => {
	const executable = settings.path.trim();
	if (executable === '') return null;

	const quality = settings.quality.trim() === '' ? DEFAULT_PNGQUANT_QUALITY : settings.quality.trim();
	// `-`：从 stdin 读、往 stdout 写（与 Image Converter 同一套参数）
	const argv = args ?? ['--quality', quality, '-'];

	return await new Promise<ArrayBuffer | null>((resolve) => {
		let child;
		try {
			child = spawn(executable, argv, { windowsHide: true });
		} catch (err) {
			console.error('⚠️ 起不了 pngquant（检查可执行文件路径），按原格式处理这张图', err);
			resolve(null);
			return;
		}

		const chunks: Buffer[] = [];
		let settled = false;
		const finish = (result: ArrayBuffer | null): void => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		child.stdout?.on('data', (chunk: Buffer) => { chunks.push(chunk); });
		child.on('error', (err) => {
			console.error('⚠️ pngquant 跑不起来（路径对不对？），按原格式处理这张图', err);
			finish(null);
		});
		child.on('close', (code) => {
			// 非零退出（含 99 = 质量达不到 min）＝ 这次结果不能用
			if (code !== 0) {
				finish(null);
				return;
			}
			const output = Buffer.concat(chunks);
			if (output.byteLength === 0) {
				finish(null);
				return;
			}
			// 拷一份独立的 ArrayBuffer：`Buffer` 的底层池子可能比这一份数据大得多
			finish(
				output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength)
			);
		});

		child.stdin?.on('error', () => { /* 它没读 stdin 就走了：close 那边会收尾 */ });
		child.stdin?.write(Buffer.from(bytes));
		child.stdin?.end();
	});
};
