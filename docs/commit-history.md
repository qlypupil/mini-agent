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

## 10. [`ca73113` `feat: 添加安全文件写入工具`](https://github.com/qlypupil/mini-agent/commit/ca73113780d274a0f8f5596b50b3f11a2dbf1a19)

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

## 当前结构

```text
src/
  agent/
    agent.ts    # 模型、工具、MemorySaver 与流式调用
    cli.ts      # 终端聊天循环、ESC 取消和可执行入口
    command.ts  # Commander 命令定义
    skills/
      index.ts                 # SKILL.md 发现、metadata 解析与索引
      prompt.ts                # 模型可见的 skills 目录生成
      planner/SKILL.md         # 计划与待办 skill
      programmer-resume/SKILL.md # 程序员简历 skill
    tools/
      index.ts        # 工具元信息与统一注册表
      read_file_tool.ts       # 当前目录内的安全文件读取实现
      read_file_tool.test.ts  # 文件读取安全边界单元测试
      write_file_tool.ts       # 当前目录内的安全文件写入实现
      write_file_tool.test.ts  # 文件写入安全边界单元测试
      exec_tool.ts             # 当前目录内的只读命令执行实现
      exec_tool.test.ts        # 命令白名单与路径边界单元测试
      run_js_tool.ts           # Node 权限模型下的受限 JavaScript 执行实现
      run_js_tool.test.ts      # JavaScript 执行与隔离边界单元测试
      web_search_tool.ts       # Tavily 通用网页搜索实现
      web_search_tool.test.ts  # Tavily SDK 调用单元测试
      web_fetch_tool.ts        # 受限公网网页抓取实现
      web_fetch_tool.test.ts   # URL、响应大小与网络失败单元测试
      load_skill_tool.ts       # 按名称加载完整 SKILL.md
      load_skill_tool.test.ts  # Skill 加载与终端提示单元测试
      current_time_tool.ts      # 本机日期、时间与时区读取实现
      current_time_tool.test.ts # 本机时间工具单元测试
  index.ts      # 基础示例函数
scripts/
  clean-dist.mjs   # 清理生成的 dist 目录
  copy-skills.mjs  # 将内置 SKILL.md 复制到 dist
tsconfig.build.json # 仅编译运行时源码的构建配置
```

## 后续边界

- `MemorySaver` 仅提供进程内短期记忆；需要跨重启保存时，应替换为数据库 checkpointer。
- `web_search` 依赖 `TAVILY_API_KEY` 和外部 Tavily 服务；没有可用密钥时无法获取网页实时信息。
- `current_time` 使用运行 CLI 的本机时区；用户询问其他地区的当前时间时，需要后续增加时区参数。
- Skills 目前仅扫描包内 `src/agent/skills`（构建后为 `dist/agent/skills`）；尚未支持用户或项目级扩展目录。
- `load_skill` 返回完整 `SKILL.md`（含 frontmatter），大文件可能占用较多上下文。
- 流式事件处理仍保留部分 `any`，后续可基于 LangChain 事件类型进一步收紧。
