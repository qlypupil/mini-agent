# 41 Tool 调用 Human-in-the-loop 确认

## Commit 信息

- Commit：待提交
- 类型：`feat`
- 状态：当前实现
- 基线：`9cec499 docs: 补齐工具权限与执行边界提交信息`
- 实现范围：使用 LangGraph human-in-the-loop 在所有已注册 ToolCall 执行前请求用户确认，支持同一轮多个调用的独立批准和拒绝。

## 一、背景

第 40 阶段已经为全部 Tool 增加可信的 `permission_level`，并将文件和命令范围从临时白名单中解耦，但模型生成 ToolCall 后仍会由 `ToolNode` 立即执行。本阶段补上统一确认入口，确保任何 Tool 都不能仅凭模型决定执行。

确认覆盖 `read`、`write`、`exec`、`network` 和 `db` 五类权限。`permission_level` 本阶段只用于向用户说明调用能力，不用于自动放行；即使是 `current_time`、`read_file` 或 `memory_retrieve` 也必须逐次确认。

## 二、Graph 流程

在现有自定义 StateGraph 中增加 `authorize_tools` 节点：

```text
apply_context
  -> model_request
       -> 无 ToolCall：END
       -> 有 ToolCall：authorize_tools
            -> interrupt({ requests })
            -> Command({ resume: { decisions } })
            -> tools
            -> model_request
```

`authorize_tools` 位于模型输出和任何 Tool 副作用之间。节点在调用 `interrupt()` 之前只整理 JSON 可序列化的确认信息，不执行 Tool，也不产生其他副作用。现有 SQLite checkpointer 保存中断状态，恢复时必须继续使用同一个 `thread_id`。

每个确认请求包含：

```ts
interface ToolApprovalRequest {
  id: string
  name: string
  args: Record<string, unknown>
  permissionLevel: ToolPermissionLevel
}
```

`permissionLevel` 只能根据服务端 Tool 注册表中的属性生成，不能读取模型参数中的同名字段。未注册 Tool 不属于可授权对象，授权节点会直接报错且不会执行。

## 三、确认与恢复协议

同一条 AI 消息可以包含多个 ToolCall。Graph 使用一次中断携带完整请求列表，CLI 按原始顺序逐项询问，最后以相同顺序恢复：

```ts
type ToolApprovalDecision =
  | { type: 'approve' }
  | { type: 'reject' }

new Command({
  resume: {
    decisions: [...],
  },
})
```

恢复数据必须满足以下约束：

- `decisions` 必须是数组。
- 决定数量必须与待确认 ToolCall 数量完全一致。
- 每项只能是 `approve` 或 `reject`。
- 决定与调用按数组位置配对，不能由调用方替换名称、参数或权限等级。

未提供确认回调时全部按 `reject` 处理，避免非 CLI 调用方绕过确认。确认回调抛错或请求取消时不恢复 Graph，Tool 保持未执行状态。

## 四、批准与拒绝行为

获批调用继续交给现有 `ToolNode`，保留 Tool runtime、错误协议、超大输出外置和执行结果消息。`[Tool] <name>` 日志只在获批后、实际执行前输出，不能在模型刚提出调用时误报为已经开始。

拒绝调用不进入 Tool 实现，并生成与原 ToolCall 对应的错误消息：

```ts
new ToolMessage({
  name: toolCall.name,
  tool_call_id: toolCall.id,
  status: 'error',
  content: 'User rejected this tool call. Do not retry or bypass it with another tool.',
})
```

拒绝消息进入原会话历史，保证 AI ToolCall 和 ToolMessage 完整配对。Graph 随后回到 `model_request`，由模型向用户说明未执行结果。混合决定时只执行获批调用，拒绝调用仍各自生成结果消息。

## 五、流式 Agent 与 CLI

`runAgentStream()` 同时使用 `messages` 和 `updates` 两种 stream mode：

- `messages` 继续处理模型 token、usage metadata 和 ToolMessage。
- `updates` 捕获 `__interrupt__`，调用确认回调，再通过 `Command({ resume })` 开启下一段流。

一次用户请求可以经历多次 ToolCall 和中断恢复。Agent 只在首段流中提交用户消息，后续流只提交 `Command`，避免重复写入用户消息；最终统一返回完整回复和最后一次模型请求的 Context 用量。

CLI 对每个调用展示：

```text
[Confirm] Tool: write_file
Permission: write
Arguments:
{
  "path": "/tmp/example.txt",
  "content": "hello"
}
允许调用此 Tool？[y/N]：
```

输入规则：

- `y`、`yes`：批准。
- `n`、`no`、空输入：拒绝。
- 其他内容：提示输入无效并继续询问。

每个 ToolCall 都重新询问，不提供“本轮全部允许”或永久授权。完整参数按用户选择展示，不截断。

## 六、兼容边界

- 不增加依赖，不修改 `pnpm-lock.yaml`。
- 不修改 Tool 名称、description、输入 Schema 或 `permission_level` 映射。
- 不修改 Memory、Profile 或 checkpointer 的数据库 Schema。
- 不迁移到 `createAgent`，继续保留现有 Context 投影、裁剪、自动压缩和运行时模型选择。
- Tool 内部已有的敏感路径、网络目标、超时和输出上限继续生效；用户批准不代表绕过这些校验。
- System Prompt 中“拒绝后不得换用其他 Tool 绕过”的规则保持不变。

## 七、测试与验收

1. 无 ToolCall 时不触发中断，模型正文正常流式返回。
2. 产生 ToolCall 后，在用户决定前 Tool 函数调用次数为零。
3. 批准后 Tool 只执行一次，并将结果返回模型。
4. 拒绝后 Tool 不执行，模型收到同一 `tool_call_id` 的错误 ToolMessage。
5. 多 ToolCall 支持全部批准、全部拒绝和混合决定，顺序与调用列表一致。
6. 确认请求展示完整参数，权限等级来自注册表。
7. 未提供确认回调时默认拒绝。
8. 使用相同 `thread_id` 恢复后，不重复写入用户消息或 ToolCall。
9. Tool 执行失败、超大输出外置、Memory、Profile 和 Context 流程继续通过现有回归。
10. `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过。

## 八、实现验证

当前实现已经完成：

- `model_request` 与 `tools` 之间新增 `authorize_tools` 动态中断节点。
- Agent 使用 `messages`、`updates` 双流捕获确认请求，并使用同一 `thread_id` 恢复。
- CLI 逐项展示完整参数，支持批准、默认拒绝、显式拒绝和无效输入重试。
- 未提供确认回调时全部拒绝，获批前不会输出 Tool 执行日志或调用 Tool 函数。
- 拒绝结果使用 `ToolMessage(status: "error")` 返回模型；混合决定只执行获批调用。

验证结果：

- `pnpm typecheck` 通过。
- `pnpm test --runInBand` 通过，共 34 个测试套件、210 条测试。
- `pnpm build` 通过。
- `git diff --check` 通过。
- 专项回归覆盖确认前零执行、可信权限载荷、批准、拒绝、混合决定、错误决定数量、默认拒绝、回调顺序和 CLI 输入解析。
