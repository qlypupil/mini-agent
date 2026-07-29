# termclaw

基于 TypeScript 的 Node.js 终端 Agent，使用 pnpm 管理依赖，并通过 Jest 执行单元测试。

## 环境要求

- Node.js 24 或更高版本
- pnpm 11

## 安装

```bash
pnpm install
```

## 环境变量

复制 `.env.example` 为 `.env`，在其中填写本地环境变量：

```bash
cp .env.example .env
```

应用入口会通过 `dotenv` 自动加载 `.env`。`.env` 已被 Git 忽略，禁止提交密钥或 token。

`MOONSHOT_API_KEY` 是必填项；`MOONSHOT_BASE_URL` 可选，未设置时使用 Moonshot 默认地址；`MOONSHOT_MODEL` 可选，默认 `kimi-k2.6`。使用 `web_search` 时还需要配置 `TAVILY_API_KEY`。

每轮 AI 成功回复后，终端会显示最终模型请求的 context token、该模型已知的上下文上限和占比。占比达到 80% 时，CLI 会警告 Context 接近接口上限、可能丢失信息，并建议输入 `/new` 开启新会话。当前只提供告警和手动 Context 管理，不会在 80% 时自动压缩。若兼容网关未返回流式 usage，或模型上限未被内置识别，对应字段会显示“未知”，不会使用不可靠的估算值。

## 会话记忆

Agent 使用 LangGraph SQLite checkpointer 按 `threadId` 保存会话历史。数据库位于当前工作目录 `.data/checkpointer.db`；每次 CLI 启动会创建新的会话 ID，因此不会自动引用上一次启动的对话。聊天过程中输入 `/new` 也会立即创建新的会话 ID，后续消息不会携带当前会话的历史。输入 `/sessions` 可用终端表格只读列出最近 20 个会话的完整 ID、最后用户输入和相对时间；输入 `/rewind <thread_id>` 可恢复列表中的历史会话。`.data/` 已被 Git 忽略。

## Context 管理

Agent 使用自定义 LangGraph `StateGraph`，由 `messages` 保存 checkpointer 中的真实聊天记录，并在 `model_request` 节点决定下一次模型接口实际收到哪些消息。输入 `/context` 可查看完整命令说明：

```text
/context show
/context replace <序号> <新内容>
/context remove <序号或范围>
/context summarize <序号范围>
/context load-summary <序号范围> <txt_path>
/context preview
/context apply once|persist|fork
/context cancel
```

`show` 会列出当前会话中每条消息的序号、短 message ID、角色和内容预览。`replace`、`remove`、`summarize` 与 `load-summary` 只暂存修改；修改不会发送给 AI，也不会立即写入 SQLite。使用 `preview` 检查下一次模型将看到的结果，再选择应用方式：

- `once`：只修改下一次模型请求，SQLite 保留原历史；该轮 AI 回答仍会追加到原历史。
- `persist`：立即将修改后的消息永久写入当前 thread，后续轮次持续使用。
- `fork`：保留原 thread，并使用修改后的消息创建和切换到新 thread。

`summarize` 使用独立模型调用生成纯文本摘要，不绑定当前会话的 checkpointer，因此内部摘要提示不会进入聊天记录。`load-summary` 从当前工作目录内的 UTF-8 文本文件读取已有摘要，并复用文件工具的路径越界与敏感文件限制。摘要会包装为一条 `HumanMessage` 放在所选范围原来的位置。

Context 操作按 message ID 应用，工具调用的 `AIMessage` 与对应 `ToolMessage` 必须作为完整的一组编辑，避免产生模型接口无法接受的消息顺序。`/new` 或成功执行 `/rewind` 时会清除尚未应用的 Context 修改。

## 文件工具

Agent 可以读取或写入当前工作目录及其子目录中的 UTF-8 普通文件。文件工具拒绝绝对路径、`..` 越界、符号链接越界、`.env*` 和 `.git/`，避免模型读取或覆写敏感内容。`write_file` 会创建新文件或完整覆写已有文件，但不会创建缺失的父目录。

`exec` 只允许执行 `ls`、`find`、`rg`、`pwd` 和只读 Git 查询。它不解析 shell 语法，不接受任意命令，并限制单次执行 5 秒、输出 64 KB，避免模型执行删除或其他写入操作。

