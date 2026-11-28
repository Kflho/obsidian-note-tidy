# data：中间产物

data 目录放**可以重新生成的中间产物**，与源码（`src/`）、交付包（`bin/exports/`）、参考资料
（`bin/reference_docs/`）分开：

| 路径 | 谁写 | 说明 |
| --- | --- | --- |
| 日志 / 临时结果 | 按需 | 执行分析、对照实验时的中间结果 |

测试已迁到 `kf-development-project/obsidian-note-tidy-test`，本仓不再生成 `data/test-build/`。

除本 README 外全部被 `.gitignore` 忽略。`package.json` / `package-lock.json` / `tsconfig.json` /
`manifest.json` / `versions.json` **不放在 data 目录**：配置文件与锁文件属于 npm / tsc / Obsidian，
工具固定从仓库根读取（见 `CLAUDE.md` 的「目录职责」）。
