# Roadmap

## 当前阶段

终端 Agent 基础能力、Context 管理、模型切换与长期记忆创建流程已完成，下一阶段进入长期记忆检索设计。

## 已完成

- 建立 pnpm、TypeScript 与 Jest 基础开发环境。
- 配置类型检查、构建和单元测试脚本。
- 将 TypeScript 模块解析策略迁移至 `NodeNext`。
- 将 TypeScript 升级至 6.0.3，并显式加载 Jest 测试类型。
- 接入 dotenv，并提供 `.env.example` 本地环境变量模板。
- 接入 ts-node 开发启动脚本与 zod 运行时校验依赖。
- 修正 LangChain 工具定义的 `schema` 字段兼容性。
- 补充 Agent CLI 的交互流程与 readline 使用注释。
- 配置构建后的 Agent CLI 启动脚本。
- 支持通过环境变量配置 Moonshot API Base URL。
- 接入 LangGraph MemorySaver，实现同一进程内的会话记忆。
- 接入 Commander.js，并注册 `termclaw` 全局 CLI 命令。
- 将 Commander 命令定义整合进 `src/agent/cli.ts`，与外部 CLI 入口保持一致。
- 抽取 CLI readline 接口创建函数。
- 支持在 Agent 流式回复期间通过 ESC 取消请求。
- 新增含 GitHub 提交直达链接的历史说明文档，记录各阶段的关键实现与验证。
- 为 `docs/commit-history.md` 中 34 个历史提交分别新增 `docs/commits/01`～`34` 实现详解，并建立双向索引，记录各提交当时的问题、方案、边界、验证与后续演进。
- 补充近期 Agent 与 CLI 关键配置、取消机制和命令工厂注释。
- 将 search 工具抽离至 `src/agent/tools`，并补充同目录单元测试。
- 新增 tools 注册表，集中维护工具的名称、描述和输入 schema。
- 修复 ESC 取消机制导致的 readline 中文输入重复回显。
- 新增只读当前工作目录的 `read_file` 工具及安全边界测试。
- 补充 `read_file` 路径边界、敏感文件拦截和文本读取注释。
- 新增受限当前工作目录的 `write_file` 工具及安全边界测试。
- 补充 `write_file` 目录边界、符号链接和模型写入边界注释。
- 新增只读命令白名单的 `exec` 工具及安全边界测试。
- 补充 `exec` shell 隔离、超时、输出限制和参数解析注释。
- 新增受限 Node 权限模型的 `run_js` 工具及隔离测试。
- 新增 Tavily `web_search` 工具及 SDK 调用单元测试。
- 移除返回固定结果的示例 `search` 工具，避免与 Tavily 搜索能力冲突。
- 新增读取本机日期、时间与时区的 `current_time` 工具，处理“今天”和“现在”问题。
- 新增受限公网访问的 `web_fetch` 工具及 URL、响应大小与网络失败测试。
- 接入 Agent Skills 发现、模型目录披露与按需 `load_skill` 激活机制。
- 默认模型切换为通用 Agent 模型 `kimi-k2.6`。
- 构建时复制内置 `SKILL.md` 到 `dist`，并限制 npm 发布包内容，支持全局安装运行。
- 通过 `src/agent/skills/index.ts` 与 `src/agent/tools/index.ts` 集中维护 skills / tools 注册入口。
- 新增本机 `python3` 执行的 `run_py` 工具及单元测试。
- 将 npm 包名与全局 CLI 命令重命名为 `termclaw`，避免与已占用的 `miniagent` 冲突。
- 使用 chalk 为 CLI 提示符、工具状态与 skill 诊断日志上色，提升终端可读性。
- 启动时用 figlet / boxen 展示包名、版本、描述、作者、文档与快捷键说明。
- 将会话记忆迁移至 SQLite checkpointer，持久化到当前目录 `.data/checkpointer.db`。
- CLI 每次启动生成新的会话 ID，隔离不同终端会话的 SQLite 历史。
- 新增可扩展的交互命令分发器，`/new` 可在同一 CLI 进程中开启新会话。
- 新增 `/sessions` 命令，只读列出 SQLite 中最近 20 个会话及其最后用户输入。
- 新增 `/rewind <thread_id>` 命令，校验会话存在后恢复历史会话。
- 使用 `cli-table3` 渲染 `/sessions` 会话列表，提升终端表格可读性。
- 每轮成功回复后显示最终模型请求的 context token、模型上下文上限与占比。
- Context 用量达到 80% 时警告即将压缩 Context 可能丢失信息，并建议通过 `/new` 开启新会话。
- 将 Agent 执行迁移至自定义 LangGraph StateGraph，显式维护 `apply_context → model_request → tools` 循环。
- 新增 `/context` 手动管理命令，支持查看、替换、删除、摘要、载入摘要文件与修改预览。
- 支持 Context 修改仅应用下一轮、永久写入当前会话或基于修改结果创建分支会话。
- Context 摘要使用不绑定 checkpointer 的独立模型调用，并保护 AI 工具调用与 ToolMessage 的完整配对。
- 修复 `once` Context 在模型请求失败或取消时被提前消费的问题，仅在本轮 Agent 请求成功结束后清除暂存修改。
- 新增 80% Context 自动压缩：保留最近 6 条及完整工具消息组，使用独立模型调用生成累计摘要，并在 SQLite checkpointer 之外按 thread 持久化摘要、已压缩消息和压缩次数。
- 自动压缩从下一轮模型请求开始通过 StateGraph runtime context 生效；压缩失败保留原历史并允许重试，累计达到 3 次时继续压缩并强烈建议 `/new`。
- 将 `src/agent` 平铺模块按 `runtime`、`cli`、`storage`、`skills` 与 `tools` 职责归档，顶层仅保留 Agent API、CLI 入口与环境变量加载。
- 新增 Kimi、DeepSeek 模型注册表与 `/model` 本地命令，支持在当前 CLI 进程中查看和切换后续对话、Context 摘要及自动压缩所用模型，不修改 SQLite 历史。
- DeepSeek 默认接入官方 OpenAI 兼容接口与 `deepseek-v4-flash`，使用 1M context 上限并关闭 thinking mode，保持现有工具调用循环兼容。
- 裸 `/model` 与 `/context` 支持无依赖的方向键交互菜单；保留完整命令和非 TTY 回退，并支持 Context 参数输入及应用方式二级菜单。
- 自动压缩判定恢复使用模型正常 Context 上限：Kimi 为 262,144，DeepSeek 为 1,048,576。
- 将自动 Context 压缩的阈值判断、执行和失败降级收归 `agent.ts`，`cli.ts` 只调用 Agent API 并展示压缩状态。
- 新增 `/compact` 本地命令，可随时调用 Agent 核心的 `compressContext` API 压缩当前会话，并在下一轮对话中使用结果。
- 统一 Tool 错误协议：工具失败时抛出异常，由 LangGraph 转换为带错误状态的 `ToolMessage`，避免 CLI 将失败误报为完成。
- 统一 Tool 调用日志：由 `runtime/graph.ts` 在实际调用前只打印 Tool 名称，移除 Tool 内部及 CLI 成功状态的重复日志，同时保留失败原因提示。
- 将 CLI 的 `AI:` 标签延迟到首个用户可见正文 token，避免纯 Tool 调用、空回复、请求失败或取消时显示空的 AI 回答标签。
- 新增 Tool 大输出持久化：超过 50,000 字符的字符串结果写入 `tool_output/`，模型与 checkpointer 仅接收文件路径和前 2000 字预览，并保留原 `ToolMessage` 调用元数据。
- 新增历史 ToolMessage 请求前简化：仅在模型输入投影中将较早结果替换为工具使用标记，保留当前轮、最近 3 条历史结果及所有 `read_file` 结果，不修改其他消息或 SQLite checkpointer。
- 新增模型请求消息数量硬上限：聊天历史超过 300 条时仅向模型投影最近消息，已有累计摘要时固定保留摘要，并删除跨越裁剪边界的不完整 Tool 调用组，不修改 SQLite checkpointer。
- 新增独立 SQLite 长期记忆数据库：Agent 初始化时幂等创建 `memory` 表和 `updated_at` 自动更新时间触发器，不修改 LangGraph checkpointer 数据库。
- 新增 `docs/commits/35-memory-create-tool.md`，明确长期记忆创建 Tool 的职责拆分、运行时会话注入、存储规则、模型决策边界、测试与验收标准。
- 新增 `memory_create` Tool：模型可创建 `fact`、`event`、`preference`、`skill` 四类长期记忆，`session_id` 仅从 LangGraph 运行时注入，结果写入独立 SQLite 数据库。
- 新增长期记忆写入存储层、模型决策规则及临时数据库测试，不修改或裁剪现有 checkpointer 历史。

