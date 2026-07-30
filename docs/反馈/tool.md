# Tool 调用链分析

主人，结论：当前 Tool 调用链已经完整可用，LangGraph 循环和 Context 处理是合理的；但还不适合完全自主执行。工具失败状态误报和超大字符串输出直接进入 Context 的问题已修复，当前最需要处理的是 run_py 未沙箱化和写操作无确认。

## 当前链路

用户输入 → runAgentStream →
model_request：绑定全部 Tools 并调用模型 → 模型返回 tool_calls →
ToolNode：校验参数并执行工具 → ToolMessage 写入 State
→ 再次调用模型 → 无 tool_calls 后结束并保存 Checkpoint

模型每次请求都会动态绑定完整工具列表，代码位于 src/agent/runtime/graph.ts:81 。目前共 9 个工具：

- 文件：read_file、write_file
- 命令：exec
- 代码：run_js、run_py
- 实时信息：current_time、web_search、web_fetch
- Skills：load_skill

统一注册入口是 src/agent/tools/index.ts:141 。

Tool 调用和结果都会作为 AIMessage +
ToolMessage 保存进 SQLite。Context 压缩会保证两者成组保留，但只修改下轮请求的 Context 投影，不修改原始 Checkpoint，src/agent/runtime/
context.ts:49 。

## 主要问题

### 1. run_py 不是真正的沙箱

src/agent/tools/run_py_tool.ts:13 使用的 python3
-I 只隔离 Python 环境，不限制文件、网络和子进程。

我已实际验证：这个模式可以读取项目的 package.json。因此它也能绕过 read_file、write_file 的路径和敏感文件限制，理论上可以读取 .env、访问用户目录、发起网络请求或执行系统命令。

### 2. 写操作没有授权节点

所有请求都会向模型暴露 write_file，模型生成调用后，ToolNode 会立即执行。src/agent/tools/write_file_tool.ts:74 可以完整覆盖项目内任意普通文件，除了 .env\* 和 .git/。

当前没有：

- 用户确认
- 只读／写入模式
- LangGraph interrupt
- 按工具划分的权限策略

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
- exec 使用白名单并禁用 Shell。
- 文件工具有工作目录、敏感路径和符号链接越界保护。
- run_js 使用 Node 权限模型隔离文件、网络和子进程。
- web_fetch 有协议、重定向、超时和响应大小限制。
- LangGraph 能正确保持 Tool call 与 Tool result 的消息关系。

## 建议顺序

1. [x] 统一工具错误协议，修复“失败显示成功”。
2. [ ] 禁用或真正沙箱化 run_py。
3. [ ] 在 model_request →
   tools 之间增加 authorize_tools 节点，对写入和执行类工具使用 LangGraph
   interrupt。
4. [ ] 增加 Tool 次数、总输出、耗时和取消控制。
5. [x] 将超大 Tool 字符串输出持久化，限制进入模型与 checkpointer 的内容。
6. [ ] 给 read_file 增加分段读取能力，再强化 web_fetch 的网络连接校验。
