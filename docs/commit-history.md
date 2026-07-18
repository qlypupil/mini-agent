# 提交说明

本文记录当前 `main` 分支的提交演进，说明每次提交解决的问题、关键实现和验证方式。

## 1. [`015c97e` `init: 初始化 Node TypeScript 与 Jest 开发环境`](https://github.com/qlypupil/mini-agent/commit/015c97ea7a88562ebe82fadf76c60d1e15d61e7d)

**目标**：建立可编译、可测试的 Node.js + TypeScript 基础工程。

**主要改动**：

- 建立 `pnpm` 包管理、`tsconfig.json`、Jest 与 `ts-jest` 配置。
- 在 `package.json` 提供 `build`、`typecheck`、`test`、`test:watch` 脚本。
- 新增 `src/index.ts` 与 `src/index.test.ts`，用 `sum()` 作为最小测试样例。
- 新增 `.gitignore`、项目级 `AGENTS.md`、`ROADMAP.md` 和 README。

**关键代码**：

```ts
export function sum(left: number, right: number): number {
  return left + right
}
```

这个函数本身没有业务意义，作用是确保 TypeScript 编译与 Jest 单元测试链路可用。

**验证**：`pnpm typecheck`、`pnpm test`、`pnpm build`。

## 2. [`e3d8185` `feat: 添加langchain依赖`](https://github.com/qlypupil/mini-agent/commit/e3d818507ffd5b9ff6b92ace64aebb3348356bbb)

**目标**：为后续 Agent 能力准备 LangChain 与 LangGraph 依赖。

**主要改动**：

- 在 `package.json` 中添加 LangChain 相关运行时依赖。
- 更新 `pnpm-lock.yaml`，使团队环境使用同一套解析版本。

**关键影响**：

后续 Agent 可以使用 `createAgent` 编排模型与工具，使用 LangGraph 提供状态和 checkpointer 能力。

**验证**：依赖已由 pnpm 安装并锁定；此提交尚未创建 Agent 入口。

## 3. [`b826336` `feat: 添加 Agent CLI 与 Moonshot 集成`](https://github.com/qlypupil/mini-agent/commit/b826336eecc2aa40b89ab6eb222e8e208f3ab033)

**目标**：实现可在终端运行的 Moonshot Agent，并以流式方式输出模型回复。

**主要改动**：

- 新增 `src/agent/agent.ts`，配置 `ChatOpenAI` 的 Moonshot 兼容接口。
- 新增 `src/agent/cli.ts`，通过 `readline` 提供多轮终端输入。
- 接入 `dotenv` 与 `.env.example`，从环境变量读取 `MOONSHOT_API_KEY`。
- 引入 `zod` 定义工具输入 schema，并添加示例 `search` 工具。
- 增加 `dev`、`start` 脚本：开发环境运行 TypeScript，生产运行 `dist/agent/cli.js`。

**关键代码**：

```ts
const agent = createAgent({
  model,
  tools: [search],
  systemPrompt: 'You are a helpful assistant.',
})
```

```ts
for await (const chunk of stream as any) {
  onToken(content)
  fullResponse += content
}
```

前者将模型和工具组合为 Agent；后者将流式 token 回调给 CLI，以 `process.stdout.write()` 实时输出。

**验证**：构建后的 CLI 已调用 Moonshot API，`hi` 与 `who are you` 都获得正常回复。

## 4. [`a36d2e8` `feat: 支持配置 Moonshot API 地址`](https://github.com/qlypupil/mini-agent/commit/a36d2e8bad4a9dbb638a5c9e688197cf6fdc7e26)

**目标**：移除 Moonshot API 地址的硬编码限制，允许不同环境使用不同的兼容网关或地址。

**主要改动**：

- 在 `.env.example` 中新增 `MOONSHOT_BASE_URL`。
- `agent.ts` 从环境变量读取地址，未配置时保持原有默认值。
- README 说明 API Key 为必填、Base URL 为可选。

