# 31 统一 Tool 错误协议

## Commit 信息

- Commit：[`57bd4aa`](https://github.com/qlypupil/mini-agent/commit/57bd4aaf693feb2ede5dbc942ac80e64cc7eb32c)
- 类型：`fix`
- 状态：历史实现

## 问题与目标

部分 Tool 在失败时返回普通字符串，例如 `Error: ...`。对 LangGraph 来说，这仍是一次成功返回，因此生成的 ToolMessage 没有错误状态，CLI 可能显示“completed”。

本提交统一原则：成功返回内容，失败抛出异常。

## 旧协议的问题

```ts
return 'Error: Request timed out.'
```

这个字符串对人类看起来像错误，但协议层只看到正常 resolved Promise：

```text
Tool Promise resolved
  -> ToolMessage(status 非 error)
  -> CLI 可能显示成功
  -> 模型也要靠解析文本猜测失败
```

## 新协议

```ts
throw new Error('Request timed out.')
```

LangGraph `ToolNode` 会把 Tool 抛出的异常转换成：

```text
ToolMessage {
  status: 'error',
  content: '...'
}
```

这里没有在自定义 Graph 节点里重新实现一套异常捕获；核心是让具体 Tool 正确抛错，再复用 `ToolNode` 的标准错误消息协议。

## 调整范围

- `load_skill`：未知 Skill 或读取失败改为抛错。
- `run_js`：Node 缺失、启动失败、超时、输出超限、执行失败和源码超限改为 reject/throw。
- `run_py`：对应失败分支改为 reject/throw。
- `web_fetch`：重定向、HTTP、超时和网络失败改为抛错。
- 相关测试从断言错误字符串改为断言 Promise rejected。

成功返回值保持原样，不改变模型正常读取 Tool 内容的方式。

## Graph 回归测试

Fake Tool 主动抛出 `tool failed`，Graph 执行工具循环后检查下一次模型请求中的 ToolMessage：

```ts
expect(toolMessage).toMatchObject({
  status: 'error',
  content: expect.stringContaining('tool failed'),
})
```

这验证了“具体 Tool 抛错 → ToolNode 错误消息 → 模型接收错误状态”的完整链路。

## CLI 影响

CLI 已根据 ToolMessage `status` 展示 completed 或 failed。协议统一后，CLI 不再依赖工具是否恰好返回带 `Error:` 的字符串。

## 验证

- 各 Tool 失败测试改为 rejection。
- Graph 错误状态回归。
- 类型检查、全部测试、构建和差异检查通过。
- `docs/反馈/tool.md` 将第一项问题标记完成。

## 当时的边界

- 外部 SDK 如果返回业务错误对象但不抛异常，适配 Tool 仍需主动判断。
- ToolMessage 错误内容仍会进入聊天历史和 Context。
- 统一错误协议不负责重试或错误恢复策略。
