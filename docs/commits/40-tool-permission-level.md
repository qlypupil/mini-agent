# 40 Tool 权限分级与执行边界实现说明

## Commit 信息

- Commit：[`26c2082`](https://github.com/qlypupil/mini-agent/commit/26c2082268abb94adf351a82a88d6ed566c0e9c1)
- 类型：`feat`
- 状态：当前实现
- 基线：`23a6baf docs: 补齐用户画像提交信息`
- 实现范围：为所有已注册 Tool 增加统一的 `permission_level` 属性和编译期完整性约束；放开文件 Tool 的目录范围和 `exec` 的命令范围；引导模型对明确的文件请求发起 ToolCall，但暂不执行权限拦截。

## 一、背景

当前 Agent 会在每次模型请求时绑定完整 Tool 列表。模型生成 ToolCall 后，LangGraph `ToolNode` 会直接找到同名 Tool 并执行。现有代码已经分别限制了文件路径、命令白名单、网络目标和数据库输入，但注册表中没有统一的权限分类，因此后续无法在 Graph 层按能力判断哪些调用可以直接执行、哪些调用需要用户确认或禁止。

本阶段只建立权限元数据，不改变现有 Tool 调用链。每个实际注册给模型的 LangChain Tool 实例都必须带有 `permission_level`，供后续授权节点读取。

## 二、权限等级

权限等级固定为以下五种：

```ts
type ToolPermissionLevel = 'read' | 'write' | 'exec' | 'network' | 'db'
```

各等级的含义如下：

| 权限 | 含义 |
| --- | --- |
| `read` | 读取本地非数据库信息，不修改持久化状态。 |
| `write` | 创建或覆盖本地文件。 |
| `exec` | 启动本地命令或代码执行进程。 |
| `network` | 访问公网服务或网页。 |
| `db` | 查询或修改 Agent 自有 SQLite 业务数据。 |

`permission_level` 表示 Tool 的能力类别，不表示当前是否允许执行，也不替代 Tool 内部已有的路径、参数、超时和敏感信息校验。

## 三、现有 Tool 映射

用户提供的 `readFileTool`、`memoryCreateTool` 等名称多数是底层执行函数；LangGraph 实际接收的是 `read_file`、`memory_create` 等 LangChain Tool 实例。权限属性应挂在后者上，因为未来授权逻辑处理的是模型返回的 Tool 名称和统一注册表。

当前 13 个已注册 Tool 的映射如下：

| 注册名称 | 当前代码对象 | `permission_level` |
| --- | --- | --- |
| `read_file` | `readFile` | `read` |
| `write_file` | `writeFile` | `write` |
| `exec` | `exec` | `exec` |
| `run_js` | `runJs` | `exec` |
| `run_py` | `runPy` | `exec` |
| `current_time` | `currentTime` | `read` |
| `web_search` | `webSearchTool` | `network` |
| `web_fetch` | `webFetch` | `network` |
| `load_skill` | 动态 Skill Tool | `read` |
| `memory_create` | `memoryCreate` | `db` |
| `memory_retrieve` | `memoryRetrieve` | `db` |
| `memory_delete` | `memoryDelete` | `db` |
| `profile_update` | `profileUpdate` | `write` |

原始清单没有列出 `current_time`。它只读取本机时钟和时区，不访问文件、数据库或网络，因此归为 `read`。

`memory_retrieve` 虽然是只读查询，但它访问长期记忆数据库，仍归为 `db`。这样后续可以独立控制本地普通读取与用户长期数据访问。

## 四、实现方案

新增 `src/agent/tools/tool_permission.ts`，集中提供：

- `ToolPermissionLevel`：权限等级联合类型。
- `PermissionedTool`：在 LangChain `StructuredToolInterface` 上增加只读 `permission_level` 字段的类型。
- `withPermissionLevel()`：接收 Tool 实例和权限等级，挂载属性并保留原 Tool 的具体类型。

示意代码如下：

```ts
type PermissionedTool<T extends StructuredToolInterface = StructuredToolInterface> =
  T & { readonly permission_level: ToolPermissionLevel }

function withPermissionLevel<T extends StructuredToolInterface>(
  tool: T,
  permissionLevel: ToolPermissionLevel,
): PermissionedTool<T> {
  return Object.assign(tool, { permission_level: permissionLevel })
}
```

权限使用直接属性，而不是放入 `metadata` 或 `extras`：

- 后续 Graph 授权节点可以直接读取 `tool.permission_level`。
- `metadata` 主要服务调用追踪，语义不够明确。
- `extras` 面向模型供应商扩展，不应承载本地授权规则。
- 模型仍只接收 Tool 的名称、描述和输入 Schema，不需要看到本地权限等级。

具体接入位置：

1. `index.ts` 内创建的文件、命令、代码、本机时间、网页抓取和 Skill Tool 在创建时挂载权限。
2. `webSearchTool` 是第三方 `TavilySearch` 实例，在实例创建后挂载 `network`。
3. Memory 和 Profile Tool 在各自工厂函数内部挂载权限，保证测试或其他调用方创建的实例同样包含该属性。
4. 统一注册表使用 `satisfies PermissionedTool[]` 做编译期检查；以后新增 Tool 未设置权限时，TypeScript 必须报错。

## 五、本阶段边界

本阶段不实现以下能力：

- 不根据权限等级阻止或放行 ToolCall。
- 不增加 LangGraph 授权节点、`interrupt` 或用户确认流程。
- System Prompt 只增加文件 Tool 选择和授权失败处理规则，不赋予模型放行权限；除 `read_file`、`write_file` 的路径范围说明外，不修改其他 Tool description。
- 不把 `permission_level` 暴露为模型输入字段。
- 不修改数据库 Schema、数据或迁移逻辑。
- 不增加依赖，不修改 `pnpm-lock.yaml`。

后续权限限制应基于服务端注册表中的可信属性判断，不能接受模型自行提交或覆盖 `permission_level`。

## 六、测试与验收标准

1. 统一注册表中的每个 Tool 都存在 `permission_level`。
2. 13 个 Tool 的实际名称和权限值与本文映射完全一致。
3. Memory 与 Profile 工厂返回的独立 Tool 实例包含正确权限。
4. 第三方 `TavilySearch` 实例挂载权限后仍能正常调用。
5. 新增未设置权限的注册 Tool 时，TypeScript 类型检查失败。
6. 除文件 Tool 的路径范围描述外，现有 Tool 的名称、Schema、调用结果和其他安全边界保持不变。
7. `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过。

上述权限类型、13 个 Tool 映射、工厂返回值和注册表约束均已实现。

## 七、文件 Tool 访问边界

`read_file` 和 `write_file` 原本只接受相对路径，并通过真实路径校验拒绝当前工作目录外的目标。权限分类建立后，目录范围不再由文件 Tool 的项目根目录规则决定，而由后续统一权限流程控制是否允许调用。

本阶段先移除当前目录限制：

- 绝对路径直接使用。
- 相对路径继续以 `process.cwd()` 为基准解析。
- 相对路径允许包含 `../` 并访问当前目录之外。
- 符号链接允许指向当前目录之外。
- 最终访问仍受操作系统用户权限限制。
- `read_file` 只读取已有普通文件。
- `write_file` 只覆盖已有普通文件或在已有父目录中创建普通文件，不自动创建父目录。

`permission_level` 目前仍只是元数据，尚未执行授权、确认或拒绝。在后续权限流程完成前，模型调用文件 Tool 时不会受到权限节点拦截，这是当前分阶段开发的已知边界。

### 保留的内部校验

本阶段只删除当前目录限制，不删除以下校验：

- 原始请求路径中任一段为 `.git` 或以 `.env` 开头时拒绝访问。
- 符号链接解析后的真实路径中任一段为 `.git` 或以 `.env` 开头时同样拒绝访问。
- 目录、设备和其他非普通文件不能作为读写目标。
- `write_file` 覆盖符号链接时，最终目标必须是普通文件。
- 文件继续按 UTF-8 读写。

敏感路径检查与后续权限授权属于不同层次：权限层决定某次 `read` 或 `write` 调用能否执行，文件 Tool 内部校验继续阻止已授权调用直接访问 `.env*` 和 `.git`。

### 代码改动

`read_file_tool.ts` 删除工作目录边界和绝对路径拒绝逻辑，统一使用 `resolve(filePath)` 解析路径，并在解析符号链接前后执行敏感路径检查。

`write_file_tool.ts` 同样删除工作目录边界和绝对路径拒绝逻辑，允许父目录和符号链接目标位于当前目录之外，并在请求路径、真实父目录和已有目标的真实路径上保留敏感路径检查。

统一 Tool 注册表同步更新 description 和路径字段说明，明确支持绝对路径以及相对当前目录的路径。`permission_level` 保持不变：`read_file` 为 `read`，`write_file` 为 `write`。

### 补充验收标准

1. `read_file` 可以读取工作目录外的绝对路径、`../` 相对路径和跨目录符号链接。
2. `write_file` 可以通过绝对路径、`../` 相对路径和跨目录符号链接在外部创建或覆盖普通文件。
3. 两个 Tool 仍拒绝原始路径或真实路径中的 `.env*`、`.git`。
4. 两个 Tool 仍拒绝目录等非普通文件。
5. Tool 名称、输入 Schema 结构和 `permission_level` 不变。

上述权限分级和文件 Tool 跨目录访问均已实现。

## 八、文件 Tool 调用规则

仅放开文件路径和修改 Tool description，不能保证模型一定发起 ToolCall。模型仍可能沿用通用远程助手的习惯，直接声称无法访问本地文件系统。System Prompt 因此增加以下规则：

```text
When the user explicitly asks to read a file and the path is clear, call read_file. When the user explicitly asks to create or update a file and the required path and content are clear, call write_file. Use these tools instead of claiming that you cannot access the local file system.

Tool calls may be subject to authorization. If a tool call is denied or fails, explain the returned reason. Never bypass a denied tool call by using another tool.
```

这段 Prompt 只负责让模型根据用户意图提出 ToolCall，不负责判断权限。后续完整链路为：

```text
用户请求
  -> 模型提出 read_file / write_file ToolCall
  -> 权限层读取 permission_level
  -> 自动放行 / 请求确认 / 拒绝
  -> 放行后进入 ToolNode 执行
```

路径或写入内容不明确时，模型仍应先向用户澄清，不能猜测。权限层拒绝后，模型只能解释拒绝原因，不能改用 `exec`、`run_js`、`run_py` 或其他 Tool 绕过限制。`permission_level` 仍由服务端 Tool 注册表提供，不能成为模型输入。

补充验收标准：

1. System Prompt 对路径明确的读取请求要求调用 `read_file`。
2. System Prompt 对路径和内容明确的创建、更新请求要求调用 `write_file`。
3. System Prompt 禁止在尝试 Tool 前直接声称无法访问本地文件系统。
4. System Prompt 明确 ToolCall 可能被授权层拒绝，并禁止使用其他 Tool 绕过拒绝。
5. 文件调用规则位于 Profile 与 Memory 规则之前，不改变现有分类顺序。

上述文件调用规则已实现。该阶段验证通过 33 个测试套件、196 条测试；Kimi 与 DeepSeek 均在全新 CLI 请求中自主调用 `write_file`，并将指定内容写入工作目录外的临时文件。

## 九、`exec` 完整命令执行

当前仓库没有 `DANGEROUS_COMMANDS` 黑名单。原实现使用更严格的结构化白名单：Schema 只接受 `ls`、`find`、`rg`、`pwd`、`git_status`、`git_diff` 和 `git_log`，`exec_tool.ts` 再通过 `switch` 构造固定参数，并限制路径只能位于当前工作目录。

为了后续统一交由 `permission_level: 'exec'` 权限流程处理，本阶段将 `exec` 改为接收完整 shell 命令：

```ts
const execSchema = z.object({
  command: z.string().trim().min(1),
})
```

执行方式调整为：

```ts
spawn(command, {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

因此 `exec` 支持：

- 任意当前系统可执行文件及参数。
- shell 管道、重定向、逻辑运算符和命令组合。
- 命令自行使用绝对路径、相对路径或 `cd` 访问其他目录。
- 读取、创建、修改或删除当前进程有权限操作的文件。

删除的旧逻辑包括：

- 命令枚举白名单和 `Command is not allowed` 错误。
- `path`、`query`、`maxDepth` 输入字段。
- `assertInsideRoot()`、`assertSafePath()` 和 `resolveSafePath()`。
- 为 `ls`、`find`、`rg`、`git` 子命令拼接固定参数的 `switch`。

继续保留：

- 子进程工作目录默认为 `process.cwd()`。
- 单次执行 5 秒超时。
- stdout 与 stderr 合计 64 KB 输出上限。
- 非零退出码作为 Tool 错误返回。
- 不继承终端标准输入，避免命令等待交互输入。
- `permission_level` 保持为 `exec`。

### 已知边界

`permission_level` 当前仍只是元数据，权限节点尚未实现。因此本阶段完成后，模型发起的 `exec` ToolCall 会立即执行完整 shell 命令，包括破坏性命令。命令白名单、危险命令黑名单、路径限制和敏感文件限制均不会在 `exec_tool.ts` 内兜底；后续必须由统一权限层决定自动放行、请求确认或拒绝。

### 补充验收标准

1. `exec` Schema 只暴露非空 `command` 字符串。
2. 原白名单外的普通命令可以执行。
3. 管道等 shell 语法可以执行。
4. 非零退出码仍返回包含 stderr 的错误。
5. 原有 5 秒超时和 64 KB 输出上限保持不变。
6. Tool description 不再声明“只读”“安全命令”或“不支持 shell”。
7. `permission_level` 仍为 `exec`。

上述完整命令 Schema、shell 执行和错误边界均已实现。最终验证通过 33 个测试套件、197 条测试；构建产物中的注册 `exec` 已成功执行原白名单外的管道命令。