**关键代码**：

```ts
const MOONSHOT_BASE_URL =
  process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1'
```

```ts
configuration: {
  baseURL: MOONSHOT_BASE_URL,
}
```

`??` 保证未设置环境变量时不改变既有运行行为。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build`。

## 5. [`47a7f8b` `feat: 添加 Agent 会话记忆`](https://github.com/qlypupil/mini-agent/commit/47a7f8ba3e9a1b38c5a0403ca7da7bdd276a8977)

**目标**：让同一 CLI 进程中、相同 `threadId` 的多轮消息共享上下文。

**主要改动**：

- 使用 `@langchain/langgraph` 的 `MemorySaver` 创建 checkpointer。
- 在 `createAgent` 时传入 `checkpointer`。
- CLI 固定使用 `user-session-1` 作为当前进程的会话 ID。
- README 明确记忆只存在于当前 Node.js 进程，重启后会清空。

**关键代码**：

```ts
const checkpointer = new MemorySaver()

const agent = createAgent({
  model,
  tools: [search],
  systemPrompt: 'You are a helpful assistant.',
  checkpointer,
})
```

```ts
configurable: {
  thread_id: threadId,
}
```

checkpointer 按 `thread_id` 保存图状态，因此同一线程的下一次调用可以读取前序消息。

**验证**：先发送“我的名字是 Pupil”，再提问“我的名字是什么”，模型正确返回 `Pupil`。

## 6. [`08710be` `refactor: 拆分 Agent CLI 命令定义`](https://github.com/qlypupil/mini-agent/commit/08710beaf71647e50af69c50fe53722e0ef23e3f)

**目标**：将 CLI 命令元信息与聊天交互循环分离，并将项目注册为全局命令。

**主要改动**：

- 新增 `commander` 依赖。
- 新增 `src/agent/command.ts`，定义 `miniagent` 的名称、描述、版本和默认 action。
- `src/agent/cli.ts` 保留 shebang、readline 和聊天循环，并调用 `createProgram(main)`。
- `package.json` 增加 `bin.miniagent`，指向 `dist/agent/cli.js`。
- 使用 `npm link` 注册本机 `miniagent` 命令。
- 抽取 `createInterface()`，集中创建 readline 接口。

**关键代码**：

```ts
export function createProgram(runChat: () => Promise<void>): Command {
  return new Command()
    .name('miniagent')
    .description(packageMetadata.description)
    .version(packageMetadata.version)
    .action(runChat)
}
```

```ts
void createProgram(main).parseAsync(process.argv)
```

`command.ts` 负责命令定义；`cli.ts` 仍是 `bin` 和 `pnpm dev` 的实际入口。

**验证**：`miniagent --help`、`miniagent --version` 和启动后输入 `exit` 均通过。

## 7. [`6031d91` `feat: 支持 ESC 取消流式响应`](https://github.com/qlypupil/mini-agent/commit/6031d910061792fbbfc16d17da4e385db3c6d652)

**目标**：在模型尚未完成流式回复时，让用户按 ESC 立即取消请求并返回输入状态。

**主要改动**：

- `runAgentStream()` 新增可选 `AbortSignal`，传递给 `agent.stream()`。
- CLI 在请求期间创建 `AbortController`。
- TTY 环境使用 `readline.emitKeypressEvents()` 和 raw mode 监听按键；检测到 ESC 后调用 `controller.abort()`。
- 在 `finally` 中移除监听并关闭 raw mode，确保取消和异常都不会遗留终端状态。

**关键代码**：

```ts
const controller = new AbortController()
const stopListening = listenForEscape(controller)

