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
 * ## 为什么脚本内容必须**一个字节都不变**
 *
 * 这是本模块唯一不能忘的一条。Windows Defender 把"脚本里写剪贴板"当成可疑行为，
 * **每一份新脚本内容**都要送到云端判一次，判不出结果就干等到 10 秒超时（本机实测）：
 *
 * - 同一份内容第二次起 0.28 秒（判过的结论按**内容**缓存，2026-11 实测）；
 * - 换个文件名但字节一样，照样 0.28 秒 —— 缓存认的是内容，不是路径；
 * - 同样的脚本只把"写剪贴板"那行去掉，第一次执行就 0.28 秒（`SetDataObject` 就是那个触发点）。
 *
 * 老写法把图片路径以 base64 写进脚本正文，于是**每复制一张图都产生一份新内容**，
 * 每次都等满 10 秒（最初以为是命令行变化，改成固定 `-File` 路径后依旧 10 秒，原因在正文）。
 *
 * 所以现在：
 *
 * 1. **脚本是常量**（`clipboardWorkerScript()`，不接任何参数），写到固定路径，
 *    内容没变就不重写；它不含任何用户内容，不用删。第一次执行完之后系统就认这份字节了；
 * 2. **用户内容全部走旁边的数据文件**：这次要复制哪些图 / HTML / 纯文本由
 *    `note-tidy-clipboard.json`、`.html`、`.txt` 三个固定名文件送进去（路径经 `-PayloadPath`
 *    参数传入，命令行因此也恒定），执行完即删；
 * 3. **插件加载时先空执行一次**（`prewarmClipboard`）：万一系统把结论作废了（换了病毒库），
 *    那 10 秒也发生在后台，用户点「复制图片」时不再等。
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
 * 那是另一种诉求：QQ / 微信 里要贴出**图文混排**。这时写 HTML（CF_HTML）+ 纯文本，
 * 而且**一份位图都不放** —— 剪贴板里只要有位图，微信 / 企业微信 就直接走位图那条路，
 * 不再解析 HTML，贴出来只剩一张图。拼 HTML 的规矩见 `rich-copy.ts`；
 * 写剪贴板的方式换成 Win32 原生接口（.NET 会改字节、顺序也不受控，理由见脚本里的注释）。
 * 纯图片（选区里没文字）仍然走文件列表那条路，行为不变：文件夹里能粘出文件。
 *
 * ## 路径怎么进数据文件
 *
 * 路径一律编成 base64：文件名里的 `'`、反引号、换行、emoji 都伤不到 PowerShell，
 * 也不需要管 JSON 转义。
 *
 * ## 平台
 *
 * 两条规矩只在 Windows 上成立：macOS 的 `osascript` 一次只能 `set the clipboard to` 一样东西，
 * 混排在那边退化成"只放文件"，也没有上面的 10 秒问题。
 */

/** 工作脚本写哪儿：**路径固定**，内容恒定（见文件头） */
function fixedScriptPath(): string {
	return path.join(os.tmpdir(), 'note-tidy-clipboard.ps1');
}

/** 这次的参数写哪儿：固定名，执行完即删 */
function fixedPayloadPath(): string {
	return path.join(os.tmpdir(), 'note-tidy-clipboard.json');
}

/**
 * 图文混排的原文写哪儿。
 *
 * 名字硬编码在脚本里（`note-tidy-clipboard.html`），这里按同一个目录拼出来 —— 改名字要两边一起改。
 * 不套 base64 直接落盘：选区一大段文字时 HTML 可能有几兆，套 base64 要多背 1/3 体积。
 */
function fixedHtmlPath(): string {
	return path.join(os.tmpdir(), 'note-tidy-clipboard.html');
}

/** 纯文本写哪儿（同上，混排时才写） */
function fixedTextPath(): string {
	return path.join(os.tmpdir(), 'note-tidy-clipboard.txt');
}

