# 22 支持通过 `/new` 开启新会话

## Commit 信息

- Commit：[`63c5593`](https://github.com/qlypupil/mini-agent/commit/63c5593)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

SQLite 已能持久化历史，但固定 `user-session-1` 会让每次 CLI 启动继续同一个会话，用户无法主动开始空白上下文。

本提交引入本地 slash 命令分发器和 `/new`，并把当前 `threadId` 改为可切换状态。

## 会话 ID 策略

```ts
let threadId = randomUUID()
```

每次 CLI 启动先生成一个独立线程，避免无意混入旧会话。执行 `/new` 时再次生成 UUID：

```ts
startNewSession: () => {
  threadId = randomUUID()
}
```

旧线程仍保存在 SQLite 中，只是当前 CLI 后续请求改用新 ID。

## 本地命令分发

```text
用户输入
  -> 是否以 / 开头
  -> parseInteractiveCommand()
  -> 查找本地 handler
  -> 已处理则返回 true
  -> CLI 不向 AI 发送该输入
```

解析结果同时保留：

- 小写命令名。
- 按空白切分的 `args`。
- 未丢失格式的 `rawArgs`。

这为后续需要复杂参数的 `/context` 等命令保留扩展空间。

## `/new` 行为

- 不接受额外参数。
- 本地生成新 ID。
- 输出“已开启新会话”。
- 不调用模型。
- 不删除原会话。

未知命令和空命令也在本地返回明确提示，不会误发给 AI。

## CLI 结构调整

原 `command.ts` 被移除，Commander 的顶层命令定义回到 `cli.ts`；新增 `interactive_command.ts` 专门负责聊天内 slash 命令。进程参数和聊天命令由此分成两个层次。

## 验证

- 解析普通输入、空命令、未知命令和 `/new`。
- `/new` 带参数时返回用法。
- 命令返回 `true` 后不会调用 Agent。
- 构建产物执行 `/new` 能切换会话。

## 当时的边界

- 用户看不到旧会话列表。
- 没有恢复指定线程的命令。
- CLI 重启后默认开启新线程，不自动恢复上一轮。
