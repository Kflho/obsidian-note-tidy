import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig(
	{
		languageOptions: {
			globals: {
				...globals.browser,
				moment: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'eslint.config.mts',
						'manifest.json',
						'test/*.mjs'
					]
				},
				tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// 测试代码运行在 Node 环境，且需要用 console 输出测试结果
		files: ['test/**/*.ts', 'test/**/*.mjs'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'no-console': 'off',
			// obsidianmd 0.4.2 起 no-console 改由这条规则代管（消息带 [no-console] 前缀）。
			// 测试跑在 Node 里，本来就要用 console 输出结果，这里一并关掉。
			'obsidianmd/rule-custom-message': 'off',
			// 测试没有 popout 窗口，Node 下的全局对象就是 globalThis
			'obsidianmd/no-global-this': 'off',
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"test/.build",
	]),
);