/** 要执行的命令（纯数据，方便单测；真正执行起来在 `copyOnce`） */
export interface ClipboardCommand {
	file: string;
	args: string[];
	/**
	 * Windows 下始终有：**内容恒定**的工作脚本，默认路径固定，内容没变就不重写。
	 * 不含用户内容，所以不用删（删了也不会退化成 10 秒，见文件头）。
	 */
	scriptFile?: { path: string; content: string };
	/** Windows 下始终有：这次复制的东西（用户内容全在这里），执行完删掉 */
	payloadFile?: {
		path: string;
		/** 模式与图片路径（base64）的 JSON */
		json: string;
		/** 图文混排的 HTML（没有就 null） */
		html: string | null;
		/** 图文混排的纯文本（没有就 null） */
		text: string | null;
	};
}

/**
 * 图文混排那一份：选区里既有文字又有图片时，除文件列表外再写这两种格式。
 *
 * 只给"能解析富文本"的程序看（QQ / 微信 / 企业微信 / Word）；
 * 顺序上 HTML 排在最前面（见脚本里的注释）。
 */
export interface RichClipboardContent {
	/** 纯文本形态（CF_UNICODETEXT）：选区原文 */
	text: string;
	/** HTML 形态（CF_HTML，UTF-8）：文字 + `<img>`，拼法见 `rich-copy.ts` */
	html: string;
}

/** 当前系统没有可用办法时的提示 */
export const CLIPBOARD_UNSUPPORTED = '当前系统还不支持把图片复制为文件（目前支持 Windows 与 macOS）。';

/** 这次的参数（写进 JSON 交给工作脚本，不含用户可读文本 —— 路径与位图都是 base64） */
export interface ClipboardPayload {
	/** `files` 写文件列表，`rich` 写 HTML + 纯文本，`noop` 什么都不做（预热用） */
	mode: 'files' | 'rich' | 'noop';
	/** 要放进剪贴板的文件（绝对路径的 base64） */
	files: string[];
	/** 同时作为位图放进剪贴板的那张图（绝对路径的 base64）；空串表示不放 */
	bitmap: string;
}

/** 文件路径 → base64（UTF-8）：脚本里再解回来，任何字符都伤不到 PowerShell */
export function encodePath(filePath: string): string {
	return Buffer.from(filePath, 'utf8').toString('base64');
}

/**
 * 这次复制的参数（纯函数）。
 *
 * @param paths 要放进剪贴板的文件（绝对路径），至少一个
 * @param bitmapPath 同时作为位图放进剪贴板的那张图；`null` 表示不放（多张时没法只放一张）
 * @param rich 图文混排那份；给了它就不放位图 —— 剪贴板里只要有 CF_BITMAP，
 *             微信 / 企业微信 就不再解析 HTML，贴出来只剩一张图
 */
export function buildClipboardPayload(
	paths: string[],
	bitmapPath: string | null,
	rich: RichClipboardContent | null = null
): ClipboardPayload {
	return {
		mode: rich === null ? 'files' : 'rich',
		files: paths.map(filePath => encodePath(filePath)),
		// 混排时一律不放位图：剪贴板里只要有 CF_BITMAP，微信 / 企业微信 就不再解析 HTML
		bitmap: rich !== null || bitmapPath === null ? '' : encodePath(bitmapPath),
	};
}

/** 预热用的参数：脚本自己 `exit`，什么都不碰 */
export const PREWARM_PAYLOAD: ClipboardPayload = { mode: 'noop', files: [], bitmap: '' };

/**
 * Windows 的工作脚本：**内容恒定**，用户要复制什么全从旁边的数据文件读。
 *
 * 写成一串字面量再 `join`，是为了让每行在文件里的列位置与这里一致 ——
 * C# 那段用的是 `@'…'@` here-string，`'@` 必须顶在行首。
 *
 * 改这个字符串 = 换一份新内容 = 下一次复制要重新等一次 10 秒（预热会替用户等掉）。
 * 因此只能改"非改不可"的地方，不要把变量写进来。
 */
