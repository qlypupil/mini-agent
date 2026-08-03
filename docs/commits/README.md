# Commit 逐步实现详解

本目录按照 [commit-history.md](../commit-history.md) 的顺序，为项目早期 34 个功能提交分别提供一篇实现说明，并继续收录后续设计文档。

## 阅读约定

- 文件编号 `01`～`34` 与 `commit-history.md` 的章节编号一一对应；`35` 起用于后续设计与实现说明。
- `01`～`34` 的短 Commit Hash 记录在索引与正文中，均可通过 `git show <hash>` 核对原始实现。
- 每篇文档描述的是该提交完成时的代码状态，不使用当前代码替代历史实现。
- “后续演进”用于说明之后发生的变化，不表示当前提交已经具备后续能力。
- 简单的依赖或命名提交保持紧凑；涉及状态、工具、安全和 Context 的提交会展开关键流程与边界。

## 文档目录

| 序号 | Commit | 主题 | 详细说明 |
| --- | --- | --- | --- |
| 1 | `015c97e` | 初始化 Node TypeScript 与 Jest 开发环境 | [01](./01-project-foundation.md) |
| 2 | `e3d8185` | 添加 LangChain 依赖 | [02](./02-langchain-dependencies.md) |
| 3 | `b826336` | 添加 Agent CLI 与 Moonshot 集成 | [03](./03-agent-cli-moonshot.md) |
| 4 | `a36d2e8` | 支持配置 Moonshot API 地址 | [04](./04-moonshot-base-url.md) |
| 5 | `47a7f8b` | 添加 Agent 会话记忆 | [05](./05-in-process-memory.md) |
| 6 | `08710be` | 拆分 Agent CLI 命令定义 | [06](./06-cli-command-split.md) |
| 7 | `6031d91` | 支持 ESC 取消流式响应 | [07](./07-escape-cancellation.md) |
| 8 | `10611a3` | 统一 Agent 工具与终端输入 | [08](./08-tools-and-terminal-input.md) |
| 9 | `847adab` | 添加安全文件读取工具 | [09](./09-read-file-tool.md) |
| 10 | `ca73113` | 添加安全文件写入工具 | [10](./10-write-file-tool.md) |
| 11 | `fa286a5` | 添加安全命令执行工具 | [11](./11-exec-tool.md) |
| 12 | `48d945f` | 添加受限 JavaScript 执行工具 | [12](./12-run-js-tool.md) |
| 13 | `b5ff031` | 接入实时搜索与本机时间工具 | [13](./13-realtime-tools.md) |
| 14 | `b58df1e` | 添加安全网页抓取工具 | [14](./14-web-fetch-tool.md) |
| 15 | `ffc4664` | 接入 Agent Skills 与按需加载 | [15](./15-agent-skills.md) |
| 16 | `83e1334` | 打包内置 Skills 并限制 npm 发布内容 | [16](./16-package-skills.md) |
| 17 | `af2db79` | 重构入口并添加 Python 工具 | [17](./17-run-py-and-entry-refactor.md) |
| 18 | `0ba7941` | 内置完整 skill-creator 资源 | [18](./18-skill-creator-assets.md) |
| 19 | `0924ab6` | 将包名与 CLI 重命名为 termclaw | [19](./19-termclaw-rename.md) |
| 20 | `71304a8` | 优化终端配色并添加欢迎屏 | [20](./20-cli-colors-banner.md) |
| 21 | `7ace0c8` | 使用 SQLite 持久化会话记忆 | [21](./21-sqlite-checkpointer.md) |
| 22 | `63c5593` | 支持通过 `/new` 开启新会话 | [22](./22-new-session-command.md) |
| 23 | `d20145e` | 添加 `/sessions` 会话列表命令 | [23](./23-sessions-command.md) |
| 24 | `f77ed9c` | 支持 `/rewind` 恢复历史会话 | [24](./24-rewind-command.md) |
| 25 | `965402a` | 使用终端表格展示会话列表 | [25](./25-session-table.md) |
| 26 | `e8ce501` | 显示 Context 用量并提示新会话 | [26](./26-context-usage.md) |
| 27 | `c475136` | 使用 StateGraph 手动管理 Context | [27](./27-context-stategraph.md) |
| 28 | `2ffc47f` | 自动 Context 压缩与模型切换 | [28](./28-auto-compression-model-switch.md) |
| 29 | `ed2840d` | 将自动压缩编排移入 Agent 层 | [29](./29-compression-agent-layer.md) |
| 30 | `b76f541` | 添加 `/compact` 手动压缩命令 | [30](./30-compact-command.md) |
| 31 | `57bd4aa` | 统一 Tool 错误协议 | [31](./31-tool-error-protocol.md) |
| 32 | `2fd6681` | 持久化超大 Tool 输出 | [32](./32-large-tool-output.md) |
| 33 | `668d020` | 简化历史 ToolMessage | [33](./33-tool-message-simplification.md) |
| 34 | `e4a8638` | 增加模型请求消息硬上限 | [34](./34-message-hard-limit.md) |
| 35 | `4772571` | 添加长期记忆创建工具 | [35](./35-memory-create-tool.md) |
| 36 | 待提交 | 添加长期记忆全文索引 | [36](./36-memory-full-text-index.md) |

## 核对方式

每篇文档可通过以下命令与 Git 历史交叉检查：

```bash
git show --stat <commit>
git diff <commit>^ <commit>
git show <commit>:<path>
```

`commit-history.md` 保留简明时间线，本目录负责解释问题、方案、关键代码、验证和当时的限制。
