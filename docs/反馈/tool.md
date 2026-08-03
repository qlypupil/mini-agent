# Tool 调用链分析

主人，结论：当前 Tool 调用链已经完整可用，LangGraph 循环和 Context 处理是合理的；但还不适合完全自主执行。工具失败状态误报和超大字符串输出直接进入 Context 的问题已修复，当前最需要处理的是 `run_py` 未沙箱化，以及文件写入和完整 shell 命令执行均无授权节点。

## 当前链路

用户输入 → runAgentStream →
model_request：绑定全部 Tools 并调用模型 → 模型返回 tool_calls →
ToolNode：校验参数并执行工具 → ToolMessage 写入 State
→ 再次调用模型 → 无 tool_calls 后结束并保存 Checkpoint

模型每次请求都会动态绑定完整工具列表，代码位于 `src/agent/runtime/graph.ts`。目前共 13 个工具：

- 文件：read_file、write_file
- 命令：exec
- 代码：run_js、run_py
- 实时信息：current_time、web_search、web_fetch
- Skills：load_skill
- 用户画像：profile_update
- 长期记忆：memory_create、memory_retrieve、memory_delete

统一注册入口是 `src/agent/tools/index.ts`。

Tool 调用和结果都会作为 AIMessage +
ToolMessage 保存进 SQLite。Context 压缩会保证两者成组保留，但只修改下轮请求的 Context 投影，不修改原始 Checkpoint，src/agent/runtime/
context.ts:49 。

## Tool 权限分级

所有注册 Tool 已增加 `permission_level` 属性，作为后续授权节点的可信元数据。权限分为 `read`、`write`、`exec`、`network` 和 `db`；当前实现只标注能力类别，不改变调用流程，也不自动阻止任何 ToolCall。

完整映射、文件访问边界、类型设计和验收标准见 [40 Tool 权限分级与文件访问边界实现说明](../commits/40-tool-permission-level.md)。真正的权限限制仍需在 `model_request -> tools` 之间增加授权判断，不能依赖模型自行提交权限字段。

`read_file` 和 `write_file` 已支持绝对路径、`../` 相对路径和跨目录符号链接，可访问当前进程有权限操作的任意目录；`.env*`、`.git` 和普通文件类型校验继续保留。在授权节点实现前，这两个 Tool 的跨目录能力不会被 `permission_level` 自动拦截。

System Prompt 已要求模型在路径、内容明确时通过 `read_file` 或 `write_file` 处理用户的文件请求，不得在调用前直接声称无法访问本地文件系统。该规则只触发 ToolCall；后续授权层仍负责放行、确认或拒绝，模型不得使用其他 Tool 绕过拒绝结果。

`exec` 已改为接收并通过 shell 执行完整 `command` 字符串，不再保留命令白名单、危险命令黑名单、项目路径限制或敏感路径限制；管道、重定向、命令组合和状态修改均可执行。它仍标记为 `exec`，但在授权节点实现前不会被自动拦截。

## 主要问题

### 1. run_py 不是真正的沙箱

src/agent/tools/run_py_tool.ts:13 使用的 python3
-I 只隔离 Python 环境，不限制文件、网络和子进程。

我已实际验证：这个模式可以读取项目的 package.json。因此它也能绕过 read_file、write_file 的路径和敏感文件限制，理论上可以读取 .env、访问用户目录、发起网络请求或执行系统命令。

### 2. 写入和完整命令执行没有授权节点

所有请求都会向模型暴露 `write_file` 和 `exec`，模型生成调用后，ToolNode 会立即执行。`write_file` 可以覆盖当前进程有权限访问的任意普通文件，除了路径中的 `.env*` 和 `.git`；`exec` 可以执行完整 shell 命令，并且没有同类路径或命令限制。

当前没有：

- 用户确认
- 只读／写入模式
- LangGraph interrupt
- 基于 `permission_level` 的执行策略

而且多个 Tool call 会并行执行，同一文件可能出现竞争写入。

### 3. 工具失败会被 CLI 误报为成功（已修复）

状态：已于 2026-07-30 修复并验证。

`run_py`、`run_js`、`web_fetch`、`load_skill` 已与其他工具统一错误协议：成功时正常返回结果，失败时抛出 `Error`。LangGraph `ToolNode` 会将异常转换为 `ToolMessage(status: "error")`，CLI 据此显示 `[Tool] <name> failed`，错误信息仍会返回给模型处理。

### 4. read_file 一次性读取大文件（Context 风险已缓解）

状态：超大字符串输出已于 2026-07-30 完成持久化处理并验证。

src/agent/tools/read_file_tool.ts:48 仍会一次性读取整个文件。但 Tool 返回超过 50,000 字符的字符串时，runtime/tool_output.ts 会将完整内容写入 `tool_output/`，返回给模型和 checkpointer 的 `ToolMessage` 只保留文件路径与前 2000 字预览，避免超大结果直接撑满当前 Context。

剩余风险是 `read_file` 仍会把整个文件加载到进程内存，且暂无按行或按字节分段读取的参数。

### 5. 缺少明确的 Tool 调用预算和取消传播

目前没有显式配置：

- 单轮最大 Tool 次数
- 最大模型／工具循环次数
- 单轮 Tool 总输出上限
- Tool 总耗时
- Tool call 成本统计

当前只依赖 LangGraph 默认递归上限 25。ESC 的 AbortSignal 也没有传入 run_py、run_js、exec 和 web_fetch 的内部执行过程，取消可能要等各自超时。

### 6. web_fetch 仍有 DNS 重绑定窗口

代码先执行 DNS 检查，再调用 fetch，src/agent/tools/web_fetch_tool.ts:46 。fetch 会再次解析域名，恶意域名可能在两次解析之间更换地址，绕过内网地址限制。

已有优点

- Tool 注册集中，参数使用 Zod 校验。
- exec 保留 5 秒超时和 64 KB 输出上限。
- 文件工具保留敏感路径、符号链接真实目标和普通文件类型校验。
- run_js 使用 Node 权限模型隔离文件、网络和子进程。
- web_fetch 有协议、重定向、超时和响应大小限制。
- LangGraph 能正确保持 Tool call 与 Tool result 的消息关系。

## 建议顺序

1. [x] 统一工具错误协议，修复“失败显示成功”。
2. [ ] 禁用或真正沙箱化 run_py。
3. [x] 为全部注册 Tool 增加统一权限分级属性。
4. [ ] 在 model_request →
   tools 之间增加 authorize_tools 节点，对写入和执行类工具使用 LangGraph
   interrupt。
5. [ ] 增加 Tool 次数、总输出、耗时和取消控制。
6. [x] 将超大 Tool 字符串输出持久化，限制进入模型与 checkpointer 的内容。
7. [ ] 给 read_file 增加分段读取能力，再强化 web_fetch 的网络连接校验。
