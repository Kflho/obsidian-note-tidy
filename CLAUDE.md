# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Note Tidy** (`note-tidy`, formerly `absolute-image-transfer`) — Obsidian desktop-only plugin that tidies a vault:

- **Images**: transfers external-path images (e.g. `file:///D:\...`) into the vault as internal `![[...]]` links, renames garbled image files, sets image sizes, and re-links images copied across folders.
- **Text**: typesets notes — plain-text math → `$…$`, LaTeX code layout, CJK/English/formula spacing, punctuation width by language, leading indentation, block markers, tag placement and sorting, content block sorting, and QQ/WeChat chat log reformatting.

## Commands

```bash
npm install              # Install dependencies
npm run dev              # Watch mode (esbuild --watch)
npm run build            # Type-check then bundle for production (tsc --noEmit + esbuild minified)
npm test                 # Run test/*.test.ts through test/run-tests.mjs (no framework needed)
npm run lint             # ESLint
npm run version          # Bump manifest.json version + update versions.json (reads from npm_package_version env var)
```

The esbuild config (`esbuild.config.mjs`) bundles `src/main.ts` into `main.js` (CJS, ES2018 target). Obsidian, electron, and CodeMirror packages are marked external.

## Architecture

### Source layout
```
src/
  main.ts               # Plugin entry point, commands, right-click menus, file I/O
  settings.ts           # ImageTransferSettings + SettingTab (分区：图片导入 / 图片大小 / 代码格式 / 排版格式)
  text-pipeline.ts      # 纯函数排版流水线：缩进 → 标记 → 聊天记录 → 智能公式 → 公式 → 空格 → 标签 → 板块排序
  text-layout.ts        # 行首缩进归一（4 空格 = 1 tab）
  markdown-markers.ts   # 引用 / 列表 / 标题标记的空白规范化
  chat-log.ts           # QQ/微信聊天记录排版
  text-math.ts          # 智能公式：正文里的 `矩阵 A`、`n维`、`V(F)`、`x = 0`、`λ` 自动包 `$…$`
  inline-scan.ts        # 行内共用保护区：行内代码、双链链接、URL、标签、注释、已有 $…$
  latex-layout.ts       # 代码格式：$$…$$ 与行内 $…$ 的 LaTeX 代码
  spacing.ts            # 排版格式：中文 / 英文 / 数字 / 公式 / 标点之间的空格（八条规则）
  tags.ts               # 标签归位到块尾 + 标签排序
  block-sort.ts         # 内容板块排序
  line-scan.ts          # 共用保护区判定：frontmatter、围栏/缩进代码块、公式行
  collate.ts            # "首字母"比较（中文按拼音）
  image-*.ts            # 图片链接 / 尺寸 / 位置整理 / 附件夹
  ui/                   # 弹窗
test/*.test.ts          # 每个纯函数模块一份测试（含幂等）
main.js                 # Bundled output (committed — Obsidian plugins require it at root)
manifest.json           # Plugin metadata
styles.css              # Plugin CSS (notice suppression, size dialog, settings sub-headings)
```

**Note:** feature logic lives in the modules above; `main.ts` keeps only plugin lifecycle, commands, menus and vault I/O. Every pipeline step is a pure, idempotent function so it can be tested without Obsidian.

### Three core features

1. **External image transfer** (`processNote`) — Regex `!\[(.*?)\]\((<?(?:file:\/+|[a-zA-Z]:[\\/]).*?\.(?:png|jpg|jpeg|gif|bmp|webp|heic)>?)\)` matches absolute-path image links, resolves physical paths via `flexibleProbing`, copies file into vault at the configured attachment folder, replaces link with `![[Pasted image YYYYMMDDHHmmss.ext]]`.

2. **Garbled image renaming** (`processGarbledImages`) — Finds `![[...]]` links matching image extensions, then applies a three-condition garbled detection:
   - **Special chars** (`[\\%{}()[\]~\`^]`): backslash, percent, brackets, braces, tilde, backtick, caret
   - **URL-encoded sequences**: `decodeURIComponent(rawLink) !== rawLink` indicates encoding residues
   - **Pure digit+dot naming**: filename stem (without extension) contains only digits, dots, spaces, hyphens, underscores and no letters — clearly auto-generated (e.g., `123.456.png`)
   
   Garbled files are renamed to clean `Pasted image ...` format via `app.fileManager.renameFile`.

