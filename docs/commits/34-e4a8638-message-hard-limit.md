# 34 增加模型请求消息硬上限

## Commit 信息

- Commit：[`e4a8638`](https://github.com/qlypupil/mini-agent/commit/e4a8638172a4c70e7ae0167a3c03793fec8cf2d2)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

项目已经有三层 Context 治理：大 Tool 输出外置、历史 ToolMessage 简化和 80% 自动摘要。但任何一层都可能因为模型 usage 缺失、摘要失败或大量短消息而无法及时阻止消息数组继续增长。

本提交增加最后一道按消息数量计算的硬保护：模型请求最多投影 300 条聊天消息。

## 裁剪位置

Graph 的请求顺序变为：

```text
原始 State messages
  -> 手动 ContextPatch 或自动压缩投影
  -> trimModelContextMessages()
  -> simplifyHistoricalToolMessages()
  -> 前置 SystemMessage
  -> modelWithTools.invoke()
```

因此 300 条上限只计算聊天消息，不包含额外添加的 SystemMessage。

## 基础规则

```ts
export const MAX_MODEL_CONTEXT_MESSAGES = 300
```

- `messages.length <= 300` 时不修改。
- 没有自动摘要时保留最新 300 条。
- 裁剪只影响本次模型输入，不修改 Graph State 或 SQLite checkpointer。

## 固定保留自动摘要

自动压缩生成的摘要消息增加稳定 ID：

```ts
const AUTOMATIC_CONTEXT_SUMMARY_MESSAGE_ID =
  '__termclaw_automatic_context_summary__'
```

如果摘要位于最新 300 条之外，裁剪会删除窗口中最早的一条普通消息，为摘要保留一个位置：

```text
自动摘要 + 最新 299 条消息
```

稳定 ID 避免用内容字符串猜测哪条消息是系统生成的累计摘要。

## Tool 协议完整性

简单截取可能把 AI ToolCall 留在窗口外，却把对应 ToolMessage 留在窗口内，或反过来。

实现复用 Tool 消息组识别：

- 整组都在保留集合中：保留。
- 整组都不在保留集合中：忽略。
- 只有部分进入集合：删除整组已选中的消息。

因此最终数量可能少于 300，但不会为了凑满数量发送不完整 Tool 协议。

## 与其他压缩层的关系

| 机制 | 解决的问题 | 是否改 SQLite |
| --- | --- | --- |
| 大输出外置 | 单条 Tool 结果过大。 | 新结果写入前即精简，原文写本地文件。 |
| ToolMessage 简化 | 历史工具结果重复占用。 | 否。 |
| 自动摘要 | 总 token 接近模型上限。 | 否。 |
| 300 条硬上限 | 消息数量失控的最终保护。 | 否。 |

硬上限不能替代 token 阈值：300 条短消息可能很小，几十条大消息也可能超限。两种指标解决不同风险。

## 验证

- 300 条不裁剪，301 条开始裁剪。
- 无摘要时保留最新消息。
- 有摘要时固定保留摘要和最新 299 条。
- 裁剪边界中的 Tool 组被完整删除。
- 原输入数组和 checkpointer 历史不变。
- Graph 调用顺序为先裁剪、后 ToolMessage 简化。

## 当时的边界

- 按消息数量裁剪不理解语义重要性。
- 跨边界 Tool 组删除后不会回填更旧消息。
- SystemMessage 不计入 300 条，但仍消耗 token。
- SQLite 历史仍可持续增长；这个保护只控制模型请求。
