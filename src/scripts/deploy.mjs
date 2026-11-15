/**
 * 把构建产物同步到 Obsidian 插件目录。
 *
 * 源码在本仓库，Obsidian 加载的是 vault 里的插件目录 —— 那边只留
 * 运行用文件（main.js / manifest.json / styles.css / data.json），源码一份都不放。
 * `npm run dev`（watch）与 `npm run build` 都会在打包完成后自动调用这里；
 * 改了 manifest.json 版本号又不想重新打包时，直接 `npm run deploy`。
 *
 * 脚本在 `src/scripts/` 下，项目根是上两级（入口、manifest、交付包都在根上）。
 *
 * 目标目录的取法（先到先用）：
 *   1. 环境变量 OBSIDIAN_PLUGIN_DIR
 *   2. 仓库根的 deploy.local.json（gitignore）
 * 目录不存在（例如 CI 上跑 build）时就跳过，只打印一行提示 —— 绝不因此让构建失败。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** 项目根（本脚本在 `src/scripts/` 下）：main.js / manifest.json / styles.css 都在根上 */
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 本机部署配置；真实路径不进 git。 */
function localPluginDir() {
	try {
		const raw = fs.readFileSync(path.join(projectRoot, "deploy.local.json"), "utf8");
		const parsed = JSON.parse(raw);
		return typeof parsed.pluginDir === "string" ? parsed.pluginDir : "";
	} catch {
		return "";
	}
}

/** 需要同步过去的运行用文件：main.js 来自交付包，manifest 来自仓库根，styles 来自 src。 */
const ARTIFACTS = [
	{ name: "main.js", from: "bin/exports/main.js" },
	{ name: "manifest.json", from: "manifest.json" },
	{ name: "styles.css", from: "src/styles.css" },
];

/** Hot Reload 插件只监视带 `.hotreload` 标记的插件目录；部署时顺手补一个空标记。 */
function ensureHotReloadMarker(target) {
	try {
		const marker = path.join(target, ".hotreload");
		if (!fs.existsSync(marker)) fs.writeFileSync(marker, "");
	} catch (error) {
		console.warn(`[deploy] 创建 .hotreload 标记失败：${error.message}`);
	}
}

/** 目标插件目录；环境变量优先，其次本机 deploy.local.json。 */
export function resolvePluginDir() {
	return process.env.OBSIDIAN_PLUGIN_DIR || localPluginDir();
}

/**
 * 复制产物到插件目录。返回复制过去的文件名；目标目录不存在时返回空数组。
 * 出错只警告不抛 —— 构建本身已经成功了，不该因为同步失败就报失败。
 */
export function deployArtifacts({ quiet = false } = {}) {
	const target = resolvePluginDir();
	if (!fs.existsSync(target)) {
		if (!quiet) console.log(`[deploy] 跳过：插件目录不存在 ${target}`);
		return [];
	}

	const copied = [];
	for (const artifact of ARTIFACTS) {
		const from = path.join(projectRoot, artifact.from);
		if (!fs.existsSync(from)) {
			console.warn(`[deploy] 缺少 ${artifact.name}，跳过`);
			continue;
		}
		try {
			fs.copyFileSync(from, path.join(target, artifact.name));
			copied.push(artifact.name);
		} catch (error) {
			console.warn(`[deploy] 复制 ${artifact.name} 失败：${error.message}`);
		}
	}

	if (!quiet && copied.length > 0) {
		console.log(`[deploy] 已同步到插件目录：${copied.join(", ")} → ${target}`);
	}
	if (copied.length > 0) ensureHotReloadMarker(target);
	return copied;
}

// 直接 `node src/scripts/deploy.mjs` 时执行一次；被 esbuild.config.mjs import 时不执行。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const copied = deployArtifacts();
	if (copied.length === 0) process.exitCode = 1;
}