export function clipboardWorkerScript(): string {
	return [
		'param([string]$PayloadPath)',
		"$ErrorActionPreference = 'Stop'",
		'# 这次要复制什么由插件写在 $PayloadPath 指向的文件里：脚本本身永远同一份字节，',
		'# 否则 Windows 每见到一份新脚本内容都要送云端判一次，一等就是 10 秒（见 clipboard.ts 文件头）',
		'$payload = [IO.File]::ReadAllText($PayloadPath, [Text.Encoding]::UTF8) | ConvertFrom-Json',
		"if ($payload.mode -eq 'noop') { exit 0 }",
		'$baseDir = [IO.Path]::GetDirectoryName($PayloadPath)',
		'function ConvertFrom-Base64Text([string]$encoded) {',
		"	if ([string]::IsNullOrEmpty($encoded)) { return '' }",
		'	return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))',
		'}',
		"if ($payload.mode -eq 'rich') {",
		"	Add-Type -TypeDefinition @'",
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
		'	# GMEM_MOVEABLE：剪贴板只收可移动内存块（写完之后内存归系统，不用我们释放）',
		'	$GMEM_MOVEABLE = 0x0002',
		'	function Set-ClipboardBytes([uint32]$format, [byte[]]$bytes) {',
		'		$handle = [NoteTidyClip]::GlobalAlloc($GMEM_MOVEABLE, [UIntPtr]::new([uint64]$bytes.Length))',
		'		if ($handle -eq [IntPtr]::Zero) { throw "分配剪贴板内存失败" }',
		'		$pointer = [NoteTidyClip]::GlobalLock($handle)',
		'		[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)',
		'		[NoteTidyClip]::GlobalUnlock($handle) | Out-Null',
		'		if ([NoteTidyClip]::SetClipboardData($format, $handle) -eq [IntPtr]::Zero) {',
		'			[NoteTidyClip]::GlobalFree($handle) | Out-Null',
		'			throw "写入剪贴板失败（格式 $format）"',
		'		}',
		'	}',
		"	$html = [IO.File]::ReadAllText([IO.Path]::Combine($baseDir, 'note-tidy-clipboard.html'), [Text.Encoding]::UTF8)",
		"	$text = [IO.File]::ReadAllText([IO.Path]::Combine($baseDir, 'note-tidy-clipboard.txt'), [Text.Encoding]::UTF8)",
		'	# 剪贴板被别的程序占着是常事（QQ / 浏览器都在盯着它）：整段"打开 → 清空 → 写入"重试 10 次。',
		'	# 只重试"打开"是不够的 —— 实测打开成功了，清空一样会报 1418（ERROR_CLIPBOARD_NOT_OPEN）。',
		'	$written = $false',
		'	for ($i = 0; $i -lt 10 -and -not $written; $i++) {',
		'		if ([NoteTidyClip]::OpenClipboard([IntPtr]::Zero)) {',
		'			try {',
		'				if ([NoteTidyClip]::EmptyClipboard()) {',
		'					# ① HTML：QQ / 微信 认了它才会贴出"文字 + 图片"，所以排在最前面',
		"					Set-ClipboardBytes ([NoteTidyClip]::RegisterClipboardFormat('HTML Format')) ([Text.Encoding]::UTF8.GetBytes($html + [char]0))",
		'					# ② 纯文本（CF_UNICODETEXT = 13）：记事本这类只认文本的程序也能贴',
		'					Set-ClipboardBytes 13 ([Text.Encoding]::Unicode.GetBytes($text + [char]0))',
		'					# 这里故意不放文件列表（CF_HDROP）：QQ / 微信 的粘贴处理是先看有没有文件，',
		'					# 有文件就直接当图片上传，那段文字根本不会出现（2026-09 用户实测）。',
		'					$written = $true',
		'				}',
		'			} catch {',
		'				# 这一轮没写成就等一会儿再试，别把半份内容留在剪贴板里',
		'			} finally {',
		'				[NoteTidyClip]::CloseClipboard() | Out-Null',
		'			}',
		'		}',
		'		if (-not $written) { Start-Sleep -Milliseconds 50 }',
		'	}',
		'	if (-not $written) { throw "写入剪贴板失败（重试 10 次仍被别的程序占着）" }',
		'	exit 0',
		'}',
		'Add-Type -AssemblyName System.Windows.Forms',
		'Add-Type -AssemblyName System.Drawing',
		'$paths = @()',
		'if ($payload.files) { $paths = @($payload.files | ForEach-Object { ConvertFrom-Base64Text $_ }) }',
		'$files = New-Object System.Collections.Specialized.StringCollection',
		'$files.AddRange([string[]]$paths)',
		'$data = New-Object System.Windows.Forms.DataObject',
		'$data.SetFileDropList($files)',
		'$bitmapPath = ConvertFrom-Base64Text $payload.bitmap',
		"if ($bitmapPath -ne '') {",
		'	# 再放一份位图：QQ / Word 这类只认图的程序也能直接贴（失败不影响文件那份）',
		'	try { $data.SetImage([System.Drawing.Image]::FromFile($bitmapPath)) } catch { }',
		'}',
		'# $true = 进程退出后剪贴板内容仍然有效（否则 powershell 一关就没了）；10/50 = 剪贴板被别的程序占着时重试',
		'[System.Windows.Forms.Clipboard]::SetDataObject($data, $true, 10, 50)',
	].join('\n');
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
 * Windows 上"执行工作脚本"的命令（纯函数）。命令行恒定：脚本路径与参数文件路径都固定。
 *
 * @param payload 这次要做什么
 * @param scriptPath 工作脚本路径（测试里可指定）
 * @param payloadPath 参数文件路径（测试里可指定）
 */
function workerCommand(
	payload: ClipboardPayload,
	scriptPath: string,
	payloadPath: string
): ClipboardCommand {
	return {
		file: 'powershell.exe',
		// -NoProfile 免得用户的 profile 拖慢或打断；-NonInteractive 不弹任何东西
		args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-PayloadPath', payloadPath],
		scriptFile: { path: scriptPath, content: clipboardWorkerScript() },
		payloadFile: {
			path: payloadPath,
			json: JSON.stringify(payload),
			html: null,
			text: null,
		},
	};
}

/**
 * 按平台给出要执行的命令（纯函数，方便单测）。
 *
 * `rich` 只在 Windows 上生效：macOS 的 `osascript` 写不了"多格式一次写入"
 * （`set the clipboard to` 一次只能放一样），那边仍旧只放文件。
 *
 * Windows 的脚本与命令行都恒定，用户内容全在参数文件里（见文件头）。
 *
 * @param scriptPath 工作脚本落地路径（测试里可指定；默认系统临时目录下的固定名）
 * @param payloadPath 参数文件路径（同上）
 * @returns 不认识的平台 / 没有文件时返回 null，调用方据此给提示
 */
export function clipboardCommandFor(
	platform: string,
	paths: string[],
	bitmapPath: string | null,
	rich: RichClipboardContent | null = null,
	scriptPath: string = fixedScriptPath(),
	payloadPath: string = fixedPayloadPath()
): ClipboardCommand | null {
	if (platform === 'win32') {
		if (paths.length === 0) return null;
		const command = workerCommand(buildClipboardPayload(paths, bitmapPath, rich), scriptPath, payloadPath);
		if (rich !== null && command.payloadFile) {
			command.payloadFile.html = rich.html;
			command.payloadFile.text = rich.text;
		}
		return command;
	}

	if (platform === 'darwin') {
		if (paths.length === 0) return null;
		return { file: 'osascript', args: ['-e', buildAppleScript(paths)] };
	}

	return null;
}

/** 执行一条命令（真正动剪贴板的那一步，不好单测，逻辑都在上面的纯函数里） */
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

/** 落盘文件必须带 BOM：Windows PowerShell 5.1 按 ANSI 读没有 BOM 的 .ps1，中文注释会变乱码 */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/**
 * 把工作脚本写到固定路径 —— **内容恒定，所以只在缺了或不一样时写**。
 *
 * 写一次之后就一直留着：它不含用户内容，重写反而多事（内容一样，系统照样认）。
 */
async function ensureScriptFile(file: { path: string; content: string }): Promise<void> {
	const body = Buffer.concat([BOM, Buffer.from(file.content, 'utf8')]);
	try {
		const current = await fs.readFile(file.path);
		if (current.equals(body)) return;
	} catch {
		// 文件不在 / 读不了：照写不误
	}
	await fs.writeFile(file.path, body);
}

/** 把这次的参数写给工作脚本；图文混排的原文单独落盘（见固定文件名的注释） */
async function writePayloadFile(file: NonNullable<ClipboardCommand['payloadFile']>): Promise<void> {
	await fs.writeFile(file.path, file.json, 'utf8');
	if (file.html !== null) await fs.writeFile(fixedHtmlPath(), file.html, 'utf8');
	if (file.text !== null) await fs.writeFile(fixedTextPath(), file.text, 'utf8');
}

/** 参数文件里有用户内容（选区原文），执行完就删；删不掉不影响这次复制 */
async function removePayloadFiles(): Promise<void> {
	await Promise.all(
		[fixedPayloadPath(), fixedHtmlPath(), fixedTextPath()].map(file =>
			fs.rm(file, { force: true }).catch(() => undefined)
		)
	);
}

/** 正在复制图片的笔数：粘贴处理器据此挡住"剪贴板里还是上一张"的那次粘贴 */
let copying = 0;

export function isCopyingImages(): boolean {
	return copying > 0;
}

/** 复制排队：参数文件是固定路径，同一时刻只能有一个写入者，避免两次复制互相覆盖 */
let queue: Promise<unknown> = Promise.resolve();

/** 排进同一条队列（前一笔失败不影响后一笔） */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(task, task);
	queue = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}