3. **Chat log formatting** (`processChatLog`) — Parses QQ/WeChat-style timestamps + usernames from raw text, reformats into `Username: YYYY/MM/DD HH:mm:ss\n\tmessage content` with tab-indented message bodies. **Must be strictly idempotent** — guarded by `if (result !== rawContent)` before writing. Repeated runs must not produce additional newlines or whitespace changes.

### Path resolution engine (`flexibleProbing`)

Recursively walks the filesystem from a drive root, matching path segments against entries returned by `fs.readdir`. Designed to handle:
- URL-encoded characters (`%01`, `%20`) → decoded with `decodeURIComponent` before comparison
- Markdown escape backslashes (`\(`, `\)`, `\[`, `\]`) → silently skipped during matching
- Case-insensitive matching (Windows filesystem)
- Entries sorted by length descending so longer matches take priority

Returns the first physical file path found, or `null`.

### Settings and attachment folder resolution

`ImageTransferSettings` has two fields:
- `attachmentLocation`: `"system"` | `"root"` | `"current"` | `"subfolder"` | `"custom"`
- `customAttachmentFolder`: used when location is `"subfolder"` or `"custom"`

`getTargetAttachmentFolder(file)` reads the vault's system-level `attachmentFolderPath` config when in `"system"` mode, resolves `./` prefixes relative to the note's parent, and recursively creates folders that don't exist yet.

### Desktop-only constraints

Uses Node.js `fs/promises` and `path` for filesystem access. `isDesktopOnly: true` in manifest. Platform detection via `Platform.isWin` drives path separator logic.

### Supported image formats

`png`, `jpg`, `jpeg`, `gif`, `bmp`, `webp`, `heic` — case-insensitive matching in both transfer and rename features.

## Git workflow

- Branch naming: version-based (e.g., `1.0.5`)
- CI (`.github/workflows/lint.yml`): runs on push/PR, tests Node 20.x and 22.x — `npm ci` → `npm run build` → `npm test` → `npm run lint`
- Lint pins `eslint-plugin-obsidianmd` to the version the community-plugin review uses — keep it current, or the review will report findings the local lint misses
- `version-bump.mjs` reads `npm_package_version`, writes `manifest.json` and `versions.json`
- Releases: tag must match `manifest.json` version (no leading `v`); attach `main.js`, `manifest.json`, `styles.css`
- Release automation (`.github/workflows/release.yml`): pushing the version tag runs `npm ci` → `npm test` → `npm run build`, checks the tag against `manifest.json`, generates [artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) for the three assets, and creates the release. Do not create the release by hand — a hand-made release has no attestations, which the plugin review flags

## 提交分支到 GitHub 时的自动化流程

当用户**明确要求**提交分支到 GitHub 时（例如 "提交到github"、"push到github"、"推送到远程"等），才执行以下步骤。**严禁在用户未明确要求时自动提交或推送。**

1. **从分支名提取版本号**：当前分支名通常包含版本号，如 `1.1.1` 或 `1.1.1更新`。从分支名中提取语义版本号（如 `1.1.1`）。

2. **更新所有版本号文件**，将提取的版本号同步到以下三个文件：
   - `manifest.json` → 更新 `"version"` 字段
   - `package.json` → 更新 `"version"` 字段
   - `versions.json` → 在末尾添加新版本条目 `"x.y.z": "1.0.0"`（如果尚不存在）

3. **构建并提交**（仅在用户明确要求提交时执行）：
   ```bash
   npm run build    # 类型检查 + 打包
   npm test
   npm run lint
   git add -A
   git commit -m "版本号: x.y.z"
   git push origin <当前分支名>
   ```

4. **发版**：推送版本号 tag，交给 release 工作流（它会构建、签名、建 release）：
   ```bash
   git tag x.y.z
   git push origin x.y.z
   gh run watch          # 看工作流跑完
   gh release view x.y.z --json assets
   ```
   手动 `gh release create` 只在工作流不可用时兜底 —— 这样发出来的资产没有 attestation。

版本号应保持一致：`manifest.json` 的 version、`package.json` 的 version、以及 `versions.json` 中最新的 key 三者必须一致。
