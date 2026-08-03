# 07 支持 ESC 取消流式响应

## Commit 信息

- Commit：[`6031d91`](https://github.com/qlypupil/mini-agent/commit/6031d910061792fbbfc16d17da4e385db3c6d652)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

模型生成长回复时，用户此前只能等待请求完成或直接终止整个 CLI。目标是在不退出进程的情况下取消当前请求，并恢复到下一轮输入。

## 取消信号链路

```text
用户按 ESC
  -> CLI keypress 监听器
  -> AbortController.abort()
  -> signal 传入 runAgentStream()
  -> agent.stream(..., { signal })
  -> 当前模型请求中止
  -> CLI 捕获取消并恢复提示符
```

Agent API 增加可选 `AbortSignal`，只负责向下传递，不感知具体按键：

```ts
export async function runAgentStream(
  userMessage: string,
  onToken: (token: string) => void,
  threadId: string,
  signal?: AbortSignal,
)
```

## 终端按键监听

TTY 环境中启用 keypress 和 raw mode：

```ts
readline.emitKeypressEvents(process.stdin)
process.stdin.setRawMode(true)
```

检测到 ESC 后只调用当前请求的 Controller：

```ts
if (key.name === 'escape') {
  controller.abort()
}
```

非 TTY 环境没有原始按键事件，因此返回空清理函数，保证管道输入和自动化环境不因 `setRawMode` 报错。

## 清理保证

监听函数返回清理回调，在 `finally` 中执行：

- 移除 `keypress` 监听器。
- 关闭 raw mode。
- 无论正常完成、取消还是异常都恢复终端状态。

如果 `controller.signal.aborted`，CLI 显示“已取消当前请求”，而不是把取消当成普通模型错误。

## 验证

- 类型检查、测试和构建通过。
- 真实长响应中，3 秒后发送 ESC 能中止流式输出。
- 中止后重新显示 `You:`，进程可以继续聊天。
- 已自然结束的短回复不会被迟到的 ESC 追溯取消。

## 当时的边界

- raw mode 在每次请求开始和结束时切换，随后暴露了中文输入重复回显问题。
- 取消只能在 TTY 中通过 ESC 触发。
- 取消当前请求不会删除之前已经保存的会话历史。

下一提交调整 raw mode 生命周期，并把 Controller 与活动请求更紧密地绑定。
