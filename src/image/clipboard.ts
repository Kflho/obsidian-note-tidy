// 与仓库里其它模块一致，用不带 `node:` 前缀的写法（esbuild 的 external 列表按这个名字配的）
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * 把图片文件放进系统剪贴板 —— **复制之后能在文件夹里直接粘贴出文件**。
 *
 * ## 为什么要绕到系统命令去
 *
 * Electron / 网页的剪贴板 API 只能写"位图"（Windows 的 CF_DIB）：QQ、Word、微信
 * 这些只认图的程序贴得进去，资源管理器却不认 —— 粘贴出来什么都没有
 * （Image Toolkit 的复制图片就是这个毛病）。资源管理器认的是**文件拖放列表**
 * （CF_HDROP），而 Electron 没有暴露这个格式（`clipboard.write` 只支持
 * text / html / image / rtf / bookmark），所以只能请系统自带的工具代劳：
 *
 * - Windows：`powershell.exe` + WinForms 的 `DataObject` / `Clipboard.SetDataObject`；
 * - macOS：`osascript` 的 `POSIX file`（Finder 能粘出文件）。
 *
 * ## 为什么不只用 `Set-Clipboard -Path`
 *
 * 那个命令只写文件列表，把位图那份挤掉；我们要的是**一份剪贴板里两种格式都有**：
 * 资源管理器粘出文件、聊天窗口贴出图片。所以自己拼 DataObject。
 * 同理**纯图片时不写文本格式**：CF_UNICODETEXT 与 CF_HDROP 同时存在时，有些程序
 * （Windows Terminal 就修过这个 bug）会把内容粘两遍。
 *
 * ## 选区里既有文字又有图片时（`RichClipboardContent`）
 *
 * 那是另一种诉求：QQ / 微信 里要贴出**图文混排**。这时写 HTML（CF_HTML）+ 纯文本 + 文件列表，
 * 而且**一份位图都不放** —— 剪贴板里只要有位图，微信 / 企业微信 就直接走位图那条路，
 * 不再解析 HTML，贴出来只剩一张图。拼 HTML 的规矩见 `rich-copy.ts`；
 * 写剪贴板的方式换成 Win32 原生接口（.NET 会改字节、顺序也不受控，理由见 `buildRichScript`）。
 * 纯图片（选区里没文字）仍然走上面那条路，行为不变：文件夹里能粘出文件。
 *
 * ## 路径怎么进脚本
 *
 * 一律编成 base64 由脚本自己解码：文件名里的 `'`、反引号、换行、emoji 都伤不到
 * PowerShell；整段脚本再经 `-EncodedCommand` 传进去，命令行上不出现任何用户内容
 * （既避免转义问题，也避免文件名被当成命令执行）。`-EncodedCommand` 要 UTF-16LE。
 *
 * 不过 **Windows 一条命令行最多 32767 个字符**（CreateProcess 的限制），而 `-EncodedCommand`
 * 里那串 base64 是脚本的两倍多（UTF-16LE 再 base64）。选区里文字一多（HTML 里带着整段正文），
 * 就会顶到这个上限 —— 那时改成把脚本**落到临时文件**、用 `-File` 执行（见 `COMMAND_LINE_LIMIT`）。
 */

/** 要执行的命令（纯数据，方便单测；真正跑起来在 copyImageFiles） */
export interface ClipboardCommand {
	file: string;
	args: string[];
	/**
	 * 命令行装不下时（见 `COMMAND_LINE_LIMIT`）：脚本改走这个文件，调用方负责写与删。
	 * 内容与 `-EncodedCommand` 那条路完全一样，只是为了不撞 Windows 的命令行长度上限。
	 */
	scriptFile?: { path: string; content: string };
}

/**
 * Windows 一条命令行能有多长（CreateProcess 的硬限制是 32767）。
 *
 * 留一点余量：可执行文件路径、参数引号都要占地方。
 */
export const COMMAND_LINE_LIMIT = 30_000;

/**
 * 图文混排那一份：选区里既有文字又有图片时，除文件列表外再写这两种格式。
 *
 * 只给"能解析富文本"的程序看（QQ / 微信 / 企业微信 / Word）；
 * 顺序上 HTML 排在最前面（见 `buildPowerShellScript`）。
 */
