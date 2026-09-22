# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**Note Tidy** (`note-tidy`, formerly `absolute-image-transfer`) — Obsidian desktop-only plugin that tidies a vault:

- **Images**: transfers external-path images (e.g. `file:///D:\...`) into the vault as internal `![[...]]` links, renames garbled image files, sets image sizes, and re-links images copied across folders.
- **Text**: typesets notes — plain-text math → `$…$`, LaTeX code layout, CJK/English/formula spacing, punctuation width by language, leading indentation, block markers, list numbering, heading levels, tag placement and sorting, content block sorting, and QQ/WeChat chat log reformatting.

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
  main.ts               # 插件入口：只做生命周期与装配（读设置、把各部件接起来、注册命令与菜单）
  commands.ts           # 12 条命令的注册（命令 ID 是稳定接口，test/commands.test.ts 逐条比对菜单）
  tasks.ts              # 任务编排：每种操作一份实现，命令面板 / 右键菜单 / 弹窗三条路都落到这里
  batch.ts              # 批量外壳：互斥锁 + 通知屏蔽 + 状态栏进度 + 出错兜底 + 结果通知
  rule-registry.ts      # 规则登记表：规范出处 ↔ 开关 ↔ 实现 ↔ 测试（不进 main.js，只有测试与文档用它）
  settings/
    model.ts            # ImageTransferSettings + DEFAULT_SETTINGS + 设置 → 各功能选项的转换
    fields/             # 字段表（面板的单一数据源：名字、说明、控件、收敛、显隐）
    tab.ts              # 设置面板：声明式定义（1.13+）与手写 DOM（1.13 以下）都由字段表生成
  text/                 # 排版（纯函数，不依赖 Obsidian API）
    pipeline.ts         # 流水线：缩进 → 标记 → 聊天记录 → 列表序号 → 标题级别 → 智能公式 → 公式 → 空格 → 标签 → 板块排序
    indent.ts           # 行首缩进归一（4 空格 = 1 tab）
    markers.ts          # 引用 / 列表 / 标题标记的空白规范化
    list-numbering.ts   # 列表序号整理（保证每个列表首项编号是 1）
    heading-levels.ts   # 标题级别整理（子标题与父标题恰好差一级，多标题并行算）
    chat-log.ts         # QQ/微信聊天记录排版
    math-wrap.ts        # 智能公式：正文里的 `矩阵 A`、`n维`、`V(F)`、`x = 0`、`λ` 自动包 `$…$`
    latex.ts            # 代码格式：$$…$$ 与行内 $…$ 的 LaTeX 代码
    spacing/            # 空格排版：index.ts（接口 + fixSpacing）/ tokenize.ts（分词）/ gap.ts（词间判定）
    symbols.ts          # 逐符号空格规则表（数据 + 依据）
    tags.ts             # 标签归位到块尾 + 标签排序
    block-sort.ts       # 内容板块排序
    collate.ts          # "首字母"比较（中文按拼音）
    line-scan.ts        # 整行保护区：frontmatter、围栏/缩进代码块、GFM 表格、行内代码区间
    inline-scan.ts      # 行内保护区 + 公式识别与配对（`$…$` / `$$…$$` 判定的唯一出处）
  image/
    links.ts            # 链接解析与同名歧义（同名不猜）
    naming.ts           # 命名预设、唯一路径、仓库文件名表
    external-path.ts    # 弹性路径解析（URL 编码 / Markdown 转义 / 大小写）
    transfer.ts         # 外部图片导入
    rename.ts           # 乱码改名 / 全量改名 / 链接格式归一
    size.ts             # 图片大小批改
    organize.ts         # 图片位置整理
    attachment-folder.ts# 附件夹定位与按需创建
    constants.ts        # 扩展名表与嵌入链接正则
  ui/
    menus.ts            # 文件 / 文件夹右键菜单（图片功能 / 文本排版两个二级栏）
    image-size-modal.ts # 图片大小弹窗
    confirm-rename-modal.ts # 批量重命名确认
    progress.ts         # 状态栏进度
    notice-suppressor.ts# 批量期间屏蔽通知
