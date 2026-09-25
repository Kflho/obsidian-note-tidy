/**
 * 复制图片到系统剪贴板（`src/image/clipboard.ts`）的纯函数测试
 *
 * 运行：npm test
 *
 * 真正动剪贴板的那一步（spawn powershell / osascript）没法在 Node 里验，
 * 所以模块把"要执行什么"全部做成纯函数，这里逐条盯住：
 *   1. Windows 脚本写了文件拖放列表（资源管理器能粘出文件）——这是本功能存在的理由
 *   2. 单张时另外放一份位图（QQ / Word 能直接贴），多张时不放
 *   3. **路径不进命令行**：一律 base64 进脚本，文件名里的引号 / 反引号 / 换行伤不到 PowerShell
 *   4. -EncodedCommand 用 UTF-16LE（PowerShell 只认这个），能原样还原脚本
 *   5. macOS 用 osascript 的 POSIX file，多文件写成列表；不认识的平台返回 null
 *   6. 选区里有文字时（图文混排）：写 HTML + 纯文本 + 文件列表，**HTML 排最前、不放位图** ——
 *      顺序决定 QQ / 微信 挑哪一份，有位图它们就不解析 HTML 了
 */
import {
	COMMAND_LINE_LIMIT,
	buildAppleScript,
	buildPowerShellScript,
	clipboardCommandFor,
	encodePowerShellCommand,
} from "../src/image/clipboard";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function checkEqual(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail: string): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n  ${detail}`);
}

function contains(haystack: string, needle: string): boolean {
	return haystack.includes(needle);
}

/** 解码脚本里那段 base64，确认路径能原样还原 */
function decodeLast(script: string, index = 0): string {
	const matches = script.match(/FromBase64String\('([^']*)'\)/g) ?? [];
	const target = matches[index] ?? "";
	const base64 = /FromBase64String\('([^']*)'\)/.exec(target)?.[1] ?? "";
	return Buffer.from(base64, "base64").toString("utf8");
}

// --------------------------------------------------------- 1. Windows 脚本
function powerShellScriptTests(): void {
	const one = "/vault/附件/图.png";
	const script = buildPowerShellScript([one], one);

	checkTrue("加载了 WinForms", contains(script, "Add-Type -AssemblyName System.Windows.Forms"), script);
	checkTrue("写的是文件拖放列表", contains(script, "$data.SetFileDropList($files)"), script);
	checkTrue("SetDataObject 带 $true（进程退出后仍有效）", contains(script, "SetDataObject($data, $true"), script);
	checkTrue("单张时放位图", contains(script, "$data.SetImage("), script);
	checkTrue("位图失败不影响文件那份", contains(script, "} catch { }"), script);
	checkTrue("路径不进脚本正文", !contains(script, one), script);
	checkEqual("base64 能还原路径", decodeLast(script), one);
	checkEqual("位图那张也能还原", decodeLast(script, 1), one);

	// 多张：文件列表里有几张就列几张，但不放位图（一张没法代表全部）
	const many = ["/a/1.png", "/a/2.jpg"];
	const multi = buildPowerShellScript(many, null);
	checkEqual("两条路径都在", [decodeLast(multi, 0), decodeLast(multi, 1)], many);
	checkTrue("多张时不放位图", !contains(multi, "SetImage"), multi);

	// 文件名里的危险字符：单引号、反引号、换行、$、emoji
	const nasty = "/vault/it's `dangerous` $(calc)\n图.png";
	const nastyScript = buildPowerShellScript([nasty], null);
	checkTrue("危险文件名不进正文", !contains(nastyScript, "dangerous") && !contains(nastyScript, "$(calc)"), nastyScript);
	checkEqual("危险文件名照样能还原", decodeLast(nastyScript), nasty);
	checkTrue("脚本行数固定（注入换行也改不了结构）", nastyScript.split("\n").length === buildPowerShellScript(["/x.png"], null).split("\n").length,
		`${nastyScript.split("\n").length} 行`);
}

// --------------------------------------------------- 2. -EncodedCommand
function encodedCommandTests(): void {
	const script = buildPowerShellScript(["/a/图.png"], "/a/图.png");
	const encoded = encodePowerShellCommand(script);

	checkEqual("能原样还原（UTF-16LE）", Buffer.from(encoded, "base64").toString("utf16le"), script);
	checkTrue("是 base64（只含合法字符）", /^[A-Za-z0-9+/=]+$/.test(encoded), encoded.slice(0, 40));
}

// ---------------------------------------------------------- 3. 平台分发
function commandTests(): void {
	const win = clipboardCommandFor("win32", ["/a/图.png"], "/a/图.png");
	checkEqual("Windows 用 powershell.exe", win?.file, "powershell.exe");
	checkTrue("Windows 走 -EncodedCommand", win?.args.includes("-EncodedCommand") === true && win?.args.includes("-NoProfile") === true,
		JSON.stringify(win?.args.slice(0, 3)));

	const winScript = Buffer.from(win?.args[win.args.length - 1] ?? "", "base64").toString("utf16le");
	checkTrue("命令行里没有原始路径", !contains(winScript, "/a/图.png") && !contains(JSON.stringify(win?.args), "/a/图.png"),
		JSON.stringify(win?.args).slice(0, 80));
	checkEqual("解码后脚本里有这张图", decodeLast(winScript), "/a/图.png");

	const mac = clipboardCommandFor("darwin", ["/a/图.png"], null);
	checkEqual("macOS 用 osascript", mac?.file, "osascript");
	checkEqual("macOS 脚本", mac?.args[1], 'set the clipboard to (POSIX file "/a/图.png")');

	checkEqual("没有文件时不执行", clipboardCommandFor("win32", [], null), null);
	checkEqual("不认识的平台返回 null", clipboardCommandFor("linux", ["/a/图.png"], null), null);
}

// ------------------------------------------------- 1b. 图文混排那一份
function richScriptTests(): void {
	const rich = { text: "看这张 ![[图.png]] 好看", html: "Version:0.9\r\nStartHTML:0000000105\r\n<html><body><!--StartFragment-->看这张 <img src=\"file:///D:/%E5%9B%BE.png\"> 好看<!--EndFragment--></body></html>" };
	const script = buildPowerShellScript(["/vault/图.png"], "/vault/图.png", rich);

	// .NET 会把 byte[] 变成字符串 "System.Byte[]"、格式顺序也自己排，所以混排这份自己调 Win32
	checkTrue("自己调 OpenClipboard / EmptyClipboard", contains(script, "[NoteTidyClip]::EmptyClipboard()"), script);
	checkTrue("先清空再写（否则旧格式还在）", script.indexOf("EmptyClipboard") < script.indexOf("Set-ClipboardBytes"), script);
	checkTrue("HTML 按 UTF-8 字节写（末尾补 NUL）",
		contains(script, "([Text.Encoding]::UTF8.GetBytes($html + [char]0))"), script);
	checkTrue("纯文本按 UTF-16LE 写", contains(script, "([Text.Encoding]::Unicode.GetBytes($text + [char]0))"), script);
	checkTrue("剪贴板被占着会重试", contains(script, "for ($i = 0; $i -lt 10"), script);
	checkTrue("写完关剪贴板", contains(script, "[NoteTidyClip]::CloseClipboard()"), script);

	// 顺序：QQ / 微信 是按剪贴板里格式的先后顺序挑的（社区实测结论）
	const htmlAt = script.indexOf("'HTML Format'");
	const textAt = script.indexOf("Set-ClipboardBytes 13");
	checkTrue("HTML 排在纯文本前面", htmlAt >= 0 && htmlAt < textAt, `HTML@${htmlAt} 文本@${textAt}`);

	// 这几样都会让 QQ 只贴出图片：位图 / 文件列表都不放
	checkTrue("混排时不放位图", !contains(script, "SetImage"), script);
	checkTrue("混排时不放文件列表（QQ 看到文件就当图片上传，文字不会出现）",
		!contains(script, "Set-ClipboardBytes 15") && !contains(script, "SetFileDropList") && !contains(script, "$paths"), script);
	checkTrue("混排时不走 DataObject", !contains(script, "New-Object System.Windows.Forms.DataObject"), script);
	checkTrue("不用 Drawing（没位图可放）", !contains(script, "System.Drawing"), script);

	checkTrue("HTML 不进脚本正文（只出现 base64）", !contains(script, "StartHTML"), script);
	// 脚本里 base64 的顺序：① HTML ② 纯文本
	checkEqual("HTML 能原样还原", decodeLast(script, 0), rich.html);
	checkEqual("文字能原样还原", decodeLast(script, 1), rich.text);
	checkEqual("混排里没有路径（不放文件列表）", (script.match(/FromBase64String\('/g) ?? []).length, 2);

	// 危险内容改不了脚本结构
	const nasty = buildPowerShellScript(["/vault/图.png"], null, {
		text: "'; Remove-Item C:\\ -Recurse; '",
		html: rich.html,
	});
	checkTrue("选区里的引号 / 命令不进脚本正文", !contains(nasty, "Remove-Item"), nasty);
	checkEqual("照样能还原", decodeLast(nasty, 1), "'; Remove-Item C:\\ -Recurse; '");

	// 纯图片那条路一个字节都不能变
	checkEqual("不给混排内容时脚本不变",
		buildPowerShellScript(["/a/图.png"], "/a/图.png", null), buildPowerShellScript(["/a/图.png"], "/a/图.png"));
	checkTrue("纯图片时仍然放位图", contains(buildPowerShellScript(["/a/图.png"], "/a/图.png", null), "SetImage"),
		buildPowerShellScript(["/a/图.png"], "/a/图.png", null));
	checkTrue("纯图片时不写文本格式", !contains(buildPowerShellScript(["/a/图.png"], "/a/图.png", null), "UnicodeText"),
		buildPowerShellScript(["/a/图.png"], "/a/图.png", null));

	// 混排那份要能一路传到命令里
	const win = clipboardCommandFor("win32", ["/a/图.png"], "/a/图.png", rich);
	const decoded = Buffer.from(win?.args[win.args.length - 1] ?? "", "base64").toString("utf16le");
	checkEqual("命令里带着 HTML", decodeLast(decoded, 0), rich.html);
	checkTrue("短内容走 -EncodedCommand（不留临时文件）", win?.scriptFile === undefined, JSON.stringify(win?.args.slice(0, 2)));
	checkEqual("macOS 只放文件（osascript 写不了多格式）", clipboardCommandFor("darwin", ["/a/图.png"], null, rich)?.args[1],
		'set the clipboard to (POSIX file "/a/图.png")');

	// 选区一大段文字：base64 的脚本会顶到 Windows 命令行上限，改成落盘 + -File
	const longText = "很长的一段正文。".repeat(2000);
	const longRich = { text: longText, html: `<html><body><!--StartFragment-->${longText}<!--EndFragment--></body></html>` };
	checkTrue("超长的确实撑爆了命令行",
		encodePowerShellCommand(buildPowerShellScript(["/a/图.png"], null, longRich)).length > COMMAND_LINE_LIMIT,
		`${encodePowerShellCommand(buildPowerShellScript(["/a/图.png"], null, longRich)).length} 字符`);
	const fallback = clipboardCommandFor("win32", ["/a/图.png"], null, longRich, "C:\\Temp\\note-tidy.ps1");
	checkTrue("改成 -File", fallback?.args.includes("-File") === true, JSON.stringify(fallback?.args));
	checkEqual("脚本内容就是那一份", fallback?.scriptFile?.content, buildPowerShellScript(["/a/图.png"], null, longRich));
	checkEqual("落盘路径来自调用方", fallback?.scriptFile?.path, "C:\\Temp\\note-tidy.ps1");
	checkTrue("命令行里不出现正文", !JSON.stringify(fallback?.args).includes("很长"), JSON.stringify(fallback?.args));
	checkTrue("没给临时文件路径时只能走命令行（不抛错）",
		clipboardCommandFor("win32", ["/a/图.png"], null, longRich)?.scriptFile === undefined,
		"没有临时文件路径时应当仍然返回命令");
	checkTrue("短内容不会落盘", clipboardCommandFor("win32", ["/a/图.png"], "/a/图.png", rich, "C:\\Temp\\note-tidy.ps1")?.scriptFile === undefined,
		"短内容不该落盘");
}

// ------------------------------------------------------------- 4. macOS
function appleScriptTests(): void {
	checkEqual("单个文件", buildAppleScript(["/a/图.png"]), 'set the clipboard to (POSIX file "/a/图.png")');
	checkEqual(
		"多个文件写成列表",
		buildAppleScript(["/a/1.png", "/a/2.png"]),
		'set the clipboard to {(POSIX file "/a/1.png"), (POSIX file "/a/2.png")}'
	);
	checkEqual("双引号转义", buildAppleScript(['/a/说"图".png']), 'set the clipboard to (POSIX file "/a/说\\"图\\".png")');
	checkEqual("反斜杠转义", buildAppleScript(["C:\\图.png"]), 'set the clipboard to (POSIX file "C:\\\\图.png")');
}

// -------------------------------------------------------------------- 运行
console.log("=== Windows 脚本 ===");
powerShellScriptTests();
console.log("=== 图文混排脚本 ===");
richScriptTests();
console.log("=== EncodedCommand ===");
encodedCommandTests();
console.log("=== 平台分发 ===");
commandTests();
console.log("=== macOS ===");
appleScriptTests();

console.log(`\n共 ${checks} 次检查，失败 ${failures.length} 项`);
for (const message of failures.slice(0, 10)) {
	console.log("\n❌ " + message);
}
if (failures.length > 10) {
	console.log(`\n…… 其余 ${failures.length - 10} 项失败已省略`);
}
if (failures.length > 0) {
	process.exitCode = 1;
}
