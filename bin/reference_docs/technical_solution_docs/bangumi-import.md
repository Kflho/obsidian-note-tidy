# Bangumi 讨论页排版 + 网页导入：设计记录

## 目标

1. 把 Bangumi（bgm.tv）讨论页复制出来的纯文本排成和手写笔记一致的样子；
2. 给一个命令：输入讨论页网址，抓回页面，直接排好版插进当前笔记；
3. 去掉"哪些部分"必须可配置，形态与 QQ / 微信 聊天记录那套开关一致。

## 分两层，纯函数负责排版

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 解析 + 排版（纯） | `src/text/bangumi.ts` | `parseBangumiText`、`formatBangumiLog`、`looksLikeBangumiLog`、`formatBangumiPosts`、`parseBangumiPage`、`parseBangumiUrl` |
| 抓网页 + 写回 | `src/ui/bangumi-import-modal.ts` + `src/tasks.ts` | `requestUrl` 拉 HTML、弹窗收网址、把结果插进当前编辑器 |

`src/text/` 不许 import obsidian，所以抓取在 UI / tasks 层；HTML 解析用正则而不是
`DOMParser`，这样 `npm test`（Node）能直接拿页面快照当夹具。

## 输出形态

```markdown
**[KFLhoTAT](https://bgm.tv/user/kflhotat)**
<正文>

**[Letheward](https://bgm.tv/user/703986)**
<正文>
```

- 用户名加粗；有主页地址时带链接（纯文本粘贴没有地址，只加粗）；
- 签名保留在名字后面的圆括号里（可关）；
- 楼层、时间默认不输出（可分别打开，用 `#3 · 2025-09-15 20:26` 的形式，
  **不带秒**，避免被 QQ 聊天记录那套时间戳识别误伤）；
- 正文保留段首空格、表情；引用行 `某人 说: …`（复制品里没有引号）转成
  `> “**某人** 说：…”`，引用下方补一个空行（保留原本页面的双引号；空行用于避免引用块显示异常）；
- 块与块之间一个空行。

## 图片与视频

网页导入时由设置里的 `bangumiImageMode` 决定：

| 模式 | 行为 |
| --- | --- |
| `link`（默认） | 图片 / GIF / 视频全部保留远程链接，不联网下载 |
| `import` | 静态图片（png / jpg / webp / bmp / heic）下载进仓库附件夹，换成内部 `![[…]]`；GIF、视频、iframe 仍保留链接 |

收图复用 `importImageBytes` 的命名 / 转格式 / 预留逻辑（与「粘贴图片」、外部路径导入同一条路），
没有另写一套落盘规则。同一 URL 在同一篇里只下载 / 落盘一次，重复出现直接复用链接；下载失败的图片保留原链接，
不影响其余楼层；写回失败时用 `discardImportedFiles` 回滚本次新建的图片。不同 URL 但内容相同的图片，
交给现有的重复图片合并功能处理；GIF / 视频不入库，所以重复表情包不会产生副本。

## 空行

- **楼层内部段落间**：`bangumiBlankLineWithinPost`，默认关 —— 同一楼层里的多个段落收成单换行；
- **不同楼层之间**：`bangumiBlankLineBetweenPosts`，默认开 —— 楼层之间恰好一行；
- **用户名与正文之间**：固定单换行，不留空行。

引用行现在用双引号标出，不再依赖引用块，因此也没有“引用块后的空行”这一层。

## 标题

网页导入时由 `bangumiTitleMode` 决定：

| 模式 | 行为 |
| --- | --- |
| `none`（默认） | 不写入标题，也不改文件名 |
| `heading` | 在正文前插入 `## 标题`，文件名不变 |
| `rename` | 用安全化后的标题重命名当前文件；重名追加序号，不改其它文件 |

标题只在网页导入时处理；纯文本粘贴仍按原来的"标题只是复制品前缀"丢弃。重命名走 Obsidian 的
`fileManager.renameFile`，由它更新仓库内链接。

## 去掉什么

| 内容 | 默认 | 开关 |
| --- | --- | --- |
| 楼层头 `#N - 日期 时间` | 去掉 | `bangumiShowFloor` / `bangumiShowTime` 打开后进头部 |
| 折叠 `...`、`回复` 控制行 | 去掉 | 无需开关（纯结构） |
| 贴贴计数（块尾纯数字） | 去掉 | `bangumiStripReactions` 关掉时保留 |
| `N 回复` / `收集` / `贴贴` / `顺序` | 去掉 | 同上（都是页面控件） |
| 表情 `(bgm38)` / `img.smile` | 保留 | `bangumiStripSmiles` 打开后删掉 |
| 签名 | 保留 | `bangumiShowSignature` 关掉后删掉 |
| 用户名链接 | 保留 | `bangumiLinkUsers` 关掉后只加粗 |

## 网页导入

- 入口：命令 `import-bangumi-topic`（命令面板）；弹窗里填网址；
- 支持 `bgm.tv` / `bangumi.tv` 的 `group/topic/<id>`，以及同结构的
  `subject/topic/<id>`；
- `requestUrl` 抓 HTML → `parseBangumiPage` → `formatBangumiPosts` →
  按 `bangumiImageMode` 处理图片 → 再跑一遍 `formatNoteText`（空格 / 缩进 / 公式等统一）→ 插到当前光标；
- 分页：`extractBangumiPageUrls` 从页面里的 `?page=N` / `?p=N` 链接继续抓后续页（同 host、同 path、去重、
  排除当前页；上限 50 页）；后续页失败时保留前面已抓到的内容并提示；
- 只在用户点命令、填网址并确认时联网；失败给 Notice，不静默；
- 不写盘：`editor.replaceSelection` 插进当前文档，撤销一次即可回退。

## 幂等

排版后的文本没有 `#N - 日期` 头，`formatBangumiLog` 再跑一遍原样返回；
网页导入那条路是"先解析成结构化帖子再排版"，更不会二次解析自己的输出。

## 测试

- `test/bangumi.test.ts`：纯文本样例（覆盖贴贴 / 子回复 / 签名 / 引用）、
  各种开关、幂等、`looksLikeBangumiLog`；
- 同一份测试读 `test/fixtures/bangumi_group_topic.html`（从页面快照裁的前几楼），
  核对 `parseBangumiPage` 的楼层、用户名、链接、表情与引用；
- `npm test` / `npm run lint` / `npm run build` 三道闸门。
