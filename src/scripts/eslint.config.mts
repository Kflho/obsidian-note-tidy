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
				// npm 工程根就是 src/；tsconfig 在同目录
				project: ['tsconfig.json'],
				tsconfigRootDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
			},
		},
	},
	...obsidianmd.configs.recommended,
	globalIgnores([
		"node_modules",
		"dist",
		"scripts/",
	]),
);