/**
 * 把图片文件复制进系统剪贴板。
 *
 * @param paths 图片的磁盘绝对路径
 * @param bitmapPath 同时作为位图放进剪贴板的那张图（只有一张时给，多张给 null）
 * @param platform 目标平台（默认当前平台）
 * @param rich 图文混排那份（选区里还有文字时给）；给了它就不放位图，见 `clipboardWorkerScript`
 * @throws 系统不支持、或系统命令执行失败时抛错（调用方负责提示）
 */
export function copyImageFiles(
	paths: string[],
	bitmapPath: string | null,
	platform: string = process.platform,
	rich: RichClipboardContent | null = null
): Promise<void> {
	copying += 1;
	return enqueue(() => copyOnce(paths, bitmapPath, platform, rich)).finally(() => {
		copying -= 1;
	});
}

/**
 * 插件加载后先在后台空执行一次工作脚本。
 *
 * 系统对**新脚本内容**的判定要 10 秒（见文件头），而那笔账不该算在用户第一次复制头上：
 * 这里先执行一次，把"这份字节已经判过"的结论放进系统缓存里。失败无所谓 —— 复制时还会再执行。
 */
export function prewarmClipboard(platform: string = process.platform): Promise<void> {
	if (platform !== 'win32') return Promise.resolve();
	return enqueue(async () => {
		const command = workerCommand(PREWARM_PAYLOAD, fixedScriptPath(), fixedPayloadPath());
		await execute(command);
	}).catch(() => undefined);
}

/** 写脚本 / 写参数 / 执行命令 / 删参数：一笔复制的全部动作 */
async function execute(command: ClipboardCommand): Promise<void> {
	try {
		if (command.scriptFile) await ensureScriptFile(command.scriptFile);
		if (command.payloadFile) await writePayloadFile(command.payloadFile);
		await runCommand(command);
	} finally {
		if (command.payloadFile) await removePayloadFiles();
	}
}

async function copyOnce(
	paths: string[],
	bitmapPath: string | null,
	platform: string,
	rich: RichClipboardContent | null
): Promise<void> {
	const command = clipboardCommandFor(platform, paths, bitmapPath, rich);
	if (!command) throw new Error(CLIPBOARD_UNSUPPORTED);
	await execute(command);
}
