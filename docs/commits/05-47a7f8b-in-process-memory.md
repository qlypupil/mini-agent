# 05 添加 Agent 会话记忆

## Commit 信息

- Commit：[`47a7f8b`](https://github.com/qlypupil/mini-agent/commit/47a7f8ba3e9a1b38c5a0403ca7da7bdd276a8977)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

此前每次模型请求都只包含当前用户输入。即使 CLI 使用固定 `thread_id`，没有 checkpointer 时 LangGraph 也不会恢复上一轮消息。

本提交引入 `MemorySaver`，让同一 Node.js 进程内的多轮请求共享状态。

## 状态流程

```text
第 1 轮输入 + thread_id
  -> Agent 执行
  -> MemorySaver 保存图状态

第 2 轮输入 + 相同 thread_id
  -> MemorySaver 恢复历史
  -> 新消息追加到已有 messages
  -> 模型看到前后两轮内容
```

## 核心实现

```ts
const checkpointer = new MemorySaver()

const agent = createAgent({
  model,
  tools: [search],
  systemPrompt: 'You are a helpful assistant.',
  checkpointer,
})
```

调用 Agent 时继续使用：

```ts
configurable: {
  thread_id: threadId,
}
```

`MemorySaver` 负责保存状态，`thread_id` 负责决定读写哪一条会话。两者缺一不可。

## CLI 会话策略

当时 CLI 固定使用：

```ts
const THREAD_ID = 'user-session-1'
```

因此同一次 CLI 进程中的每轮输入会续接同一会话。这个策略简单，但还不能创建或切换多个会话。

## 验证

集成验证顺序：

1. 输入“我的名字是 Pupil”。
2. 再输入“我的名字是什么”。
3. 模型正确回答 `Pupil`。

这个验证证明第二轮模型请求确实读到了第一轮状态，而不是依赖当前输入猜测。

## 当时的边界

- `MemorySaver` 只存在于当前进程内。
- 关闭或重启 CLI 后历史全部丢失。
- 固定 ID 不代表跨进程持久化。
- 这仍然是聊天历史，不是经过筛选的长期记忆。

后续 SQLite checkpointer 提交将解决跨进程恢复问题。
