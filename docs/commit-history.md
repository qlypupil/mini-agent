# 提交说明

本文记录当前 `main` 分支的提交演进，说明每次提交解决的问题、关键实现和验证方式。

逐提交的完整实现说明见 [Commit 逐步实现详解](./commits/README.md)。

## 1. [`015c97e` `init: 初始化 Node TypeScript 与 Jest 开发环境`](https://github.com/qlypupil/mini-agent/commit/015c97ea7a88562ebe82fadf76c60d1e15d61e7d)

**详细说明**：[01 初始化 Node TypeScript 与 Jest 开发环境](./commits/01-015c97e-project-foundation.md)

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

**详细说明**：[02 添加 LangChain 依赖](./commits/02-e3d8185-langchain-dependencies.md)

**目标**：为后续 Agent 能力准备 LangChain 与 LangGraph 依赖。

**主要改动**：

- 在 `package.json` 中添加 LangChain 相关运行时依赖。
- 更新 `pnpm-lock.yaml`，使团队环境使用同一套解析版本。

**关键影响**：

后续 Agent 可以使用 `createAgent` 编排模型与工具，使用 LangGraph 提供状态和 checkpointer 能力。

**验证**：依赖已由 pnpm 安装并锁定；此提交尚未创建 Agent 入口。

## 3. [`b826336` `feat: 添加 Agent CLI 与 Moonshot 集成`](https://github.com/qlypupil/mini-agent/commit/b826336eecc2aa40b89ab6eb222e8e208f3ab033)

**详细说明**：[03 添加 Agent CLI 与 Moonshot 集成](./commits/03-b826336-agent-cli-moonshot.md)

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

**详细说明**：[04 支持配置 Moonshot API 地址](./commits/04-a36d2e8-moonshot-base-url.md)

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

**详细说明**：[05 添加 Agent 会话记忆](./commits/05-47a7f8b-in-process-memory.md)

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

**详细说明**：[06 拆分 Agent CLI 命令定义](./commits/06-08710be-cli-command-split.md)

**目标**：将 CLI 命令元信息与聊天交互循环分离，并将项目注册为全局命令。

**主要改动**：

- 新增 `commander` 依赖。
- 新增 `src/agent/command.ts`，定义 `termclaw` 的名称、描述、版本和默认 action。
- `src/agent/cli.ts` 保留 shebang、readline 和聊天循环，并调用 `createProgram(main)`。
- `package.json` 增加 `bin.termclaw`，指向 `dist/agent/cli.js`。
- 使用 `npm link` 注册本机 `termclaw` 命令。
- 抽取 `createInterface()`，集中创建 readline 接口。

**关键代码**：

```ts
export function createProgram(runChat: () => Promise<void>): Command {
  return new Command()
    .name('termclaw')
    .description(packageMetadata.description)
    .version(packageMetadata.version)
    .action(runChat)
}
```

```ts
void createProgram(main).parseAsync(process.argv)
```

`command.ts` 负责命令定义；`cli.ts` 仍是 `bin` 和 `pnpm dev` 的实际入口。

**验证**：`termclaw --help`、`termclaw --version` 和启动后输入 `exit` 均通过。

## 7. [`6031d91` `feat: 支持 ESC 取消流式响应`](https://github.com/qlypupil/mini-agent/commit/6031d910061792fbbfc16d17da4e385db3c6d652)

**详细说明**：[07 支持 ESC 取消流式响应](./commits/07-6031d91-escape-cancellation.md)

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

**详细说明**：[08 统一 Agent 工具与终端输入](./commits/08-10611a3-tools-and-terminal-input.md)

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

**详细说明**：[09 添加安全文件读取工具](./commits/09-847adab-read-file-tool.md)

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

## 10. [`ca73113` `feat: 添加安全文件写入工具`](https://github.com/qlypupil/mini-agent/commit/ca73113780d274a0f8f5596b50b3f11a2dbf1a19)

**详细说明**：[10 添加安全文件写入工具](./commits/10-ca73113-write-file-tool.md)

**目标**：允许 Agent 在当前工作目录中创建或覆写 UTF-8 文本文件，同时防止模型改写目录外、环境变量或 Git 元数据。

**主要改动**：

- 新增 `write_file_tool.ts`，支持创建新文件和覆写已有普通文件。
- 对新建文件校验真实父目录，对覆写文件校验规范化后的真实文件路径。
- 拒绝绝对路径、`..` 越界、符号链接越界、`.env*` 和 `.git/`。
- 不创建缺失父目录，避免工具隐式扩张写入范围。
- 在 `tools/index.ts` 注册 `write_file`，输入为相对 `path` 与完整 `content`。
- 新增 6 条单元测试，覆盖创建、覆写和四类拒绝路径。

**关键代码**：

```ts
const resolvedParentPath = await realpath(dirname(requestedPath))
assertSafePath(assertInsideRoot(root, resolvedParentPath))
```

新建文件时先验证父目录的真实位置，防止通过父目录符号链接把文件写到工作目录外。

```ts
await writeFile(writablePath, content, 'utf8')
```

