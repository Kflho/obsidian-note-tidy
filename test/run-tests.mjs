/**
 * 娴嬭瘯杩愯鍣細鐢?esbuild 鎶?test/ 涓嬬殑娴嬭瘯鎵撳寘鎴?ESM 鍚庡湪褰撳墠杩涚▼鍐呮墽琛屻€?
 * 杩欐牱娴嬭瘯鏃犻渶浠讳綍娴嬭瘯妗嗘灦锛屼篃涓嶅彈 Node 鐗堟湰瀵?TypeScript 鏀寔绋嬪害鐨勯檺鍒躲€?
 */
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const entryPoints = [
	"test/chat-log.test.ts",
	"test/context-indent.test.ts",
	"test/text-layout.test.ts",
	"test/markdown-markers.test.ts",
	"test/list-numbering.test.ts",
	"test/heading-levels.test.ts",
	"test/tags.test.ts",
	"test/block-sort.test.ts",
	"test/latex-layout.test.ts",
	"test/text-math.test.ts",
	"test/spacing.test.ts",
	"test/text-pipeline.test.ts",
	"test/image-size.test.ts",
	"test/image-organizer.test.ts",
	"test/image-transfer.test.ts",
	"test/image-dedupe.test.ts",
	"test/image-unused.test.ts",
	"test/image-convert.test.ts",
	"test/pngquant.test.ts",
	"test/image-tidy.test.ts",
	"test/image-scan.test.ts",
	"test/image-copy.test.ts",
	"test/image-clipboard.test.ts",
	"test/rich-copy.test.ts",
	"test/image-menu.test.ts",
	"test/menu-hidden.test.ts",
	"test/selection-count.test.ts",
	"test/copy-shortcut.test.ts",
	"test/paste-watch.test.ts",
	"test/paste-images.test.ts",
	"test/notice-suppressor.test.ts",
	"test/commands.test.ts",
	"test/settings.test.ts",
	"test/rules.test.ts",
];
const outdir = path.resolve("test/.build");

fs.rmSync(outdir, { recursive: true, force: true });

await esbuild.build({
	entryPoints,
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node18",
	outdir,
	outExtension: { ".js": ".mjs" },
	// 绾€昏緫妯″潡閲岀殑 instanceof TFile 绛夊垽鏂渶瑕佺湡瀹炵殑绫伙紝杩欓噷鎹㈡垚娴嬭瘯鏇胯韩
	alias: { obsidian: path.resolve("test/obsidian-stub.mjs") },
	logLevel: "warning",
});

for (const entry of entryPoints) {
	const outfile = path.join(outdir, path.basename(entry).replace(/\.ts$/, ".mjs"));
	console.log(`\n鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€ ${path.basename(entry)} 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€`);
	// eslint-disable-next-line no-unsanitized/method -- 璺緞鐢辨湰鏂囦欢鐨?entryPoints 甯搁噺鎷煎嚭锛屼笉鏉ヨ嚜澶栭儴杈撳叆
	await import(pathToFileURL(outfile).href);
}