await runAgentStream(userInput, onToken, THREAD_ID, controller.signal)
```

```ts
if (key.name === 'escape') {
  controller.abort()
}
```

```ts
if (controller.signal.aborted) {
  process.stdout.write('\n\n已取消当前请求。\n\n')
  return
}
```

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 通过。
- 真实 Moonshot 长响应测试中，3 秒后发送 ESC，已中断部分流式输出、显示取消提示，并返回 `You:`。
- 简短的 100 词自我介绍可能在 3 秒内自然完成；此时 ESC 不会取消已结束的请求，这是预期行为。

## 8. [`10611a3` `feat: 统一 Agent 工具与终端输入`](https://github.com/qlypupil/mini-agent/commit/10611a395947cf2ccf5ff078e83c069e49523359)

**目标**：集中管理 Agent 工具元信息，降低工具实现的测试成本，并修复 ESC 功能引入的中文输入重复回显。

**主要改动**：

- 新增 `src/agent/tools/index.ts`，集中定义工具的 `name`、`description`、Zod schema 和注册表。
- `search.ts` 只保留纯查询实现，`search.test.ts` 直接测试业务分支，不依赖 LangChain wrapper。
- `agent.ts` 从 `tools` 注册表加载全部工具。
- raw mode 改为 CLI 生命周期内一次性启用，避免在 `readline.question()` 回调后切换终端模式。
- ESC 仅在活动请求存在时取消对应的 `AbortController`。

**关键代码**：

```ts
export const tools = [searchTool]
```

```ts
const controller = new AbortController()
activeController = controller
```

前者是新增工具的唯一注册入口；后者确保 ESC 只会取消当前正在运行的一轮请求。

**验证**：

- `pnpm test --runInBand` 通过，包含 `search.test.ts` 的两条实现级测试。
- `pnpm typecheck` 与 `pnpm build` 通过。
- `pnpm dev` 输入 `s的天气怎么 样` 后，用户输入只回显一次。

## 9. [`847adab` `feat: 添加安全文件读取工具`](https://github.com/qlypupil/mini-agent/commit/847adab41a0f7bdfaec1c275bbf7aadfaf0a9854)

**目标**：让 Agent 读取当前工作目录中的文本文件，同时限制工具结果泄露项目外文件、Git 元数据和环境变量。

**主要改动**：

- 新增 `read_file_tool.ts`，只接受相对路径，并使用 `resolve`、`relative` 与 `realpath` 执行两次目录边界校验。
- 拒绝绝对路径、`..` 越界、符号链接指向目录外、`.env*` 和 `.git/` 路径。
- 仅允许普通文件，并统一按 UTF-8 返回内容。
- 在 `tools/index.ts` 中定义 `read_file` 的 name、description 和 Zod schema，加入统一 `tools` 注册表。
- 新增同目录单元测试，覆盖允许读取、绝对路径、目录外路径与敏感文件拒绝。

**关键代码**：

```ts
const resolvedPath = await realpath(requestedPath)
assertSafePath(assertInsideRoot(root, resolvedPath))
```

第二次校验使用规范化后的真实路径，避免符号链接绕过目录限制。

```ts
if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
  throw new Error('Sensitive files cannot be read.')
}
```

文件内容会作为工具结果传给模型，因此环境变量和 Git 元数据被默认拒绝。

**验证**：`pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过；共 3 个测试套件、7 条测试。

## 当前结构

```text
src/
  agent/
    agent.ts    # 模型、工具、MemorySaver 与流式调用
    cli.ts      # 终端聊天循环、ESC 取消和可执行入口
    command.ts  # Commander 命令定义
    tools/
      index.ts        # 工具元信息与统一注册表
      search.ts       # 示例搜索实现
      search.test.ts  # 搜索实现单元测试
      read_file_tool.ts       # 当前目录内的安全文件读取实现
      read_file_tool.test.ts  # 文件读取安全边界单元测试
  index.ts      # 基础示例函数
```

## 后续边界

- `MemorySaver` 仅提供进程内短期记忆；需要跨重启保存时，应替换为数据库 checkpointer。
- `search` 仍是示例工具，未接入真实检索服务。
- 流式事件处理仍保留部分 `any`，后续可基于 LangChain 事件类型进一步收紧。