test/*.test.ts          # 每个纯函数模块一份测试（含幂等）；rules.test.ts 核对规则登记表与文档
docs/规则登记表.md       # 由 src/rule-registry.ts 生成（node test/run-tests.mjs --update-rules-doc）
main.js                 # Bundled output (committed — Obsidian plugins require it at root)
manifest.json           # Plugin metadata
styles.css              # Plugin CSS (notice suppression, size dialog, settings sub-headings)
```

**Note:** feature logic lives in the modules above; `main.ts` is only lifecycle + wiring. Every pipeline step is a pure, idempotent function so it can be tested without Obsidian. `src/rule-registry.ts` maps each typesetting/image rule to its spec item, settings switch, implementation and tests — the spec lives in the vault at `data/data note/note note.md`.

### Three core features

1. **External image transfer** (`image/transfer.ts` → `transferExternalImages`) — Regex built from `MANAGED_IMAGE_EXTENSIONS` matches absolute-path image links, resolves physical paths via `flexibleProbing`, copies file into vault at the configured attachment folder, replaces link with `![[Pasted image YYYYMMDDHHmmss.ext]]`.

2. **Garbled image renaming** (`image/rename.ts` → `isGarbledImageName`, `renameGarbledImages`) — Finds `![[...]]` links matching image extensions, then applies a three-condition garbled detection:
   - **Special chars** (`[\\%{}()[\]~\`^]`): backslash, percent, brackets, braces, tilde, backtick, caret
   - **URL-encoded sequences**: `decodeURIComponent(rawLink) !== rawLink` indicates encoding residues
   - **Pure digit+dot naming**: filename stem (without extension) contains only digits, dots, spaces, hyphens, underscores and no letters — clearly auto-generated (e.g., `123.456.png`)
   
   Garbled files are renamed to clean `Pasted image ...` format via `app.fileManager.renameFile`.

3. **Chat log formatting** (`text/chat-log.ts` → `formatChatLog`; 写盘在 `tasks.ts` → `typesetOne`) — Parses QQ/WeChat-style timestamps + usernames from raw text, reformats into `Username: YYYY/MM/DD HH:mm:ss\n\tmessage content` with tab-indented message bodies. **Must be strictly idempotent** — guarded by `if (result !== rawContent)` before writing. Repeated runs must not produce additional newlines or whitespace changes.

### 排版流水线（text/pipeline.ts）

固定顺序：**行首缩进 → 标记 → 聊天记录 → 列表序号 → 标题级别 → 智能公式 → 公式 → 空格 → 标签 → 板块排序**。顺序不是随便定的（每一步的依赖写在 `pipeline.ts` 头部注释里）——例如序号与标题级别必须排在聊天记录之后（正文缩进定下来才知道谁是子列表）、排在板块排序之前（排序拿标题当锚点、排完还要按列表重排编号）。整条链**迭代到不动点**（最多 5 轮）：后面的步骤会改前面的步骤看过的文本 —— 例如公式排版把 `$w\approx 0$` 规范成 `$w \approx 0$`，板块排序的键随之改变。

智能公式只认"写成规范形态"的算式：**二元运算符两侧各留一格**（数学符号 1）才算，紧贴的一律不认 —— `x=0`、`a+b+c`、`5/10mm`、`A-7`、`cd /d`、`x -1` 都不动（那可能是作者故意写的编号 / 连字符 / 命令，也可能只是省了空格）；正负号是修饰符号（数学符号 3），`x = -1`、`f(-1)` 照旧包。

每一步都是纯函数且严格幂等，整篇没有真正变化时不写盘。改任何一步之前先看 `src/rule-registry.ts` 与 `docs/规则登记表.md`：那条规则对应规范里的哪一条、归谁实现、哪个测试在守。

### Path resolution engine (`flexibleProbing`, `image/external-path.ts`)

Recursively walks the filesystem from a drive root, matching path segments against entries returned by `fs.readdir`. Designed to handle:
- URL-encoded characters (`%01`, `%20`) → decoded with `decodeURIComponent` before comparison
- Markdown escape backslashes (`\(`, `\)`, `\[`, `\]`) → silently skipped during matching
- Case-insensitive matching (Windows filesystem)
- Entries sorted by length descending so longer matches take priority

Returns the first physical file path found, or `null`.

### Settings and attachment folder resolution

设置分三层：`settings/model.ts`（字段与默认值）、`settings/fields/`（面板的字段表，单一数据源）、`settings/tab.ts`（渲染：Obsidian 1.13+ 走声明式定义，1.13 以下走手写 DOM，两条路由同一张表生成）。加设置项只改字段表一处；`test/settings.test.ts` 会核对"每个字段都有且只有一条定义"。

附件夹定位（`image/attachment-folder.ts`）只看 `attachmentLocation`（`"system"` | `"root"` | `"current"` | `"subfolder"` | `"custom"`）与 `customAttachmentFolder` 两个字段：`resolveAttachmentFolder` 纯算路径，`getTargetAttachmentFolder` 才按需创建；`"system"` 模式读 vault 的系统级 `attachmentFolderPath` 配置。

### 桌面端约束 / 支持的图片格式

Uses Node.js `fs/promises` and `path` for filesystem access. `isDesktopOnly: true` in manifest. Platform detection via `Platform.isWin` drives path separator logic.

受管位图格式由 `image/constants.ts` 的 `MANAGED_IMAGE_EXTENSIONS` 一处定义（`png` `jpg` `jpeg` `gif` `bmp` `webp` `heic`），导入与改名都从它生成正则。判定"链接指向的是不是图片"用的是 `image/links.ts` 里更宽的一张表（多 `avif` / `svg`）—— 两者刻意不合并。

### 改动指南（照着做就不会破坏结构）

**加/改一条排版规则** —— 六处，缺一处 `test/rules.test.ts` 或构建就会报错：

1. **实现**：`src/text/<模块>.ts` 里加纯函数（幂等、不 import obsidian）；
2. **接线**：`src/text/pipeline.ts` 的 `TextPipelineOptions` + `runPipelineOnce`（决定它在第几步，顺序理由补进文件头那份编号列表）；
3. **开关**：`src/settings/model.ts`（字段 + 默认值）与 `src/settings/fields/text.ts`（表单一条）；
4. **转换**：`src/tasks.ts` 的 `getTextPipelineOptions()`（设置 → 流水线选项）与 `describeLayoutSwitches()`（结果提示里列出开了哪几步）；
5. **登记**：`src/rule-registry.ts` 加一条记录，再跑 `node test/run-tests.mjs --update-rules-doc` 生成 `docs/规则登记表.md`；
6. **测试**：`test/<模块>.test.ts`（期望输出 + 边界 + 幂等），并在 `test/run-tests.mjs` 的 entryPoints 里登记。

**加一个设置项**：只改 `src/settings/model.ts` + `src/settings/fields/`。面板的两条渲染路径（1.13+ 声明式 / 1.13 以下手写 DOM）都由字段表生成，`test/settings.test.ts` 核对"每个字段有且只有一条定义"；同时要让 `rule-registry.ts` 里某条规则用上这个开关（测试会查"有没有没人管的开关"）。

**加一条命令 / 菜单项**：`src/commands.ts` + `src/ui/menus.ts`。命令 ID 是已发布版本的稳定接口，`test/commands.test.ts` 会逐条比对菜单与命令表。

**改了规范笔记之后**：先改 `src/rule-registry.ts` 里的章节路径与条目号，跑 `npm test` —— 对不上会直接列出是哪几条；再重新生成 `docs/规则登记表.md`。注意测试能抓到"找不到第 N 条"，但抓不到"编号没变、内容换了"（例如 `英文符号 2` 从引号改成了省略号），所以改完要顺手核对该条目说的还是不是那条规则。

规范措辞有歧义时**先问清楚再改实现**。例如「包裹符号：括号、引号等，内外均没有空格」（通用符号 3 的包裹符号子条目）指的是**包裹符号自己不添空格**：内侧的填充空格要删，外侧不主动加、也不删**语言自带**的词距（`appendix (page 3)`、`He said "hello" loudly` 里那一格是英文词距，正如 `he said 你好(nihao)` 里中文旁本来就没有）。照字面理解成"外侧的空格也删掉"会把好好的英文词距删没。

### 不可破坏的约定

- **每一步幂等**：任何排版函数跑两遍结果必须一样，否则用户每次保存都会被再改一次；整条流水线迭代到不动点（最多 5 轮）靠的就是这一点。
- **保护区统一走 `text/line-scan.ts` 与 `text/inline-scan.ts`**：frontmatter、围栏 / 缩进代码块、GFM 表格、行内代码与已有 `$…$` 一律不碰；**公式的识别与配对也只有一份**（inline-scan 的 `readInlineMath` / `dollarPositions` / `mathRanges` / `mathOpaqueLines`），别在模块里另写扫描 —— 行级消费者问"这行能不能碰"一律用 `mathOpaqueLines`。
- **不替作者补，也不替作者删**：排版只做规则明说的事（`~`、`-` 两边不加空格靠"不进符号表"实现，已有的空格不动；微分算子前的薄空格不自动补）。想加"补全式"规则先问清楚。
- **没有改动就返回原内容**：`tasks.ts` 据此跳过写盘（各排版函数都遵守这条）。
- **单一数据源**：设置面板 = `settings/fields/`；规则出处 = `rule-registry.ts`；受管图片格式 = `image/constants.ts`（另一张更宽的表在 `image/links.ts`，刻意不合并）。
- **`src/text/` 不 import obsidian**：测试用 `test/obsidian-stub.mjs` 替身跑，这样才能脱离 Obsidian 验证幂等。
- **导出符号、命令 ID、设置字段名都是稳定接口**：改名要同步 `rule-registry.ts` 与测试。

## Git workflow

- Branch naming: 纯版本号，不带后缀（`1.3.5`，不要写 `1.3.5更新`）；tag 同样只用版本号，不带 `v`
- CI (`.github/workflows/lint.yml`): runs on push/PR, tests Node 20.x and 22.x — `npm ci` → `npm run build` → `npm test` → `npm run lint`
- Lint pins `eslint-plugin-obsidianmd` to the version the community-plugin review uses — keep it current, or the review will report findings the local lint misses
- `version-bump.mjs` reads `npm_package_version`, writes `manifest.json` and `versions.json`
- Releases: tag must match `manifest.json` version (no leading `v`); attach `main.js`, `manifest.json`, `styles.css`
- Release automation (`.github/workflows/release.yml`): pushing the version tag runs `npm ci` → `npm test` → `npm run build`, checks the tag against `manifest.json`, generates [artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations) for the three assets, and creates the release. Do not create the release by hand — a hand-made release has no attestations, which the plugin review flags

## 提交分支到 GitHub 时的自动化流程

当用户**明确要求**提交分支到 GitHub 时（例如 "提交到github"、"push到github"、"推送到远程"等），才执行以下步骤。**严禁在用户未明确要求时自动提交或推送。**

1. **从分支名提取版本号**：分支名就是纯语义版本号，如 `1.3.5`（`1.3.4更新` 这类后缀是旧习惯，不再沿用）。

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