边界校验通过后，`writeFile` 以 UTF-8 创建文件或完整覆写已有文件。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck`、`pnpm build` 通过；共 4 个测试套件、13 条测试。
- 真实 `termclaw` 集成测试中，模型调用 `write_file` 创建测试文件，文件内容精确匹配后已清理。

## 11. [`fa286a5` `feat: 添加安全命令执行工具`](https://github.com/qlypupil/mini-agent/commit/fa286a5002f4536b3fe429428efd756c818e2ae4)

**详细说明**：[11 添加安全命令执行工具](./commits/11-fa286a5-exec-tool.md)

**目标**：让 Agent 在当前工作目录中执行受限的只读查询，同时禁止模型将任意字符串交给 shell。

**主要改动**：

- 新增 `exec_tool.ts`，仅支持 `ls`、`find`、`rg`、`pwd` 和只读 Git 查询。
- 使用结构化 `command`、`path`、`query` 与 `maxDepth` 输入，而不是接收任意 shell 命令。
- 使用 `spawn(..., { shell: false })`，禁止管道、重定向、命令替换和 shell 注入。
- 复用当前目录、敏感路径和符号链接边界校验；限制单次命令 5 秒、输出 64 KB。
- 新增 5 条单元测试，覆盖目录列表、工作目录、白名单外命令、目录外路径和敏感路径。

**关键代码**：

```ts
const child = spawn(command, args, {
  cwd,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

不启动 shell，因此模型输入不能借助 shell 语法组合出额外命令。

```ts
if (outputBytes > MAX_OUTPUT_BYTES) {
  exceededOutputLimit = true
  child.kill()
}
```

超过 64 KB 时终止子进程，避免大日志或递归列表占满模型上下文。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck`、`pnpm build` 通过；共 5 个测试套件、18 条测试。
- 真实 `termclaw` 集成测试中，模型调用 `exec` 的 `ls src`，正确列出 `agent`、`index.test.ts` 与 `index.ts`。

## 12. [`48d945f` `feat: 添加受限 JavaScript 执行工具`](https://github.com/qlypupil/mini-agent/commit/48d945f87c72518f1b7b56b04df5d62aa38f3007)

**详细说明**：[12 添加受限 JavaScript 执行工具](./commits/12-48d945f-run-js-tool.md)

**目标**：让 Agent 在不访问项目文件、网络、子进程或宿主环境变量的前提下，执行受限的 JavaScript 计算并获取结果。

**主要改动**：

- 新增 `run_js_tool.ts`，以 `node --permission --input-type=module --eval` 在独立 Node.js 子进程中运行 JavaScript。
- 子进程不启动 shell，只继承 `PATH`，避免模型代码读取 `.env` 中的 API Key 等宿主环境变量。
- 默认拒绝文件系统、网络、子进程、worker 等权限；同时限制代码为 20 KB、运行时间为 5 秒、输出为 64 KB。
- 将 Node.js 缺失、语法错误、运行时异常、超时和超出输出限制统一转换为工具结果，供 Agent 继续处理。
- 在 `tools/index.ts` 注册 `run_js` 的名称、说明与 Zod 输入 schema。
- 新增 9 条同目录单元测试，覆盖单行、多行异步、复杂数据处理、特殊字符、语法错误、运行时错误与隔离边界。

**关键代码**：

```ts
const child = spawn(
  'node',
  ['--permission', '--input-type=module', '--eval', code],
  {
    cwd: process.cwd(),
    shell: false,
    env: { PATH: process.env.PATH ?? '' },
  },
)
```

`--permission` 使子进程默认没有敏感系统能力；`shell: false` 防止 JavaScript 源码经 shell 解释；精简环境变量避免继承调用 Agent 的机密配置。

```ts
if (outputBytes > MAX_OUTPUT_BYTES) {
  exceededOutputLimit = true
  child.kill()
}
```

当输出超出 64 KB 时会终止子进程，避免大规模日志占用模型上下文。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过；共 6 个测试套件、27 条测试。
- 真实 `termclaw` 集成测试中，模型调用 `run_js` 执行 `console.log(2 + 3)`，正确返回 `5`。

## 13. [`b5ff031` `feat: 接入实时搜索与本机时间工具`](https://github.com/qlypupil/mini-agent/commit/b5ff031b75ac19fab8845fb92bc233c1a79da889)

**详细说明**：[13 接入实时搜索与本机时间工具](./commits/13-b5ff031-realtime-tools.md)

**目标**：让 Agent 能可靠处理实时信息，避免用模型旧知识回答新闻和当前日期。

**主要改动**：

- 新增 `@langchain/tavily`，以官方 `TavilySearch` 原生工具注册 `web_search`，每次最多 3 条通用结果并要求 Tavily 生成答案。
- 移除返回固定天气结果的示例 `search` 工具，避免模型误选假搜索。
- 新增 `current_time`，返回本机 ISO 时间、时区与本地格式化时间，专门处理“今天”和“现在”。
- 系统提示词规定：日期和时间必须调用 `current_time`；新闻、天气、价格和体育等实时信息必须调用 `web_search` 并使用成功结果。
- CLI 显示工具开始、完成和失败状态；识别 Tavily 的 `{ error }` 返回，避免将 API 业务错误误报为完成。
- 新增共享 `env.ts`，静默且只加载一次 `.env`，消除重复 dotenv 日志。
- 修复 stdin EOF 后 readline 仍请求下一轮输入的异常。

**关键代码**：

```ts
export const webSearchTool = new TavilySearch({
  name: 'web_search',
  maxResults: 3,
  topic: 'general',
  includeAnswer: true,
  tavilyApiKey: process.env.TAVILY_API_KEY,
})
```

直接注册官方工具实例可保持 Moonshot 的工具调用循环兼容；通用包装会导致本项目中工具完成后没有最终回答。

```ts
const currentTime = tool(() => currentTimeTool(), {
  name: 'current_time',
  schema: z.object({}),
})
```

本机时间工具不依赖网页搜索，因此不会因搜索结果的时区或索引时间而把“今天”回答错误。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过；共 7 个测试套件、28 条测试。
- 真实 CLI 的世界杯新闻提问显示 `web_search started/completed` 并输出搜索结果摘要。
- 真实 CLI 的日期提问调用 `current_time`，返回 `Saturday, July 18, 2026`。

## 14. [`b58df1e` `feat: 添加安全网页抓取工具`](https://github.com/qlypupil/mini-agent/commit/b58df1e96f9cf9ca0d39464ef1a4afd8629a0182)

**详细说明**：[14 添加安全网页抓取工具](./commits/14-b58df1e-web-fetch-tool.md)

**目标**：让 Agent 能获取公开网页的文本内容，同时避免将任意 URL 请求变成访问本机、内网或大文件的入口。

**主要改动**：

- 新增 `web_fetch_tool.ts`，使用 Node.js 原生 `fetch` 获取网页文本，不增加额外依赖。
- 仅允许 HTTP(S)，拒绝 `localhost`、回环地址、私网、共享地址和链路本地地址；每次重定向都会重新校验目标地址。
- 限制请求 10 秒、最多 3 次重定向和 1 MB 网络响应。
- 非文本资源只返回类型；文本传入 Agent 前限制为 8 KB，并附加截断标记，避免超过模型上下文。
- 网络错误、超时、HTTP 错误、无效跳转和响应过大统一以 `Error: ...` 返回给 Agent。
- 在 `tools/index.ts` 注册 `web_fetch` 的名称、说明和 URL schema。
- 新增 6 条同目录单元测试，覆盖成功抓取、协议拒绝、内网拒绝、网络错误、1 MB 限制与 8 KB 截断。

**关键代码**：

```ts
const addresses = isIP(hostname)
  ? [{ address: hostname }]
  : await lookup(hostname, { all: true, verbatim: true })

if (addresses.some(({ address }) => isPrivateAddress(address))) {
  throw new Error('Local network URLs are not allowed.')
}
```

目标主机先经 DNS 解析并检查地址范围，重定向后的 URL 也会重复执行这段检查，减少 SSRF 风险。

```ts
if (receivedBytes > MAX_AGENT_CONTENT_BYTES) {
  await reader.cancel()
  return `${content}\n\n[Content truncated at 8 KB.]`
}
```

抓取层可接收最多 1 MB 响应，但只向模型交付 8 KB 文本，防止网页内容消耗全部上下文。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过；共 8 个测试套件、34 条测试。
- 真实 `termclaw` 调用 `web_fetch` 获取 `https://www.mianshipai.com/`，成功概述“前端面试派”的页面内容。

## 15. [`ffc4664` `feat: 接入 Agent Skills 与按需 load_skill`](https://github.com/qlypupil/mini-agent/commit/ffc46640d7aeebe121d3c21da8b23ff9490827d4)

**详细说明**：[15 接入 Agent Skills 与按需加载](./commits/15-ffc4664-agent-skills.md)

**目标**：让 Agent 按任务按需加载专业指令，避免把全部 skill 正文塞进 system prompt。

**主要改动**：

- 新增 `src/agent/skills`：启动时递归发现 `SKILL.md`，解析 YAML frontmatter 的 `name` / `description`，跳过无效或重名 skill。
- 新增 `buildSkillsInstruction`，把可用 skill 目录以 XML 片段写入 system prompt，提示模型在匹配时调用 `load_skill`。
- 新增 `load_skill` 工具，按名称读取完整 `SKILL.md`；无可用 skill 时不注册该工具。
- 内置 `planner` 与 `programmer-resume` 两个示例 skill。
- 默认模型从 `moonshot-v1-8k` 切换为 `kimi-k2.6`，以支持通用 Agent 工具循环。
- 引入 `yaml` 依赖解析 frontmatter。

**关键代码**：

```ts
export const skills = discoverSkills()

export function buildSkillsInstruction(skills: Skill[]): string {
  // ...
  return `The following skills provide specialized instructions. When a task matches a skill description, call load_skill with its exact name before responding.\n<available_skills>\n${catalog}\n</available_skills>`
}
```

启动只披露轻量目录；完整指令由 `load_skill` 按需读入对话，控制上下文体积。

```ts
const skillNames = skills.map((skill) => skill.name)
const skillTools = skillNames.length
  ? [
      tool(({ name }) => loadSkillTool(name), {
        name: 'load_skill',
        schema: z.object({
          name: z.enum(skillNames as [string, ...string[]]),
        }),
      }),
    ]
  : []
```

`z.enum` 限制模型只能加载已发现的 skill 名称，避免随意传参。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck` 通过；共 11 个测试套件、39 条测试。
- 默认模型切换为 `kimi-k2.6` 后，CLI 发送 `hi` 并收到正常回复。

## 16. [`83e1334` `build: 打包内置 Skills 并限制 npm 发布内容`](https://github.com/qlypupil/mini-agent/commit/83e133464ea56f25d376692f7eaf11ff8d232f6e)

**详细说明**：[16 打包内置 Skills 并限制 npm 发布内容](./commits/16-83e1334-package-skills.md)

**目标**：确保 `pnpm build` / 全局安装后的运行时仍能发现内置 `SKILL.md`，且发布包不夹带测试与源码。

**主要改动**：

- 新增 `scripts/clean-dist.mjs`，构建前清理陈旧 `dist/`。
- 新增 `tsconfig.build.json`，编译时排除 `*.test.ts`。
- 新增 `scripts/copy-skills.mjs`，仅复制 `SKILL.md` 到 `dist/agent/skills`，并恢复 `dist/agent/cli.js` 可执行权限。
- `package.json` 的 `files` 限制为 `dist`、`README.md`、`.env.example`。

**关键代码**：

```js
} else if (entry.isFile() && entry.name === 'SKILL.md') {
  const destinationPath = join(destinationRoot, relative(sourceRoot, sourcePath))
  mkdirSync(dirname(destinationPath), { recursive: true })
  copyFileSync(sourcePath, destinationPath)
}
```

只复制 skill 资源文件，避免把 `*.ts` 测试和源码盲拷进发布目录。

**验证**：

- `pnpm build` 后构建产物可发现 `planner`、`programmer-resume` 并注册 `load_skill`。
- 打包预览仅包含运行时文件与 `SKILL.md`；`npm link` 的 `termclaw` 软链接可执行。

## 17. [`af2db79` `feat: 重构 skills/tools 入口并添加 run_py`](https://github.com/qlypupil/mini-agent/commit/af2db794532c8a38d861ecca080dc19157b42f5c)

**详细说明**：[17 重构入口并添加 Python 工具](./commits/17-af2db79-run-py-and-entry-refactor.md)

**目标**：理顺模块入口，并让 Agent 能用本机 `python3` 执行 Python 代码。

**主要改动**：

- 将 `skills/index.ts`、`tools/index.ts` 提升为 `src/agent/skills.ts`、`src/agent/tools.ts`。
- 新增 `run_py_tool.ts`：以 `python3 -I -c` 执行代码；未安装时返回明确错误；限制超时、源码与输出大小，且不继承项目环境变量。
- 补充同目录单元测试，覆盖输出、错误、环境隔离与缺解释器场景。

**验证**：`pnpm test --runInBand`、`pnpm typecheck` 通过；真实 CLI 调用 `run_py` 执行 `print(2 + 3)` 返回 `5`。

## 18. [`0ba7941` `feat: 内置 skill-creator 并复制完整 skill 资源`](https://github.com/qlypupil/mini-agent/commit/0ba7941f42e8b0f9c0fd0d282128d8b536395322)

**详细说明**：[18 内置完整 skill-creator 资源](./commits/18-0ba7941-skill-creator-assets.md)

**目标**：内置 Anthropic `skill-creator`，并保证构建后脚本与资源可用。

**主要改动**：

- 添加 `src/agent/skills/skill-creator/`（含 `SKILL.md`、scripts、eval-viewer 等）。
- 更新 `scripts/copy-skills.mjs`：复制 skill 目录下非 `.ts` 资源，不再只拷 `SKILL.md`。

**验证**：构建产物可发现 `skill-creator`，且 `dist/agent/skills/skill-creator/scripts/` 存在。

## 19. [`0924ab6` `chore: 将包名与 CLI 重命名为 termclaw`](https://github.com/qlypupil/mini-agent/commit/0924ab63521808faceb364571bd755b87cb3fabf)

**详细说明**：[19 将包名与 CLI 重命名为 termclaw](./commits/19-0924ab6-termclaw-rename.md)

**目标**：避免与 npm 上已占用的 `miniagent` 冲突。

**主要改动**：

- `package.json` 的 `name` / `bin` 改为 `termclaw`，补充 `author` 与 `docs`。
- 同步 Commander 命令名、README、ROADMAP、commit-history 与相关测试断言。

**验证**：`termclaw --help` / `--version` 正常。

## 20. [`71304a8` `feat: 优化终端配色并添加启动欢迎屏`](https://github.com/qlypupil/mini-agent/commit/71304a8066a6fab5fe692c5f659aaadf5b271b5c)

**详细说明**：[20 优化终端配色并添加欢迎屏](./commits/20-71304a8-cli-colors-banner.md)

**目标**：提升终端可读性，并在启动时展示醒目的产品信息。

**主要改动**：

- 使用 chalk 区分 `You` / `AI`、工具状态、取消与错误输出。
- 新增 `banner.ts`：figlet 渲染包名，boxen 展示 version / description / author / docs，并打印 ESC / exit 说明。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 通过；启动可见品牌标题与信息框。

## 21. [`7ace0c8` `feat: 使用 SQLite 持久化会话记忆`](https://github.com/qlypupil/mini-agent/commit/7ace0c8fa04956723854bb5c1f469d7ab879f57a)

**详细说明**：[21 使用 SQLite 持久化会话记忆](./commits/21-7ace0c8-sqlite-checkpointer.md)

**目标**：将仅在单个进程内有效的 `MemorySaver` 替换为本地 SQLite 持久化，使同一工作目录中的 CLI 重启后仍能续接会话。

**主要改动**：

- 使用 `@langchain/langgraph-checkpoint-sqlite` 的 `SqliteSaver` 替换 `MemorySaver`。
- 新增 `checkpointer.ts`，固定数据库位置为当前工作目录 `.data/checkpointer.db`，并在启动时创建缺失目录。
- Agent 与 CLI 保持固定 `user-session-1`，因此同一目录的多次启动会读取相同 thread 的历史。
- `.data/` 加入 Git 忽略，避免将本地聊天数据提交。
- `pnpm-workspace.yaml` 显式批准 `better-sqlite3` 的原生构建脚本；它是 SQLite checkpointer 的本地驱动。
- 新增 SQLite 写入和读取单元测试。

**关键代码**：

```ts
export function createCheckpointer(
  databasePath = CHECKPOINT_DATABASE_PATH,
): SqliteSaver {
  mkdirSync(dirname(databasePath), { recursive: true })
  return SqliteSaver.fromConnString(databasePath)
}
```

checkpointer 只依赖当前工作目录，因此每个项目目录拥有独立 `.data/checkpointer.db`，不会混合不同项目的会话。

**验证**：

- `pnpm test --runInBand`、`pnpm typecheck` 与 `pnpm build` 通过；共 13 个测试套件、49 条测试。
- 直接 SQLite 读写确认 `.data/checkpointer.db` 已创建。
- 两次独立 `termclaw` 进程成功保存并恢复 token `cobalt-4729`。

## 22. [`63c5593` `feat: 支持通过 /new 开启新会话`](https://github.com/qlypupil/mini-agent/commit/63c5593)

**详细说明**：[22 支持通过 `/new` 开启新会话](./commits/22-63c5593-new-session-command.md)

**目标**：隔离不同终端聊天的上下文，并支持在不退出 CLI 的情况下开始干净的新会话。

**主要改动**：

- 每次启动 CLI 用 `randomUUID()` 创建新的 `threadId`，不再默认恢复旧会话。
- 新增 `interactive_command.ts`，解析聊天中的 slash 命令，并保留 `args` 和 `rawArgs`，适配未来不同参数形式的命令。
- 实现 `/new`：生成新的 `threadId`，仅在本地提示，不会将命令发送给模型。
- 未知 slash 命令也在本地处理，避免误作为普通聊天内容请求 AI。
- 将仅供 CLI 使用的 Commander 定义并入 `cli.ts`，删除 `command.ts`，清晰区分外部 CLI 选项与聊天内命令。

**关键代码**：

```ts
const commandHandled = await handleInteractiveCommand(userInput, {
  startNewSession: () => {
    threadId = randomUUID()
  },
  write: (message) => console.log(chalk.cyan(message)),
})
if (commandHandled) continue
```

命令分发器返回 `true` 时，CLI 跳过 `runAgentStream`，因此 `/new` 不消耗模型请求，也不污染对话历史。

**验证**：

- 新增命令解析、`/new`、未知命令与未来参数形式测试；共 14 个测试套件、55 条测试通过。
- `pnpm typecheck`、`pnpm build` 通过；构建产物 `termclaw --help` 正常。
- 构建产物输入 `/new` 显示“已开启新会话。”，未调用 AI。

## 23. [`d20145e` `feat: 添加会话列表命令`](https://github.com/qlypupil/mini-agent/commit/d20145e)

**详细说明**：[23 添加 `/sessions` 会话列表命令](./commits/23-d20145e-sessions-command.md)

**目标**：让用户在终端内查看可恢复的近期会话，同时确保查询不发起模型请求。

**主要改动**：

- 新增 `sessions.ts`：从当前目录 `.data/checkpointer.db` 只读查询会话。
- 新增 `/sessions`：最多输出 20 个会话，包含完整 `thread_id`、最后一条用户输入和相对时间。
- 查询时按 `thread_id` 选取最新 checkpoint，避免一轮对话产生的多个 checkpoint 重复显示。
- 最后用户输入压缩空白、截断到 50 字，并转义 Markdown 表格分隔符。
- 新增 SQLite 查询、显示格式和命令分发测试。

**关键代码**：

```sql
ROW_NUMBER() OVER (
  PARTITION BY thread_id
  ORDER BY checkpoint_id DESC
) AS checkpoint_rank
```

LangGraph 的 checkpoint ID 按时间递增；窗口函数选出每个线程最新状态，再从反序列化的消息列表中提取最后一条 `human` 消息。

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand` 通过，共 15 个测试套件、59 条测试。
- `pnpm build` 通过；构建产物执行 `/sessions` 正确输出最近会话表格，未调用 AI。

## 24. [`f77ed9c` `feat: 支持恢复历史会话`](https://github.com/qlypupil/mini-agent/commit/f77ed9c)

**详细说明**：[24 支持 `/rewind` 恢复历史会话](./commits/24-f77ed9c-rewind-command.md)

**目标**：让用户用 `/sessions` 中的 `thread_id` 恢复历史对话，并避免无效 ID 覆盖当前会话。

**主要改动**：

- 新增 `/rewind <thread_id>` 交互命令。
- `hasChatSession` 仅查询 `checkpoints` 表确认线程是否存在，不读取聊天内容，也不修改数据库。
- 仅在存在性校验成功后将 CLI 当前 `threadId` 替换为目标 ID；失败时保留当前会话。
- 新增存在性查询、成功恢复和不存在 ID 提示的单元测试。

**关键代码**：

```ts
if (!await hasChatSession(targetThreadId)) return false

threadId = targetThreadId
return true
```

命令在本地完成后由分发器拦截，随后正常聊天才会使用恢复后的 `threadId` 续接 SQLite 历史。

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand` 通过，共 15 个测试套件、61 条测试。
- `pnpm build` 通过；构建产物执行 `/rewind user-session-1` 显示恢复成功，未调用 AI。

## 25. [`965402a` `feat: 使用终端表格展示会话列表`](https://github.com/qlypupil/mini-agent/commit/965402a)

**详细说明**：[25 使用终端表格展示会话列表](./commits/25-965402a-session-table.md)

**目标**：让 `/sessions` 的会话列表在终端中保持列对齐和清晰边框，替代不适合控制台阅读的 Markdown 管道表格。

**主要改动**：

- 引入 `cli-table3` 及其锁定依赖。
- `formatSessionsTable` 使用 `Table` 的表头和行 API 渲染 `thread_id`、最后用户输入与相对时间。
- 保留完整 ID、50 字截断和相对时间的原有行为。
- 更新单元测试，验证 Unicode 表格边框、表头、完整线程 ID 和截断内容。

**关键代码**：

```ts
const table = new Table({
  head: ['thread_id', '最后用户输入的问题', '时间'],
})
table.push([threadId, lastUserMessage, relativeTime])
return table.toString()
```

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand` 通过，共 15 个测试套件、61 条测试。
- `pnpm build` 通过；构建产物 `/sessions` 显示 Unicode 边框表格。

## 26. [`e8ce501` `feat: 显示 Context 用量并提示新会话`](https://github.com/qlypupil/mini-agent/commit/e8ce501)

**详细说明**：[26 显示 Context 用量并提示新会话](./commits/26-e8ce501-context-usage.md)

**目标**：在每轮回复后展示真实的模型 Context 使用量，并在接近上限时提示用户及时开启新会话。

**主要改动**：

- 新增 `context_usage.ts`，集中维护默认模型、已知 Context 上限、流式 usage 提取与格式化逻辑。
- `agent.ts` 读取可选的 `MOONSHOT_MODEL`，收集工具循环中最后一次模型请求的 `input_tokens`，并将 Context 用量返回给 CLI。
- CLI 在每轮成功回复后显示 token 数、上限与占比；当占比达到或超过 80% 时，提示 Context 即将压缩、可能丢失信息，并建议输入 `/new` 开启新会话。
- 流式响应没有 usage 或模型上限未知时显示“未知”，不使用估算值。
- 新增单元测试，覆盖上限查询、最终 usage 选择、格式化、80% 告警边界及缺失数据。

**关键代码**：

```ts
inputTokens / contextLimit >= 0.8
```

阈值以未四舍五入的原始 token 比例计算，因此恰好 80% 会触发警告，不会受展示时格式化精度影响。

**验证**：`pnpm typecheck` 与 `pnpm test --runInBand` 通过，共 16 个测试套件、69 条测试。

## 27. [`c475136` `feat: 支持手动管理模型 Context 并整理 Agent 结构`](https://github.com/qlypupil/mini-agent/commit/c475136e4d64990010238eb9468bdcac970a4bb6)

**详细说明**：[27 使用 StateGraph 手动管理 Context](./commits/27-c475136-context-stategraph.md)

**目标**：允许用户显式控制下一轮模型请求使用的聊天记录，同时保留只影响下一轮、永久修改当前会话和创建分支会话三种应用方式。

**主要改动**：

- 将 LangChain `createAgent` 替换为自定义 LangGraph `StateGraph`，显式编排 Context 变换、模型请求和工具调用循环。
- 新增 `/context` 命令，支持查看、替换、删除、摘要、载入摘要文件、预览和取消修改。
- Context 修改按 message ID 执行，并校验工具调用 `AIMessage` 与对应 `ToolMessage` 的完整性。
- 支持 `once`、`persist`、`fork` 三种应用模式；`once` 不覆盖 SQLite 原历史，`persist` 更新当前 thread，`fork` 创建并切换到新 thread。
- 摘要使用不绑定 checkpointer 的独立模型调用，避免内部摘要提示污染聊天记录。
- 将 `src/agent` 平铺模块整理到 `cli`、`runtime`、`storage`、`skills` 和 `tools` 目录，并同步更新 README 与 Roadmap。

**关键流程**：

```text
START -> apply_context -> model_request -> END
                             | tool_calls
                             v
                           tools
                             `-> model_request
```

`messages` 是由 SQLite checkpointer 持久化的 LangGraph State；`contextControl` 是单次 graph run 的 Runtime Context。`once` 只在 `model_request` 节点构造模型输入时应用补丁，`persist` 则通过 `RemoveMessage(REMOVE_ALL_MESSAGES)` 和修改后的消息重置持久化 State。

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过，共 19 个测试套件、85 条测试。
- `git diff --check` 通过。
- 构建产物通过真实 Moonshot 流式回归；本地 `/context` 帮助命令不会调用 AI，并能输出全部子命令。

## 28. [`2ffc47f` `feat: 实现自动 Context 压缩与模型交互切换`](https://github.com/qlypupil/mini-agent/commit/2ffc47f2a4eb16ffb06ffdbaed9b8acd36307f37)

**详细说明**：[28 自动 Context 压缩与模型切换](./commits/28-2ffc47f-auto-compression-model-switch.md)

**目标**：在 Context 接近模型上限时自动生成累计摘要，并允许用户在 Kimi 与 DeepSeek 之间切换，而不影响 SQLite 中的原始会话历史。

**主要改动**：

- 新增 Context 压缩模块和独立缓存，保留最近 6 条消息，并用 message ID 标记已经压缩的历史。
- 压缩时保持 AI 工具调用与对应 `ToolMessage` 的完整边界；累计压缩达到 3 次后强烈建议使用 `/new`，但仍继续执行压缩。
- 新增 Kimi、DeepSeek 模型配置与 `/model` 命令，支持交互菜单和完整命令两种切换方式。
- StateGraph 通过 runtime context 接收本轮模型实例与自动压缩结果，切换模型不会重置对话或压缩缓存。
- `/context` 裸命令改为交互菜单，同时保留适合非 TTY 环境的完整子命令。

**验证**：

- `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 23 个测试套件、110 条测试。
- DeepSeek 官方 `/models` 接口返回 HTTP 200；构建产物可切换到 DeepSeek 并完成真实流式回复。

## 29. [`ed2840d` `refactor: 将自动 Context 压缩编排移入 Agent 层`](https://github.com/qlypupil/mini-agent/commit/ed2840de59c6a0ed88618d0f673f1fb60a702c7c)

**详细说明**：[29 将自动压缩编排移入 Agent 层](./commits/29-ed2840d-compression-agent-layer.md)

**目标**：让自动 Context 压缩成为 Agent 核心能力，CLI 只负责触发和展示结果。

**主要改动**：

- 在 `agent.ts` 中新增压缩阈值判断、缓存读写和错误收敛流程。
- CLI 在每轮成功回复后调用 Agent API，根据 `not-needed`、`completed` 或 `failed` 状态输出提示。
- 保持摘要独立调用模型、压缩投影不进入 SQLite checkpointer 的既有行为。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 24 个测试套件、113 条测试。

## 30. [`b76f541` `feat: 增加手动 Context 压缩命令`](https://github.com/qlypupil/mini-agent/commit/b76f5416638ef082292a2c821d361c5bae8798e9)

**详细说明**：[30 添加 `/compact` 手动压缩命令](./commits/30-b76f541-compact-command.md)

**目标**：允许用户不等待 80% 阈值，直接手动压缩当前会话中尚未处理的历史。

**主要改动**：

- 新增 `/compact` 交互命令。
- 命令调用 `agent.ts` 的 `compressContext()`，复用自动压缩相同的累计摘要、最近消息保留和缓存逻辑。
- 无可压缩历史时在本地返回提示，不发送普通聊天请求。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 24 个测试套件、116 条测试；构建产物在空会话执行 `/compact` 时正确返回“没有新的可压缩历史”。

## 31. [`57bd4aa` `fix: 统一 Tool 错误状态处理`](https://github.com/qlypupil/mini-agent/commit/57bd4aaf693feb2ede5dbc942ac80e64cc7eb32c)

**详细说明**：[31 统一 Tool 错误协议](./commits/31-57bd4aa-tool-error-protocol.md)

**目标**：让 Tool 执行失败在消息协议和 CLI 展示中都明确标记为失败，避免错误结果显示为成功。

**主要改动**：

- Tool 返回统一的结构化错误结果，不再用普通成功字符串承载失败。
- StateGraph 的工具节点捕获异常并生成 `ToolMessage(status: "error")`。
- CLI 根据 ToolMessage 状态展示完成或失败。
- 在 `docs/反馈/tool.md` 记录工具调用分析，并将“统一错误协议”标记为完成。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 24 个测试套件、117 条测试；回归测试确认异常工具结果的状态为 `error`。

## 32. [`2fd6681` `feat: 持久化超大 Tool 输出并统一调用展示`](https://github.com/qlypupil/mini-agent/commit/2fd6681a7f2fd8871985c193538e5e7d771901b0)

**详细说明**：[32 持久化超大 Tool 输出](./commits/32-2fd6681-large-tool-output.md)

**目标**：限制超大 Tool 结果占用的模型 Context，并统一工具调用日志与 AI 正文标签的展示时机。

**主要改动**：

- 新增 `runtime/tool_output.ts`；Tool 字符串结果超过 50,000 字符时写入 `tool_output/`，`ToolMessage` 仅保留文件路径和前 2000 字预览。
- 持久化失败时降级为原始 ToolMessage，不因辅助写文件失败中断工具调用。
- Tool 调用日志集中到 StateGraph 工具节点，在执行前只打印 Tool 名称。
- `AI:` 改为收到正文首个 token 时输出，不在 Tool 调用阶段提前显示。
- `.gitignore` 忽略本地 `tool_output/`。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 25 个测试套件、124 条测试；覆盖长度边界、文件名安全、消息元数据保留及写入失败降级。

## 33. [`668d020` `feat: 简化历史 ToolMessage 上下文`](https://github.com/qlypupil/mini-agent/commit/668d02046f7be675e7fda99d073a1ff4cea603a4)

**详细说明**：[33 简化历史 ToolMessage](./commits/33-668d020-tool-message-simplification.md)

**目标**：减少历史 Tool 结果对模型 Context 的重复占用，同时保持当前工具循环和 checkpointer 原始记录不变。

**主要改动**：

- 模型请求前将较早的历史 ToolMessage 临时替换为 `[Previous: used <toolName>]`。
- 仅简化 ToolMessage；保留其他消息、当前轮全部 ToolMessage、最近 3 条历史 ToolMessage 以及所有 `read_file` 结果。
- ToolMessage 缺少名称时，从对应 AI tool call 按 `tool_call_id` 回溯；无法识别工具名时保留原文。
- 简化结果只用于 `modelWithTools.invoke()` 的输入投影，不写回 StateGraph state 或 SQLite checkpointer。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 25 个测试套件、128 条测试；覆盖最近 3 条、`read_file`、名称回溯、未知工具、当前轮多工具及 checkpointer 原文保留。

## 34. [`e4a8638` `feat: 增加模型请求消息硬上限`](https://github.com/qlypupil/mini-agent/commit/e4a8638172a4c70e7ae0167a3c03793fec8cf2d2)

**详细说明**：[34 增加模型请求消息硬上限](./commits/34-e4a8638-message-hard-limit.md)

**目标**：在 Tool 输出外置、历史 ToolMessage 简化和 80% 自动摘要之外，为模型请求增加按消息数量计算的最后一道硬保护。

**主要改动**：

- 新增 `MAX_MODEL_CONTEXT_MESSAGES = 300` 与 `trimModelContextMessages()`，在模型请求前限制聊天历史数量。
- 已有自动压缩摘要时固定保留摘要，并保留最新 299 条消息；没有摘要时保留最新 300 条。
- 裁剪边界切入 Tool 调用组合时，删除跨界的整组 AI tool call 与 ToolMessage，避免向模型发送不完整协议。
- 裁剪只作用于 `modelWithTools.invoke()` 的输入投影，不修改 StateGraph state 或 SQLite checkpointer。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 25 个测试套件、132 条测试；覆盖 300/301 数量边界、累计摘要固定保留、Tool 调用组完整性及 checkpointer 历史不变。

## 35. [`4772571` `feat: 添加长期记忆创建工具`](https://github.com/qlypupil/mini-agent/commit/477257162d62124dcd02b8fc61f291995d282135)

**详细说明**：[35 长期记忆创建 Tool](./commits/35-memory-create-tool.md)

**目标**：建立与 LangGraph checkpointer 分离的长期记忆写入能力，让模型能够筛选并保存具有后续价值的用户事实、事件、偏好和技能。

**主要改动**：

- 新增独立的 `.data/memory.db`，Agent 启动时幂等创建 `memory` 表和自动刷新 `updated_at` 的触发器，不修改 checkpointer 数据库。
- 新增参数化 SQLite 存储层和 `memory_create` Tool，支持四种记忆类型、JSON 关键词、`1～5` 重要性及精简创建结果。
- `session_id` 不暴露给模型，只从 LangGraph 运行时的 `configurable.thread_id` 注入。
- 在 Agent 系统提示词中明确长期记忆的创建条件，并禁止保存临时任务、模型猜测、密钥和 Token。
- 增加存储层、Tool Schema 和 Graph 集成测试，验证写入结果、输入边界、会话归属和 checkpointer 原历史保持。

**验证**：`pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 28 个测试套件、147 条测试。

## 当前结构

```text
src/agent/
  agent.ts                    # 模型初始化、Agent API、流式调用与 Context 压缩编排
  cli.ts                      # CLI 可执行入口、聊天循环与终端展示
  env.ts                      # 环境变量加载
  cli/
    banner.ts                 # 启动欢迎屏与命令提示
    commands.ts               # slash 命令解析和分发
    context_commands.ts       # /context 暂存、预览与应用状态
    select_menu.ts            # TTY 方向键交互菜单
  runtime/
    graph.ts                  # StateGraph、模型请求、工具循环与调用日志
    context.ts                # 自动摘要、压缩投影、消息硬裁剪与历史 ToolMessage 简化
    context_patch.ts          # 手动消息选择、校验与 Context 变换
    context_usage.ts          # Context token 用量与告警
    models.ts                 # Kimi、DeepSeek 配置与模型实例创建
    tool_output.ts            # 超大 Tool 输出持久化与预览消息
  storage/
    checkpointer.ts           # SQLite checkpointer 工厂
    context_compression.ts    # 自动压缩状态的独立文件缓存
    db.ts                     # 长期记忆数据库 Schema 初始化
    memory.ts                 # 长期记忆参数化写入
    sessions.ts               # SQLite 会话查询与终端表格
  skills/                     # Skills 注册、提示词与内置资源
  tools/                      # Tools 注册、实现与安全边界测试
scripts/
  clean-dist.mjs             # 清理生成的 dist 目录
  copy-skills.mjs            # 将内置 skill 资源复制到 dist
tsconfig.build.json          # 仅编译运行时源码的构建配置
```

## 后续边界

- SQLite checkpointer 默认使用当前工作目录 `.data/checkpointer.db`；CLI 每次启动生成新的 thread ID，不会自动恢复上一轮终端对话。
- 交互命令已实现 `/new`、`/sessions`、`/rewind`、`/model`、`/compact` 和 `/context`；`/skill` 仍是后续待实现能力。
- `/context summarize` 会发起一次独立模型请求并消耗 token；`/context apply once` 只改变下一轮模型所见历史，该轮新消息和 AI 回复仍会追加到原 thread。
- 自动 Context 压缩状态保存在 `.data/context-compression/`，不会覆盖 SQLite 原历史；压缩依赖独立模型请求，外部模型过载时可能失败并在下一轮重试。
- 模型请求最多投影 300 条聊天历史，额外的 SystemMessage 不计入该上限；按数量裁剪不能替代按 token 占比触发的自动摘要。
- 超过 50,000 字符的 Tool 输出保存在 `tool_output/`；模型只接收文件路径与前 2000 字预览。更早的历史 ToolMessage 会在模型请求前临时简化，但 SQLite 中仍保留原始消息。
- `memory_create` 目前只负责写入长期记忆；尚未实现记忆检索、请求前召回、更新和删除。
- `web_search` 依赖 `TAVILY_API_KEY` 和外部 Tavily 服务；没有可用密钥时无法获取网页实时信息。
- `current_time` 使用运行 CLI 的本机时区；用户询问其他地区的当前时间时，需要后续增加时区参数。
- Skills 目前仅扫描包内 `src/agent/skills`（构建后为 `dist/agent/skills`）；尚未支持用户或项目级扩展目录。
- `load_skill` 返回完整 `SKILL.md`（含 frontmatter），大文件可能占用较多上下文。
- `run_py` 依赖本机 `python3`，且不像 `run_js` 具备 Node 权限模型级别的文件系统隔离。
- 流式事件处理仍保留部分 `any`，后续可基于 LangChain 事件类型进一步收紧。
