# bin/exports：交付包（构建生成）

这个目录是**给 Obsidian 安装 / GitHub Release 用的三件套**，由构建生成，不是源码：

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `main.js` | `npm run build`（esbuild） | 唯一真正的构建产物 |
| `manifest.json` | 构建时从仓库根复制 | 根上那份是**源**（版本号、描述是手改的；Obsidian 校验 / 社区目录固定读根路径） |
| `styles.css` | 构建时从 `src/styles.css` 复制 | `src/styles.css` 是**源**；插件运行时从插件目录读这个名字 |

- `bin/exports/` 自己**不是**插件目录：安装时把这三件套放进
  `<vault>/.obsidian/plugins/note-tidy/`；本机同步由 `src/scripts/deploy.mjs` 做
  （`npm run build` / `npm run dev` 后自动）。
- 根上的 `manifest.json` 不能删：Obsidian 社区插件校验固定读根路径；删了 `npm run build`
  也复制不出交付包。
- `package.json`、`package-lock.json`、`tsconfig.json`、`node_modules/` 跟源码一起在 `src/`
  （npm 工程根就是 `src/`，用 `npm --prefix src ...`）；`manifest.json` / `versions.json` 是
  Obsidian 的配置与版本映射，必须留在仓库根（见 `CLAUDE.md` 的「目录职责」表）。
- 中间产物（日志、临时结果）放 `data/`，与交付包分开。
