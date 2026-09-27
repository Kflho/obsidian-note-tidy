import { spawn } from 'child_process';
import { existsSync } from 'fs';

/**
 * pngquant 这一步（二进制**装在系统里**，插件不捆绑、不下载）。
 *
 * ## 从哪儿找它
 *
 * 设置里填了就用用户那份（完整路径，或者命令名）；**留空＝按系统里装的那份找**：
 * 先在 `PATH` 里找 `pngquant`（Windows 上 Node 会自己补 `.exe`），再退到几个常见安装位置
 * （见 `pngquantCandidates`）—— 后者是给"刚装完、Obsidian 还没重启、进程的 PATH 还是旧的"
 * 这种情况兜底的。都找不到时这一档整步不做（图片保持原样），命令那边会提示去装或去填路径。
 *
 * ## 为什么是自己装
 *
 * pngquant 是 GPL / 商业双许可的**外部可执行文件**（[pngquant.org](https://pngquant.org/)，
 * 源码 GPL 或商业授权）。把它打进 0-BSD 的社区插件里，既改变整个分发包的许可、又要多背
 * 1 MB 的 base64（市场安装只拉 main.js / manifest / styles 三个文件，二进制只能编进 main.js），
 * 所以划的界线是：**用户装，插件只负责找到它**。Image Converter 也是这个界线 ——
 * 它连 `PATH` 都不找，只认设置里那个完整路径。
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
	/** 用户填的路径；**留空＝用系统里装的那份**（见 `pngquantCandidates`） */
	path: string;
	quality: string;
}

/** 探测一次最多等多久（进程卡住时别把整批拖死） */
const PROBE_TIMEOUT_MS = 5000;

/** 设置里留空时先按这个命令名找（交给系统按 `PATH` 解析，Windows 上会补 `.exe`） */
export const PNGQUANT_COMMAND = 'pngquant';