## 进行中

- 无。

## 待办

- 设计 `memory_search` 及请求前召回流程；当前创建的长期记忆尚不会自动注入模型 Context。

## 阻塞

- 无。

## 最近验证

- `pnpm typecheck`、`pnpm build` 与 `pnpm start` 通过。
- 构建产物已完成 Moonshot 集成测试：`hi` 与 `who are you` 均收到正常流式回复。
- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过。
- MemorySaver 集成测试通过：同一线程内保存并正确取回用户名 `Pupil`。
- `termclaw --help`、`termclaw --version` 与交互启动验证通过。
- ESC 集成测试通过：流式响应在 3 秒后被取消，CLI 恢复到下一轮输入。
- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过（2 个测试套件、3 条测试）。
- `pnpm dev` 中文天气输入集成测试通过，用户输入仅回显一次。
- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过（3 个测试套件、7 条测试）。
- `write_file` 单元测试与真实 Agent 集成测试通过（4 个测试套件、13 条测试）。
- `exec` 单元测试与真实 Agent 列出 `src` 集成测试通过（5 个测试套件、18 条测试）。
- `run_js` 单元测试已覆盖多行异步代码、复杂数据处理、语法错误、运行时异常和特殊字符；`pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过（6 个测试套件、27 条测试）。
- Tavily `web_search` 使用原生 `TavilySearch` 工具以兼容 Moonshot 的工具循环；单元测试、类型检查与构建通过，真实新闻搜索获得最终摘要。
- 移除示例 `search` 工具后，`pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过（6 个测试套件、27 条测试）；构建产物仅注册 `web_search`，不再注册旧 `search`。
- `current_time` 单元测试、类型检查与构建通过（7 个测试套件、28 条测试）；真实 CLI 验证返回本机日期 `Saturday, July 18, 2026`。
- `web_fetch` 单元测试、类型检查与构建通过（8 个测试套件、34 条测试）；真实 Agent 抓取并概述 `https://www.mianshipai.com/` 成功。
- Skills 发现、目录生成和 `load_skill` 单元测试通过（11 个测试套件、39 条测试）；默认模型切换为 `kimi-k2.6` 后 CLI 发送 `hi` 并收到正常回复。
- Skills 构建资源复制、运行时专用构建配置与 npm 打包范围调整完成；构建产物可在外部工作目录发现内置 skills，打包预览仅包含运行时文件与 `SKILL.md`。
- 构建后恢复 `dist/agent/cli.js` 可执行权限，保证 `npm link` 的 `termclaw` 软链接可运行。
- skills / tools 注册入口整理后，`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过（11 个测试套件、39 条测试）；构建产物仍发现内置 skills 并注册 `load_skill`。
- `run_py` 单元测试、类型检查与构建通过（12 个测试套件、48 条测试）；真实 `termclaw` 调用 `run_py` 执行 `print(2 + 3)`，返回 `5`。
- 包名与 CLI 重命名为 `termclaw` 后，`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过；`termclaw --help` / `--version` 正常。
- SQLite checkpointer 单元测试、类型检查与构建通过（13 个测试套件、49 条测试）；两次独立 `termclaw` 进程成功保存并恢复 token `cobalt-4729`。
- 每次 CLI 启动生成独立会话 ID；`pnpm test --runInBand`、`pnpm typecheck`、`pnpm build` 与 `termclaw --version` 通过。
- `/new` 交互命令单元测试、类型检查与构建通过（14 个测试套件、55 条测试）；构建产物验证该命令在本地切换会话，不会调用 AI。
- Commander 命令定义合并进 `cli.ts` 后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与构建产物 `termclaw --help` 通过。
- `/sessions` 查询、格式化与命令分发测试通过（15 个测试套件、59 条测试）；构建产物验证输出最近会话表格，未调用 AI。
- `/rewind` 存在性查询与命令分发测试通过（15 个测试套件、61 条测试）；构建产物恢复 `user-session-1` 成功，未调用 AI。
- `cli-table3` 表格渲染后，`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过；构建产物 `/sessions` 显示终端边框表格。
- Context 用量显示的单元测试、类型检查与构建通过（16 个测试套件、67 条测试）；构建产物回复 `hi` 后显示 `1,830 / 262,144 tokens (0.70%)`。
- Context 用量达到 80% 的告警边界测试通过；`pnpm typecheck` 与 `pnpm test --runInBand` 通过（16 个测试套件、69 条测试）。
- 自定义 StateGraph、ContextPatch、Context 会话管理、独立摘要与命令分发测试通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（20 个测试套件、85 条测试）。
- 构建产物通过真实 Moonshot 流式回归，`hi` 正常返回回复并显示 `1,830 / 262,144 tokens (0.70%)`；本地 `/context` 帮助命令未调用 AI 并正确输出全部子命令。
- Agent 目录整理后，`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过（19 个测试套件、85 条测试）；构建产物保持 `dist/agent/cli.js` 入口并可正常显示帮助。
- `once` Context 改为请求成功后确认消费；失败重试回归测试、`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（19 个测试套件、85 条测试）。
- 自动 Context 压缩、累计摘要、工具消息边界、独立缓存及 StateGraph 非持久化投影回归测试通过；`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过（21 个测试套件、95 条测试）。
- Kimi / DeepSeek 动态模型、`/model` 命令、DeepSeek context 上限及 StateGraph runtime 模型覆盖测试通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（22 个测试套件、102 条测试）。构建产物可显示当前 Kimi，未配置 DeepSeek Key 时拒绝切换且不发起模型请求。
- DeepSeek 官方 `/models` 接口返回 HTTP 200；构建产物通过 `/model deepseek` 切换至 `deepseek-v4-flash` 并完成真实流式回复，usage 显示 `2,530 / 1,048,576 tokens (0.24%)`。
- `/model`、`/context` 交互菜单及非 TTY 回退测试通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（23 个测试套件、110 条测试）。构建产物通过伪终端验证方向键模型切换、Context 一级菜单、参数输入、应用方式二级菜单和退出后的 readline 恢复。
- 恢复 Kimi、DeepSeek 正常 Context 上限后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（23 个测试套件、110 条测试）。
- 自动 Context 压缩编排迁移至 Agent 层后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（24 个测试套件、113 条测试）。
- `/compact` 手动压缩命令接入后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（24 个测试套件、116 条测试）；构建产物在空会话中执行 `/compact`，本地返回“没有新的可压缩历史”，未发送普通 AI 对话请求。
- Tool 错误协议统一后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（24 个测试套件、117 条测试）；回归测试确认异常工具结果会生成 `ToolMessage(status: "error")`。
- Tool 调用日志迁移至 Graph 执行节点后，`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（24 个测试套件、117 条测试）；回归测试确认日志只含 Tool 名称并先于 Tool 函数执行。
- `AI:` 标签改为正文首 token 输出后，`pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过（24 个测试套件、117 条测试）；源码检查确认 `aiLabel()` 只在用户可见正文回调中调用。
- Tool 大输出持久化与 Graph 接线回归通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（25 个测试套件、124 条测试），覆盖长度边界、UTF-8 大小、文件名安全、非字符串透传、消息元数据保留及写入失败降级。
- 历史 ToolMessage 简化的纯函数与 StateGraph 非持久化投影回归通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（25 个测试套件、128 条测试），覆盖最近 3 条、`read_file`、工具名称回溯、未知工具、当前轮多工具及 checkpointer 原文保留。
- `docs/commit-history.md` 已补齐自动 Context 压缩、模型切换、手动压缩、Tool 错误协议、超大输出持久化和历史 ToolMessage 简化 6 项提交说明，并将当前结构与后续边界同步至 `668d020`。
- 模型请求 300 条消息硬上限回归通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（25 个测试套件、132 条测试），覆盖数量边界、累计摘要固定保留、Tool 调用组完整性及 checkpointer 历史不变。
- SQLite 长期记忆 Schema 初始化回归通过；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（26 个测试套件、134 条测试），覆盖重复初始化、字段默认值及业务字段更新时自动刷新 `updated_at`；构建产物启动后确认 `.data/memory.db` 中存在 `memory` 表和 `memory_update_updated_at` 触发器。
- 长期记忆创建 Tool 设计文档与 `ROADMAP.md` 状态已完成一致性检查，`git diff --check` 通过；本次仅补充方案文档，未修改运行时代码。
- 历史 Commit 详解文档一致性检查通过：34 篇编号连续，`docs/commits/README.md` 与 `docs/commit-history.md` 各包含 34 个有效详情链接，文件名短 Hash 与正文 Commit 信息一致；`git diff --check` 通过。
- 长期记忆创建 Tool 设计文档已移动至 `docs/commits/35-memory-create-tool.md` 并纳入目录索引；相对链接与项目引用检查通过。
- `docs/commits/` 下 35 篇文档已移除文件名与文档编号的 `00-` 前缀，索引、提交历史与 Roadmap 引用同步更新并完成链接检查。
- 长期记忆创建流程已在 `4772571` 提交；`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过（28 个测试套件、147 条测试），覆盖参数化写入、默认值、Schema 边界、运行时 `thread_id` 注入、精简结果及 Graph/checkpointer 历史保持。
- `docs/commits/35-memory-create-tool.md` 已补齐与前 34 篇一致的 Commit 信息区块，并链接到完整的 `4772571` 实现提交。
