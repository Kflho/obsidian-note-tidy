# CLAUDE.md

Note Tidy（`note-tidy`）：Obsidian 桌面插件，负责图片整理与文本排版。

## 功能

- 图片：外部路径图片导入为 `![[...]]`、乱码改名、设置尺寸、跨文件夹引用、清理未引用图片。
- 文本：纯文本公式转 `$…$`、LaTeX 排版、中英/数字/公式空格、标点宽度、行首缩进、块标记、列表编号、标题级别、标签归位与排序、板块排序、QQ/微信聊天记录排版。
- 粘贴：Ctrl+V 只排版粘贴范围，输出纯内容（不含用户名、日期、时间，消息间不空行）；编辑器右键「粘贴为聊天记录」输出完整格式。
- 快速修复：一条命令完成「收外部图片 + 修整篇排版」；粘贴自动处理分收图、排版、套尺寸三个开关，只改粘贴范围。
- 复制图片：把图片文件写入系统剪贴板，可粘贴到文件夹；选区含文字时写图文 HTML，聊天窗口可粘贴「文字 + 图片」；可选 Ctrl+C 接管。
- 右键菜单：图片、笔记、文件浏览器三个菜单；只插入本插件项，可逐项开关。
- 状态栏：可选显示当前选区图片数。

## 命令

```bash
npm --prefix src install     # 安装依赖（npm 工程根在 src/）
npm --prefix src run dev     # 开发监听，重建后同步到插件目录
npm --prefix src run build   # tsc + esbuild，输出 bin/exports/ 并同步插件目录
npm --prefix src run deploy  # 只复制 main.js / manifest.json / styles.css
npm --prefix src run lint    # ESLint
npm --prefix src run version # 更新 manifest.json 与 versions.json
```

测试不在本仓：`kf-development-project/obsidian-note-tidy-test`（私有测试仓，`src/`、`bin/`、`node_modules/` 用 junction 指回本仓）。

```bash
cd <test-repo>
npm test
```

## 仓库与部署

- 源码仓库：本仓（开发库，已移除 `origin`）。
- 测试仓库：`kf-development-project/obsidian-note-tidy-test`。
- 插件目录：`<vault>/.obsidian/plugins/note-tidy/`，只放运行文件：`main.js`、`manifest.json`、`styles.css`、Obsidian 自己写的 `data.json`。
- 构建：`src/scripts/esbuild.config.mjs` 把 `src/main.ts` 打成 `bin/exports/main.js`；`build` 再复制根 `manifest.json` 与 `src/styles.css`。
- 部署：`src/scripts/deploy.mjs` 读 `OBSIDIAN_PLUGIN_DIR`，未设置则读根目录 `deploy.local.json`；目录不存在时跳过，不阻断构建。
- 桌面端：`isDesktopOnly: true`；文件读写依赖 Node `fs`。

## 目录

| 路径 | 放什么 |
| --- | --- |
| `src/` | 插件源码与 npm 工程：`text/`、`image/`、`ui/`、`settings/`、`scripts/` |
| `src/scripts/` | 构建、部署、发版、lint 配置 |
| `bin/exports/` | 构建交付包：`main.js` + `manifest.json` + `styles.css`；`README` 说明来由 |
| `bin/reference_docs/` | 调研、设计记录、`rule-registry.ts` 与生成的规则登记表 |
| `dev/` | 本机草稿、日志（gitignore） |
| `data/` | 中间产物（gitignore） |
| 根 | `manifest.json` / `versions.json` 必须留根；`README.md` / `LICENSE` / `CLAUDE.md` 入口文档 |

## 架构

- `main.ts`：生命周期与装配；`commands.ts`：命令注册；`tasks.ts`：命令、菜单、弹窗共用的任务编排；`batch.ts`：互斥锁、通知屏蔽、进度与结果汇报。
- `text/`：纯函数排版。`pipeline.ts` 固定顺序：行首缩进 → 标记 → 聊天记录 → Bangumi → 列表编号 → 标题级别 → 智能公式 → 公式 → 空格 → 标签 → 板块排序；迭代到不动点，最多 5 轮。
- `image/`：链接解析、命名、外部图片导入、格式转换、未引用清理、乱码改名、尺寸、整理、去重、复制与剪贴板。
- `ui/`：图片/笔记/文件菜单注入与管理、复制快捷键、粘贴监听、弹窗、状态栏。
- `settings/`：`model.ts` 字段与默认值；`fields/` 字段表；`tab.ts` 由字段表生成设置面板（1.13+ 声明式 / 1.13 以下手写 DOM）。

## 硬约束