/** 一次探测的结果：真正能用的那个可执行文件 + 它自己报的版本 */
export interface PngquantProbeResult {
	path: string;
	version: string;
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
 * 设置里留空时，按顺序试哪些可执行文件。
 *
 * 第一条是裸命令名（交给系统按 `PATH` 找，最"正统"：用户装在哪就用哪）。
 * 后面几条是常见安装位置 —— **只在文件真的存在时才列出来**，为的是"刚装完 pngquant、
 * Obsidian 还没重启、进程里那份 PATH 还是旧的"这种情况：不重启也能用上。
 *
 * @param configured 设置里填的路径（非空时只用它，不再猜）
 * @param platform `process.platform`（测试里直接给值）
 * @param env 取环境变量用
 * @param exists 判断文件在不在（默认 `fs.existsSync`；测试里换成替身）
 */
export function pngquantCandidates(
	configured: string,
	platform: string = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	exists: (path: string) => boolean = existsSync
): string[] {
	const trimmed = configured.trim();
	if (trimmed !== '') return [trimmed];

	// Windows：%LOCALAPPDATA%\Programs\pngquant（本机给用户装的位置）、choco、scoop、winget 的链接目录
	const win = [
		env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Programs\\pngquant\\pngquant.exe` : '',
		env.ProgramData ? `${env.ProgramData}\\chocolatey\\bin\\pngquant.exe` : '',
		env.USERPROFILE ? `${env.USERPROFILE}\\scoop\\shims\\pngquant.exe` : '',
		env.LOCALAPPDATA ? `${env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\pngquant.exe` : '',
	];
	const mac = ['/opt/homebrew/bin/pngquant', '/usr/local/bin/pngquant', '/opt/local/bin/pngquant'];
	const linux = ['/usr/bin/pngquant', '/usr/local/bin/pngquant', '/snap/bin/pngquant'];

	const fallbacks = platform === 'win32' ? win
		: platform === 'darwin' ? mac
			: platform === 'linux' ? linux
				: [];

	return [PNGQUANT_COMMAND, ...fallbacks.filter(path => path !== '' && exists(path))];
}

/** 探测一次「系统里到底有没有可用的 pngquant」（`--version` 有回话就算找到） */
export type PngquantProbe = (configured: string) => Promise<PngquantProbeResult | null>;

/**
 * 真正去跑一次 `--version`：按候选顺序试，第一个有回话的算数。
 *
 * 只在"要动手之前"问一次（命令 / 整理图片各问一次），不是每张图都问 ——
 * 每张都探测等于每张多起一个进程。
 */
const realProbe: PngquantProbe = async (configured) => {
	for (const candidate of pngquantCandidates(configured)) {
		const result = await probeOne(candidate);
		if (result) return result;
	}
	return null;
};

/** 探测替身（测试用）：`null` 恢复成真探测 */
let activeProbe: PngquantProbe = realProbe;

/** 换掉探测实现（测试里用它避免真去起进程） */
export function setPngquantProbe(probe: PngquantProbe | null): void {
	activeProbe = probe ?? realProbe;
}

/**
 * 探测一次并把结果记下来：`runPngquant` 之后就用记下来的那个路径（不必每张图重找一遍）。
 *
 * 记在**这一层**（而不是各探测实现里）是刻意的：测试换掉探测实现时，缓存行为与真跑时一样。
 */
export async function probePngquant(configured = ''): Promise<PngquantProbeResult | null> {
	const key = configured.trim();
	const result = await activeProbe(configured);
	if (result) resolvedExecutables.set(key, result.path);
	else resolvedExecutables.delete(key);
	return result;
}

/** `设置里的路径` → 探测到的实际可执行文件（`''` 表示"系统里那份"） */
const resolvedExecutables = new Map<string, string>();

/** 已经警告过的可执行文件：一批图共用一句提示，别每张刷一条 */
const warned = new Set<string>();

/** 这一次要用哪个可执行文件：填了就用填的，留空用探测到的，没探测过就先按裸命令名试 */
export function resolvePngquantExecutable(configured: string): string {
	const trimmed = configured.trim();
	if (trimmed !== '') return trimmed;
	return resolvedExecutables.get('') ?? PNGQUANT_COMMAND;
}

/**
 * 执行 pngquant：把 `bytes` 从 stdin 喂进去，从 stdout 收结果。
 *
 * @param settings 可执行文件路径 + 质量档
 * @param bytes 待压缩的 PNG 字节
 * @param args 覆盖命令行参数（**只有测试用**：换成 `['-e', 脚本]` 跑一个假 pngquant）
 * @returns 压缩后的 PNG 字节；找不到可执行文件 / 非零退出 / 输出为空 / 输出不是 PNG 时 `null`
 */
export const runPngquant: PngquantRunner = async (settings, bytes, args) => {
	// 填了路径就用填的；留空＝用系统里那份（探测过就用探测到的，没探测过先按裸命令名交给 PATH）
	const executable = resolvePngquantExecutable(settings.path);
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
			warnOnce(executable, '⚠️ 没找到 pngquant（装一个，或在设置里填它的完整路径），按原格式处理这些图', err);
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

/** 同一个可执行文件只唠叨一次：一批几十张图共用一句提示，别把控制台刷满 */
function warnOnce(executable: string, message: string, err: unknown): void {
	if (warned.has(executable)) return;
	warned.add(executable);
	console.error(`${message}（${executable}）`, err);
}

/**
 * 跑一次 `<候选> --version`：能起来、退出码 0、stdout 有内容才算找到。
 *
 * 超时兜底 5 秒（进程卡住时别把整批拖死）；计时器 `unref()`，不挡着进程退出（测试里尤其重要）。
 */
async function probeOne(executable: string): Promise<PngquantProbeResult | null> {
	return await new Promise<PngquantProbeResult | null>((resolve) => {
		let child;
		try {
			child = spawn(executable, ['--version'], { windowsHide: true });
		} catch {
			resolve(null);
			return;
		}

		let output = '';
		let settled = false;
		const finish = (result: PngquantProbeResult | null): void => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timer);
			resolve(result);
		};
		// 用 `window.` 前缀是插件里的统一写法（弹窗窗口兼容性，lint 规则也要求）；
		// 测试那边（Node 里没有 window）自己装一个只有这两个方法的替身
		const timer = window.setTimeout(() => {
			try { child.kill(); } catch { /* 已经退了 */ }
			finish(null);
		}, PROBE_TIMEOUT_MS);
		(timer as { unref?: () => void }).unref?.();

		child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
		child.stderr?.on('data', () => { /* 版本信息有的版本往 stderr 写，不看它 */ });
		child.on('error', () => finish(null));
		child.on('close', (code) => {
			const version = output.trim().split('\n')[0]?.trim() ?? '';
			finish(code === 0 && version !== '' ? { path: executable, version } : null);
		});
	});
}