`run_js` 在 Node 权限模型子进程中执行 JavaScript。子进程不继承项目环境变量，且默认没有文件系统、网络、子进程或 worker 权限；单次执行限制 5 秒、代码 20 KB、输出 64 KB。

`run_py` 使用本机 `python3` 执行 Python 代码。子进程不继承项目环境变量；若未安装 `python3`，会返回明确错误供模型提示用户。单次执行限制 5 秒、代码 20 KB、输出 64 KB。

`web_search` 使用 Tavily 搜索当前网页信息，每次最多返回 3 条通用搜索结果，并附带 Tavily 生成的答案。查询内容会发送给 Tavily API，并消耗对应的 API 配额。

`current_time` 从本机读取当前日期、时间和时区，专门处理“今天”和“现在”问题。新闻、天气、价格和体育赛事等实时信息由 `web_search` 检索，Agent 会基于成功返回的结果作答。CLI 会显示工具的开始、完成或失败状态，便于区分模型未检索与检索失败。

`web_fetch` 只允许抓取公网 HTTP(S) 地址，拒绝本机和内网地址。请求限制为 10 秒、最多 3 次重定向和 1 MB 响应；为避免超出模型上下文，传给 Agent 的文本最多 8 KB。

## Skills

将 Agent Skills 格式的内置 skill 放入 `src/agent/skills/<skill-name>/SKILL.md`。启动时会发现所有有效 skill 的 `name` 和 `description` 并提供给模型；当任务匹配某个 skill 时，模型调用 `load_skill` 才会读取该 skill 的完整 `SKILL.md`。无效 frontmatter 会被跳过并在终端显示警告。

`pnpm build` 会先清理 `dist/`，仅编译运行时源码，再将 skill 资源复制到 `dist/agent/skills`，并恢复 CLI 入口的可执行权限。发布包只包含运行时构建产物和必要文档，因此全局安装后 `termclaw` 不依赖用户当前目录下的 `src/`。

## 源码结构

`src/agent` 只保留 Agent API、CLI 可执行入口和环境变量加载三个顶层文件，其余模块按职责归档：

```text
src/agent/
├── agent.ts              # 模型初始化、Agent API 与流式执行
├── cli.ts                # CLI 可执行入口和聊天循环
├── env.ts                # 环境变量加载
├── runtime/              # StateGraph、Context 变换与 token 用量
├── cli/                  # Banner、交互命令与 /context 命令状态
├── storage/              # SQLite checkpointer 与历史会话查询
├── skills/               # Skills 注册入口、提示词与内置资源
└── tools/                # Tools 注册入口、实现与安全边界测试
```

测试与被测源码放在同一目录。`skills/index.ts` 和 `tools/index.ts` 分别是 Skills 与 Tools 的统一注册入口。

## 常用命令

```bash
# 类型检查
pnpm typecheck

# 直接运行 TypeScript 入口
pnpm dev

# 运行单元测试
pnpm test

# 监听模式运行单元测试
pnpm test:watch

# 编译 TypeScript 到 dist/
pnpm build

# 执行构建后的 Agent CLI
pnpm start
```

`pnpm start` 执行 `dist/agent/cli.js`，首次运行或修改源码后需先执行 `pnpm build`。

## 全局命令

构建后通过 npm 链接将当前项目注册为本机 `termclaw` 命令：

```bash
pnpm build
npm link

termclaw
termclaw --help
termclaw --version
```

启动后会先显示 figlet 品牌标题、`package.json` 信息框（版本、描述、作者、文档）以及 ESC、`/context`、exit 使用说明。

聊天过程中可以输入 `/new` 开启新会话，输入 `/sessions` 查看最近 20 个会话，输入 `/rewind <thread_id>` 恢复存在的历史会话，或输入 `/context` 手动控制下一轮模型使用的聊天记录。交互命令会在本地解析，不会发送给 AI；未来可继续增加带参数的命令。

也可发布后全局安装：

```bash
npm install -g termclaw
```

`termclaw` 的版本与描述直接读取 `package.json`。

## 测试约定

测试文件与源码放在同一目录，使用 `*.test.ts` 命名。Jest 会通过 `ts-jest` 直接执行 TypeScript 测试文件。

```text
src/
  index.ts
  index.test.ts
```