1. **排版幂等**：每个排版函数跑两遍结果一致；整条流水线迭代到不动点。
2. **保护区**：frontmatter、围栏/缩进代码块、GFM 表格、行内代码、已有 `$…$` 不碰；公式识别只在 `text/inline-scan.ts`，行级判断用 `mathOpaqueLines`。
3. **不替作者补删**：只做规则明说的事；没有改动就返回原内容，`tasks.ts` 据此跳过写盘。
4. **图片名全库唯一**：新名字只由 `image/naming.ts` 的 `generateUniqueTargetPath` 生成；调用方必须传全库文件名表。
5. **单一数据源**：设置面板字段在 `settings/fields/`；规则出处与测试映射在 `bin/reference_docs/rule-registry.ts`；受管图片格式在 `image/constants.ts`。
6. **稳定接口**：命令 ID、导出符号、设置字段名不改；改名要同步规则登记表、测试与迁移。
7. **`src/text/` 不 import `obsidian`**：纯函数可在测试仓脱离 Obsidian 跑。

## 复制图片

- 要能在文件夹里粘出文件，必须写 `CF_HDROP`；Electron 不暴露该格式，Windows 走 `powershell.exe` 的 WinForms `DataObject`，macOS 走 `osascript`。
- PowerShell 用 `powershell.exe -NoProfile -NonInteractive -File`（STA）；不要用 `pwsh`。
- 图文混排写 `CF_HTML` + `CF_UNICODETEXT`，不写文件列表；图片内嵌 data URI，超限才退回 `file:///`；混排不放位图。
- 纯图片写文件列表，单张可加位图；不写文本格式，避免部分程序粘贴两次。
- 脚本内容是常量，写到临时目录固定名，不重写；用户内容走旁边 JSON/HTML/TXT 数据文件，路径 base64；插件加载时空跑一次预热；复制请求排队。
- Windows 写 HTML 用 Win32 `SetClipboardData`，打开 → 清空 → 写入整段重试；`CF_HTML` 偏移按字节、补零到 10 位。

## 粘贴与菜单

- 粘贴自动处理只作用于刚粘贴的范围：`paste-watch.ts` 登记起点，`editor-change` 后用 `fixPastedRange` 一次写回；不改整篇，不写盘。
- 三开关：收图 `autoTransferImagesOnPaste`、排版 `autoFixChatLogOnPaste`、套尺寸 `autoSetImageSizeOnPaste`；全关时 `pasteFixPlanFrom` 返回 `null`。
- Ctrl+V 用 `plainContentOptions`：不显示用户名/日期/时间，消息间不空行，保留图片顺序；右键「粘贴为聊天记录」用完整头部格式。
- 接管图片粘贴：`takeOverImagePaste`，检查 `evt.defaultPrevented`；自己的粘贴先存图再写链接，随后走同一趟范围处理。
- 异步期间正文被改或写入失败时，删掉本趟导入的文件，避免孤儿附件。
- 菜单只插入本插件项：`menu-injector.ts` 记录/过滤/插入；隐藏分 `addItem` 时与显示后 DOM 两道；作用域留 30 秒；菜单对象可能复用，用本次编号区分；本插件项打 `OWN_MENU_ITEM` 记号。

## 改动指南

- 加/改排版规则：实现纯函数 → 接入 `pipeline.ts` → 设置字段与默认值 → `tasks.ts` 选项与结果提示 → `rule-registry.ts` 登记 → 测试仓用例与 `entryPoints`。
- 加设置项：只改 `settings/model.ts` + `settings/fields/`；测试检查每字段一条定义。
- 加命令/菜单项：`commands.ts` + `ui/menus.ts`；图片/笔记菜单项在 `image-menu.ts` 登记 `OWN_ITEMS` / `OWN_ITEM_SCOPES` / `OWN_ITEM_COMMANDS`，设置开关接到管理面板。
- 改行为就改测试：测试仓里 `npm test`；新增或修改规则时同时补守护用例。

## 发布

- 本仓是开发库；GitHub `Kflho/obsidian-note-tidy` 是发布库，只收 `manifest.json`、`versions.json`、`LICENSE`、两个 README、release workflow、`bin/exports/main.js`、`bin/exports/styles.css`。
- 发布走 `kf-personal-development` 的 `release.py push --role user-facing`；不要从本仓 `git push` 发布库，也不要把发布库当源码仓 merge/rebase。
- 发布库 remote 用 SSH：`ssh://git@ssh.github.com:443/Kflho/obsidian-note-tidy.git`。
- 流程：`npm run build` → `release.py verify` → `release.py push --role user-facing` → 在发布库打版本 tag（不带 `v`）→ release workflow 构建并挂三个资产。
- 不手动 `gh release create`；手动建的 release 没有 attestation。

## 参考

- 规则与测试映射：`bin/reference_docs/rule-registry.ts`、`bin/reference_docs/规则登记表.md`。
- 用户文档：`README.md`、`bin/exports/README*.md`。
- 测试仓：`kf-development-project/obsidian-note-tidy-test`。
