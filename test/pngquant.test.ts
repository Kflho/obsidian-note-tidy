/**
 * pngquant 那一步（`src/image/pngquant.ts`）
 *
 * 运行：npm test
 *
 * 盯四件事：
 *   1. 成功：PNG 从 stdin 进去、压缩后的 PNG 从 stdout 出来（`--quality min-max -`，与 Image Converter 同一套参数）
 *   2. 退出码非 0 一律当"别用"（pngquant 质量够不到 min 时原样吐图并 exit 99）
 *   3. 找不到可执行文件 / 路径留空 / 输出为空 → `null`（调用方按原格式留着）
 *   4. 与转换流程接上：`PNGQUANT` 只接 PNG 源、输出仍是 `.png`（不改名，直接写回内容）
 *
 * 假 pngquant 用 `node -e <脚本>` 演（`runPngquant` 的第三个参数就是给这种场合留的），
 * 所以这一套在 Windows / Linux 上都能跑。
 */
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { convertImageBytes, convertPlanFrom } from "../src/image/convert";
import { DEFAULT_PNGQUANT_QUALITY, runPngquant } from "../src/image/pngquant";
import { stubPngBytes, stubWebpBytes } from "./canvas-stub";

// -------------------------------------------------------------------- 断言
let checks = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
	checks++;
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		failures.push(`[期望不符] ${name}\n  期望 ${JSON.stringify(expected)}\n  实际 ${JSON.stringify(actual)}`);
	}
}

function checkTrue(name: string, condition: boolean, detail = ""): void {
	checks++;
	if (!condition) failures.push(`[断言失败] ${name}\n${detail}`);
}

// -------------------------------------------------------------------- 工具
/** 假 pngquant：读干净 stdin，往 stdout 写一段指定的字节，然后按给定退出码退出 */
function fakePngquantScript(body: string, exitCode = 0): string {
	return `const chunks=[];process.stdin.on('data',c=>chunks.push(c));`
		+ `process.stdin.on('end',()=>{${body}process.exit(${exitCode});});`;
}

const PNG_MAGIC = '[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]';

/** 带标记的假 PNG：用来分辨"这是压缩后的那一份"而不是原来那份 */
function pngBytesOf(payload: string): ArrayBuffer {
	const bytes = new Uint8Array(16 + payload.length);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	for (let i = 0; i < payload.length; i++) bytes[16 + i] = payload.charCodeAt(i);
	return bytes.buffer;
}

/** 跑一次"假 pngquant" */
async function withFake(script: string, input = stubPngBytes()): Promise<ArrayBuffer | null> {
	return await runPngquant({ path: process.execPath, quality: DEFAULT_PNGQUANT_QUALITY }, input, ['-e', script]);
}

function tf(pathStr: string): TFile {
	const name = pathStr.split('/').pop() ?? pathStr;
	const dot = name.lastIndexOf('.');
	return Object.assign(new TFile(), {
		path: pathStr,
		name,
		extension: dot > 0 ? name.substring(dot + 1) : '',
		parent: { path: pathStr.includes('/') ? pathStr.substring(0, pathStr.lastIndexOf('/')) : '' },
	});
}

function createApp(initial: Record<string, ArrayBuffer> = {}): {
	app: App;
	files: Map<string, ArrayBuffer>;
	log: { renamed: string[]; modified: string[] };
} {
	const files = new Map<string, ArrayBuffer>(Object.entries(initial));
	const log = { renamed: [] as string[], modified: [] as string[] };
	const vault = {
		getAbstractFileByPath: (p: string): TFile | null => (files.has(p) ? tf(p) : null),
		readBinary: async (f: TFile): Promise<ArrayBuffer> => files.get(f.path) ?? stubPngBytes(),
		modifyBinary: async (f: TFile, data: ArrayBuffer): Promise<void> => {
			files.set(f.path, data);
			log.modified.push(f.path);
		},
	};
	const fileManager = {
		renameFile: async (f: TFile, newPath: string): Promise<void> => {
			files.set(newPath, files.get(f.path) ?? new ArrayBuffer(0));
			files.delete(f.path);
			log.renamed.push(`${f.path} -> ${newPath}`);
		},
	};
	return { app: { vault, fileManager } as unknown as App, files, log };
}