export interface RichClipboardContent {
	/** 纯文本形态（CF_UNICODETEXT）：选区原文 */
	text: string;
	/** HTML 形态（CF_HTML，UTF-8）：文字 + `<img>`，拼法见 `rich-copy.ts` */
	html: string;
}

/** 当前系统没有可用办法时的提示 */
export const CLIPBOARD_UNSUPPORTED = '当前系统还不支持把图片复制为文件（目前支持 Windows 与 macOS）。';

/** 路径编成 base64（UTF-8）：脚本正文里只出现 base64 字面量 */
function decodeExpression(filePath: string): string {
	const encoded = Buffer.from(filePath, 'utf8').toString('base64');
	return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`;
}

/** 任意文本编成 base64（UTF-8）再在脚本里解回来 —— 文本同样不进脚本正文 */
function textExpression(value: string): string {
	const encoded = Buffer.from(value, 'utf8').toString('base64');
	return `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`;
}

/**
 * 生成 Windows 用的 PowerShell 脚本（纯函数）。
 *
 * 两种写法：
 * - **纯图片**走 WinForms 的 `DataObject`（`buildFileScript`）：文件列表 + 单张时的位图；
 * - **图文混排**走 Win32 原生接口（`buildRichScript`）：`.NET` 会自作主张（见那边的注释）。
 *
 * @param paths 要放进剪贴板的文件（绝对路径），至少一个
 * @param bitmapPath 同时作为位图放进剪贴板的那张图；`null` 表示不放（多张时没法只放一张）
 * @param rich 图文混排那份（HTML + 纯文本）；给了它就不放位图 ——
 *             剪贴板里只要有 CF_BITMAP，微信 / 企业微信 就不再解析 HTML，贴出来只剩一张图
 */
export function buildPowerShellScript(
	paths: string[],
	bitmapPath: string | null,
	rich: RichClipboardContent | null = null
): string {
	return rich === null ? buildFileScript(paths, bitmapPath) : buildRichScript(rich);
}

/** 纯图片：WinForms DataObject 一次写文件列表（+ 单张时的位图） */
function buildFileScript(paths: string[], bitmapPath: string | null): string {
	const lines: string[] = [
		"$ErrorActionPreference = 'Stop'",
		'Add-Type -AssemblyName System.Windows.Forms',
		'Add-Type -AssemblyName System.Drawing',
		'$paths = @(',
		...paths.map(filePath => `\t${decodeExpression(filePath)}`),
		')',
		'$files = New-Object System.Collections.Specialized.StringCollection',
		'$files.AddRange([string[]]$paths)',
		'$data = New-Object System.Windows.Forms.DataObject',
		'$data.SetFileDropList($files)',
	];

	if (bitmapPath !== null) {
		lines.push(
			'# 再放一份位图：QQ / Word 这类只认图的程序也能直接贴（失败不影响文件那份）',
			'try {',
			`\t$data.SetImage([System.Drawing.Image]::FromFile(${decodeExpression(bitmapPath)}))`,
			'} catch { }'
		);
	}

	lines.push(
		'# $true = 进程退出后剪贴板内容仍然有效（否则 powershell 一关就没了）；10/50 = 剪贴板被别的程序占着时重试',
		'[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 50)'
	);

	return lines.join('\n');
}

/**
 * 图文混排：自己调 Win32 的 `SetClipboardData`，一样一样按顺序写。
 *
 * 写下去的是 **HTML + 纯文本**，**没有文件列表**：QQ / 微信 的粘贴处理是先看剪贴板里有没有文件，
 * 有文件就直接当图片上传、不再看 HTML（本机实测：只放文件列表时 QQ 贴出来只有图片、没有文字）。
 *
 * **为什么不接着用 DataObject**（2026-09 本机实测，两条都是坑）：
 * 1. `SetData('HTML Format', $false, [byte[]]…)` 写进去的不是字节，而是 `ToString()` 出来的
 *    字符串 `"System.Byte[]"` —— 中文更是直接丢；.NET 把"HTML Format"当文本格式，会自己转换；
 * 2. 格式的**顺序不听我们的**：明明先 `SetData` 的 HTML，落到剪贴板上却是
 *    `CF_HDROP → FileNameW → HTML Format → CF_UNICODETEXT`。而社区里的实测结论是
 *    "顺序会决定 QQ / 微信 挑哪一份解析"（贴出来是问号、不出图，多半就出在顺序与编码上）。
 *
 * 自己写还有个好处：CF_HTML 是**字节流**，偏移量按 UTF-8 字节算，我们能保证写下去的就是
 * 拼好的那一串（末尾补 NUL，微软的规范要求）。
 */
function buildRichScript(rich: RichClipboardContent): string {
	return [
		"$ErrorActionPreference = 'Stop'",
		'Add-Type -TypeDefinition @\'',
		'using System;',
		'using System.Runtime.InteropServices;',
		'public class NoteTidyClip {',
		'  [DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr hWndNewOwner);',
		'  [DllImport("user32.dll", SetLastError = true)] public static extern bool EmptyClipboard();',
		'  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);',
		'  [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();',
		'  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint RegisterClipboardFormat(string lpszFormat);',
		'  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);',
		'  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalLock(IntPtr hMem);',
		'  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GlobalUnlock(IntPtr hMem);',
		'  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr GlobalFree(IntPtr hMem);',
		'}',
		"'@",
		'# GMEM_MOVEABLE：剪贴板只收可移动内存块（写完之后内存归系统，不用我们释放）',
		'$GMEM_MOVEABLE = 0x0002',
		'function Set-ClipboardBytes([uint32]$format, [byte[]]$bytes) {',
		'  $handle = [NoteTidyClip]::GlobalAlloc($GMEM_MOVEABLE, [UIntPtr]::new([uint64]$bytes.Length))',
		'  if ($handle -eq [IntPtr]::Zero) { throw "分配剪贴板内存失败" }',
		'  $pointer = [NoteTidyClip]::GlobalLock($handle)',
		'  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)',
		'  [NoteTidyClip]::GlobalUnlock($handle) | Out-Null',
		'  if ([NoteTidyClip]::SetClipboardData($format, $handle) -eq [IntPtr]::Zero) {',
		'    [NoteTidyClip]::GlobalFree($handle) | Out-Null',
		'    throw "写入剪贴板失败（格式 $format）"',
		'  }',
		'}',
		`$html = ${textExpression(rich.html)}`,
		`$text = ${textExpression(rich.text)}`,
		'# 剪贴板被别的程序占着是常事：重试 10 次再放弃',
		'for ($i = 0; $i -lt 10 -and -not [NoteTidyClip]::OpenClipboard([IntPtr]::Zero); $i++) { Start-Sleep -Milliseconds 50 }',
		'if (-not [NoteTidyClip]::EmptyClipboard()) { throw "清空剪贴板失败" }',
		'try {',
		'\t# ① HTML：QQ / 微信 认了它才会贴出"文字 + 图片"，所以排在最前面',
		"\tSet-ClipboardBytes ([NoteTidyClip]::RegisterClipboardFormat('HTML Format')) ([Text.Encoding]::UTF8.GetBytes($html + [char]0))",
		'\t# ② 纯文本（CF_UNICODETEXT = 13）：记事本这类只认文本的程序也能贴',
		'\tSet-ClipboardBytes 13 ([Text.Encoding]::Unicode.GetBytes($text + [char]0))',
		'\t# 这里**故意不放文件列表**（CF_HDROP）：QQ / 微信 的粘贴处理是先看有没有文件，',
		'\t# 有文件就直接当图片上传，那段文字根本不会出现（2026-09 用户实测）。',
		'} finally {',
		'\t[NoteTidyClip]::CloseClipboard() | Out-Null',
		'}',
	].join('\n');
}

/** 把脚本编成 `-EncodedCommand` 要的 base64（UTF-16LE） */
export function encodePowerShellCommand(script: string): string {
	return Buffer.from(script, 'utf16le').toString('base64');
}

/** AppleScript 字符串字面量里的转义：反斜杠与双引号 */
function escapeAppleScript(filePath: string): string {
	return filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 生成 macOS 用的 AppleScript（纯函数）。
 * 多个文件写成列表，Finder 里粘贴出来就是多个文件。
 */
export function buildAppleScript(paths: string[]): string {
	const files = paths.map(filePath => `(POSIX file "${escapeAppleScript(filePath)}")`);
	return files.length === 1
		? `set the clipboard to ${files[0]}`
		: `set the clipboard to {${files.join(', ')}}`;
}

/**
 * 按平台给出要执行的命令（纯函数，方便单测）。
 *
 * `rich` 只在 Windows 上生效：macOS 的 `osascript` 写不了"多格式一次写入"
 * （`set the clipboard to` 一次只能放一样），那边仍旧只放文件。
 *
 * @param tempScriptPath 装不下时脚本要落的临时文件路径（调用方给，写与删也归它）；
 *                       传 null 表示只能走命令行（比如编辑器里选了一大段文字 + 图片时会顶到上限）
 * @returns 不认识的平台 / 没有文件时返回 null，调用方据此给提示
 */
export function clipboardCommandFor(
	platform: string,
	paths: string[],
	bitmapPath: string | null,
	rich: RichClipboardContent | null = null,
	tempScriptPath: string | null = null
): ClipboardCommand | null {
	if (paths.length === 0) return null;

	if (platform === 'win32') {
		const script = buildPowerShellScript(paths, bitmapPath, rich);
		// -NoProfile 免得用户的 profile 拖慢或打断；-NonInteractive 不弹任何东西
		const head = ['-NoProfile', '-NonInteractive'];
		const encoded = ['-EncodedCommand', encodePowerShellCommand(script)];

		if (tempScriptPath !== null && [...head, ...encoded].join(' ').length > COMMAND_LINE_LIMIT) {
			// 选区里文字多的时候，光 base64 就能把命令行撑爆 —— 落盘最稳
			return {
				file: 'powershell.exe',
				args: [...head, '-ExecutionPolicy', 'Bypass', '-File', tempScriptPath],
				scriptFile: { path: tempScriptPath, content: script },
			};
		}

		return { file: 'powershell.exe', args: [...head, ...encoded] };
	}

	if (platform === 'darwin') {
		return { file: 'osascript', args: ['-e', buildAppleScript(paths)] };
	}

	return null;
}

/** 跑一条命令（真正动剪贴板的那一步，不好单测，逻辑都在上面的纯函数里） */
function runCommand(command: ClipboardCommand): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		execFile(command.file, command.args, { windowsHide: true }, (error, _stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve();
		});
	});
}

/** 临时脚本放哪儿：系统临时目录 + 随机名（同名并发不会撞车） */
function tempScriptPath(): string {
	const name = `note-tidy-clipboard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.ps1`;
	return path.join(os.tmpdir(), name);
}

/**
 * 把图片文件复制进系统剪贴板。
 *
 * @param paths 图片的磁盘绝对路径
 * @param bitmapPath 同时作为位图放进剪贴板的那张图（只有一张时给，多张给 null）
 * @param platform 目标平台（默认当前平台）
 * @param rich 图文混排那份（选区里还有文字时给）；给了它就不放位图，见 `buildPowerShellScript`
 * @throws 系统不支持、或系统命令执行失败时抛错（调用方负责提示）
 */
export async function copyImageFiles(
	paths: string[],
	bitmapPath: string | null,
	platform: string = process.platform,
	rich: RichClipboardContent | null = null
): Promise<void> {
	const command = clipboardCommandFor(platform, paths, bitmapPath, rich, tempScriptPath());
	if (!command) throw new Error(CLIPBOARD_UNSUPPORTED);

	try {
		if (command.scriptFile) {
			// BOM 不能少：Windows PowerShell 5.1 按 ANSI 读没有 BOM 的 .ps1，脚本里的中文注释会变乱码
			const bom = Buffer.from([0xef, 0xbb, 0xbf]);
			await fs.writeFile(command.scriptFile.path, Buffer.concat([bom, Buffer.from(command.scriptFile.content, 'utf8')]));
		}
		await runCommand(command);
	} finally {
		if (command.scriptFile) {
			// 临时脚本里有选区原文，用完就删（删不掉也不影响这次复制）
			await fs.rm(command.scriptFile.path, { force: true }).catch(() => undefined);
		}
	}
}
