# 27 使用 StateGraph 手动管理模型 Context

## Commit 信息

- Commit：[`c475136`](https://github.com/qlypupil/mini-agent/commit/c475136e4d64990010238eb9468bdcac970a4bb6)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

LangChain `createAgent` 会根据 checkpointer 状态自动把聊天记录传给模型，但项目需要更细的控制：删除某些消息、替换内容、把一段历史改成摘要，或者只让修改影响下一轮请求。

本提交改用自定义 LangGraph `StateGraph`，把“持久化消息状态”和“本轮模型实际看到的消息”分开。

## Graph 结构

```text
START
  -> apply_context
  -> model_request
       | 无 ToolCall -> END
       | 有 ToolCall
       v
      tools
       `-> model_request
```

Graph State 只声明 `messages`，由 SQLite checkpointer 持久化：

```ts
export const ChatState = new StateSchema({
  messages: MessagesValue,
})
```

本轮 Context 修改通过 Runtime Context 传递，不是 Graph State 的固定字段。

## ContextPatch

支持三类操作：

```ts
type ContextOperation =
  | { type: 'replace'; messageId: string; content: string }
  | { type: 'remove'; messageIds: string[] }
  | { type: 'replaceRange'; messageIds: string[]; summary: string }
```

修改基于 message ID，而不是直接依赖显示序号。序号只用于 CLI 选择，执行前会解析为稳定 ID。

## 三种应用方式

### `once`

在 `model_request` 节点临时计算：

```ts
const messages = control?.mode === 'once'
  ? applyContextPatch(state.messages, control.patch)
  : state.messages
```

修改后的数组只传给本轮模型，不重置 State，也不覆盖 SQLite 原历史。本轮新消息和最终回复仍会按正常流程追加到原线程。

### `persist`

`apply_context` 节点使用：

```ts
[
  new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
  ...patchedMessages,
]
```

先删除全部旧消息，再写入修改后的完整列表，因此会改变当前线程后续持久状态。

### `fork`

CLI 将修改后的消息写入一个新 `thread_id`，并切换当前会话。原线程保持不变，分支线程从修改结果继续。

## Tool 消息完整性

AI ToolCall 和对应 ToolMessage 是一组协议消息。只删除其中一部分会让模型收到无法匹配的调用或结果。

校验逻辑按 `tool_call_id` 建立消息组，要求任何编辑操作要么完整覆盖整组，要么完全不触碰。含 ToolCall 的 AIMessage 也不能直接替换正文。

## 摘要调用

`/context summarize` 使用独立的 `model.invoke()`：

- 不绑定 checkpointer。
- 不把内部摘要提示追加进聊天历史。
- 保留事实、需求、决策、待解决问题和重要 Tool 结果。
- 用摘要 HumanMessage 替换连续消息范围。

## CLI 命令

`/context` 支持查看、替换、删除、摘要、从文件加载摘要、预览、取消和应用。所有修改先进入暂存区，用户预览后再选择应用方式。

## 目录整理

同一提交将 `src/agent` 按职责整理为：

```text
cli/ runtime/ storage/ skills/ tools/
```

顶层保留 Agent API、CLI 入口和环境加载，使后续 Context、模型和存储能力有明确归属。

## 验证

- ContextPatch 目标存在、唯一和连续范围校验。
- Tool 消息组完整性。
- `once` 不改变 checkpointer，`persist` 重置当前线程，`fork` 创建新线程。
- 摘要使用独立模型调用。
- 自定义 Graph 的模型和 Tool 循环。
- CLI 命令分发及真实 Moonshot 流式回归。

## 当时的边界

- 手动修改由用户发命令触发，尚未自动压缩。
- 摘要质量依赖模型，可能遗漏细节。
- `persist` 是有意修改当前线程历史的操作。
- Runtime Context 投影解决“模型看到什么”，不减少 SQLite 原始存储体积。