// ------------------------------------------------------------ 1. 真跑一次（假可执行文件）
async function runTests(): Promise<void> {
	// ① 成功：stdin → stdout，字节原样交回
	{
		const script = fakePngquantScript(`process.stdout.write(Buffer.from(${PNG_MAGIC}));`);
		const result = await withFake(script);
		check("成功：拿到压缩后的字节",
			result ? Array.from(new Uint8Array(result).slice(0, 4)) : null, [0x89, 0x50, 0x4e, 0x47]);
	}

	// ② 质量够不到 min：pngquant 原样吐图 + exit 99 → 当"别用"
	{
		const script = fakePngquantScript(`process.stdout.write(Buffer.from(${PNG_MAGIC}));`, 99);
		check("退出码 99（质量不达标）：按原样处理", await withFake(script), null);
	}

	// ③ 找不到可执行文件：`error` 事件 → null（不炸）
	{
		check("找不到可执行文件：null",
			await runPngquant({ path: 'definitely-not-a-real-pngquant-xyz', quality: '65-80' }, stubPngBytes()), null);
	}

	// ④ 路径留空：连 spawn 都不做
	{
		check("路径留空：null", await runPngquant({ path: '   ', quality: '65-80' }, stubPngBytes()), null);
	}

	// ⑤ 输出为空：null
	{
		check("输出为空：null", await withFake(fakePngquantScript('')), null);
	}
}

// ------------------------------------------------------------ 2. 与转换流程接上
async function convertTests(): Promise<void> {
	// ① 计划：`pngquant` 这一档要路径；没路径＝这一步不做（与 Image Converter 一致）
	check("计划：pngquant + 路径",
		convertPlanFrom('pngquant', '75', 'D:/tools/pngquant.exe', '65-80'),
		{ format: 'PNGQUANT', quality: 75, pngquant: { path: 'D:/tools/pngquant.exe', quality: '65-80' } });
	check("计划：pngquant 没配路径 → 不做", convertPlanFrom('pngquant', '75', '', '65-80'), null);
	check("计划：pngquant 质量档留空 → 用默认 65-80",
		convertPlanFrom('pngquant', '75', 'D:/pngquant.exe', '  ')?.pngquant?.quality, DEFAULT_PNGQUANT_QUALITY);

	const plan = convertPlanFrom('pngquant', '75', 'D:/pngquant.exe', '65-80');
	const app = createApp();
	const compressed = pngBytesOf('compressed');

	// ② 只接 PNG 源：它只吃 PNG，别的格式喂进去只会报错退出
	check("该转：PNG 源（压 PNG 正是它的活）",
		await convertImageBytes(app.app, { name: 'a.png', bytes: stubPngBytes() }, plan,
			undefined, async () => compressed),
		{ name: 'a.png', bytes: compressed });
	check("不转：jpg 源（pngquant 吃不下）",
		await convertImageBytes(app.app, { name: 'a.jpg', bytes: stubPngBytes() }, plan,
			undefined, async () => compressed), null);
	check("不转：webp 源", await convertImageBytes(app.app, { name: 'a.webp', bytes: stubWebpBytes() }, plan,
		undefined, async () => compressed), null);
	check("不转：动图 gif", await convertImageBytes(app.app, { name: 'a.gif', bytes: stubPngBytes() }, plan,
		undefined, async () => compressed), null);

	// ③ 名字不变（`a.png` → `a.png`）：压 PNG 不该把它改叫别的
	check("名字：仍是 a.png",
		(await convertImageBytes(app.app, { name: 'a.png', bytes: stubPngBytes() }, plan,
			undefined, async () => compressed))?.name, 'a.png');

	// ④ 执行器没给出结果（没装 / 报错 / 空输出）：按原样处理
	check("执行器返回 null：不转",
		await convertImageBytes(app.app, { name: 'a.png', bytes: stubPngBytes() }, plan,
			undefined, async () => null), null);
	check("执行器给出非 PNG 字节：不转",
		await convertImageBytes(app.app, { name: 'a.png', bytes: stubPngBytes() }, plan,
			undefined, async () => stubWebpBytes()), null);
}

// ------------------------------------------------------------ 3. 库里已有的 PNG：同名写回
async function vaultConvertTests(): Promise<void> {
	const plan = convertPlanFrom('pngquant', '75', 'D:/pngquant.exe', '65-80');
	const { convertVaultImage } = await import("../src/image/convert");

	const { app, files, log } = createApp({ 'att/a.png': stubPngBytes() });
	const name = await convertVaultImage(app, tf('att/a.png'), plan, undefined, async () => pngBytesOf('z'));
	check("全库：返回同名", name, 'a.png');
	check("全库：名字没变就不去 renameFile", log.renamed, []);
	check("全库：内容写回去了", log.modified, ['att/a.png']);
	checkTrue("全库：文件还在原处", files.has('att/a.png'), "应当还在 att/a.png");
}

// -------------------------------------------------------------------- 运行
console.log("=== 1. 真跑一次（假可执行文件） ===");
await runTests();

console.log("=== 2. 与转换流程接上 ===");
await convertTests();

console.log("=== 3. 库里已有的 PNG：同名写回 ===");
await vaultConvertTests();

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
