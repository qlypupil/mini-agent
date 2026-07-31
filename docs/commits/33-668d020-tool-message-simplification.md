# 33 简化历史 ToolMessage

## Commit 信息

- Commit：[`668d020`](https://github.com/qlypupil/mini-agent/commit/668d02046f7be675e7fda99d073a1ff4cea603a4)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

大输出外置只能处理单次特别大的结果。大量中小 ToolMessage 长期累积后，仍会反复进入模型请求，而多数历史工具细节已经被后续 AI 正文吸收。

本提交在模型请求前简化较早的 ToolMessage，只保留工具使用事实。

## 简化规则

历史结果被替换为：

```text
[Previous: used <toolName>]
```

但以下内容必须保留原文：

1. 不是 ToolMessage 的消息。
2. 当前轮最后一条 HumanMessage 之后的全部 ToolMessage。
3. 最近 3 条历史 ToolMessage。
4. 所有 `read_file` 结果。
5. 无法确定 Tool 名称的消息。

## 当前轮边界

函数从消息尾部向前找到最后一条 HumanMessage，把它作为当前轮开始位置。只有该位置之前的 ToolMessage 才属于历史候选。

这样一轮中模型连续调用多个 Tool 时，前一个 Tool 结果不会在本轮下一次模型调用前被简化。

## Tool 名称恢复

ToolMessage 可能没有 `name`。实现先扫描所有 AIMessage 的 `tool_calls`，建立：

```text
tool_call_id -> toolName
```

然后优先使用 `message.name`，缺失时按 `tool_call_id` 回溯。仍无法识别时保留原文，避免生成误导性标签。

## 为什么 `read_file` 例外

读取的文件内容通常是后续代码分析的直接依据。只保留“曾经使用 read_file”会让模型失去文件事实，却可能继续基于已经看不到的内容推理。

其他 Tool 也可能有重要结果，但本提交按需求只为 `read_file` 设置永久例外。

## 非持久化投影

```text
State/checkpointer：原 ToolMessage 原文
模型请求数组：旧 ToolMessage 替换为简短标记
```

函数克隆需要简化的 ToolMessage，并保留 ID、调用 ID、状态和元数据。它不会调用 `agent.updateState()` 或写回 SQLite。

## 请求位置

Graph 在应用手动 Context 或自动压缩投影后调用：

```ts
const messages = simplifyHistoricalToolMessages(contextMessages)
```

然后才附加 SystemMessage 并调用模型。

## 验证

- 只修改 ToolMessage。
- 保留当前轮全部 Tool 结果。
- 保留最近 3 条历史结果。
- 永久保留 `read_file`。
- 从 AI ToolCall 回溯名称。
- 未知名称不修改。
- 多 Tool 当前轮和 checkpointer 原文回归。

## 当时的边界

- 简化规则基于消息数量，不判断 Tool 结果语义重要性。
- `read_file` 原文长期积累仍可能很大。
- 模型只知道旧 Tool 曾被使用，不知道结果细节。
- 消息总数仍可能无限增长，下一提交增加硬上限。
