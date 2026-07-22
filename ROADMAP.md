# Roadmap

## 当前阶段

项目初始化完成，等待业务功能定义。

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
- 接入 Commander.js，并注册 `miniagent` 全局 CLI 命令。
- 将 Commander 命令定义抽离至 `src/agent/command.ts`。
- 抽取 CLI readline 接口创建函数。
- 支持在 Agent 流式回复期间通过 ESC 取消请求。
- 新增含 GitHub 提交直达链接的历史说明文档，记录各阶段的关键实现与验证。
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

## 进行中

- 无。

## 待办

- 待确认首个业务功能范围。

## 阻塞

- 无。

## 最近验证

- `pnpm typecheck`、`pnpm build` 与 `pnpm start` 通过。
- 构建产物已完成 Moonshot 集成测试：`hi` 与 `who are you` 均收到正常流式回复。
- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过。
- MemorySaver 集成测试通过：同一线程内保存并正确取回用户名 `Pupil`。
- `miniagent --help`、`miniagent --version` 与交互启动验证通过。
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
- 构建后恢复 `dist/agent/cli.js` 可执行权限，保证 `npm link` 的 `miniagent` 软链接可运行。
