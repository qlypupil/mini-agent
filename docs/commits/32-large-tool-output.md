# 32 持久化超大 Tool 输出并统一调用展示

## Commit 信息

- Commit：[`2fd6681`](https://github.com/qlypupil/mini-agent/commit/2fd6681a7f2fd8871985c193538e5e7d771901b0)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

Tool 可能返回大型文件、网页或命令输出。ToolMessage 会进入 Graph State，后续每次模型请求都携带完整内容，快速膨胀 Context。

本提交增加大输出外置，同时统一 Tool 名称日志和 `AI:` 标签的展示时机。

## 大输出判断

```ts
export const TOOL_OUTPUT_LENGTH_LIMIT = 50_000
export const TOOL_OUTPUT_PREVIEW_LENGTH = 2_000
```

- 字符串长度不超过 50,000 时原样返回。
- 超过阈值时把完整内容写入 `tool_output/`。
- ToolMessage 只保留路径、按 UTF-8 字节计算的大小和前 2,000 个字符预览。
- 非字符串 ToolMessage 不处理。

## 返回模型的格式

```text
<persisted-output>
Output too large (...KB).
Full output saved to: tool_output/tool_output_<tool_call_id>.txt
If you need the complete content, read it in segments.

Preview (first 2000 characters):
...
</persisted-output>
```

模型仍能判断结果性质，并可以后续使用文件读取能力分段获取完整内容。

## 文件名安全

正常 ToolCall ID 只允许字母、数字、下划线和连字符。其他字符被替换并附加原 ID 的 SHA-256 短 Hash：

- 防止 `/`、`..` 等内容改变输出目录。
- 避免不同非法 ID 规范化后发生明显冲突。
- 限制最终文件名长度。

## ToolMessage 元数据

生成新 ToolMessage 时保留：

- `tool_call_id` 和 `name`。
- `status`。
- `id`、artifact、metadata。
- additional kwargs 和 response metadata。

只替换 `content`，保证模型仍能把结果与 AI ToolCall 正确匹配。

## 写入失败

如果大输出无法保存，系统返回 `<persisted-output-error>`，包含失败原因和前 2,000 字符预览，并将 ToolMessage 标记为 `error`。辅助持久化失败不会丢失所有诊断信息，也不会伪装成成功。

## Graph 接线

原生 `ToolNode` 被包装为自定义 `toolNode`：

```text
读取最后一条 AIMessage.tool_calls
  -> 执行前打印 [Tool] <name>
  -> 调用 ToolNode
  -> 处理结果中的 ToolMessage
  -> 大输出外置
  -> 返回 Graph
```

因此写入 checkpointer 和传给下一次模型调用的已经是精简结果，而不是超大原文。

## CLI 标签修复

`AI:` 不再在请求开始时立即打印，而是在首个用户可见正文 token 到达时打印。纯 ToolCall、请求失败、空回复或取消时不会出现空的 AI 回答标签。

Tool 名称由 Graph 在实际执行前统一打印，具体 Tool 和 CLI 不再重复输出 started/completed 日志；失败信息仍由 CLI 展示。

## 验证

- 50,000/50,001 字符边界。
- UTF-8 大小展示。
- 安全文件名和相对路径。
- 2,000 字符预览。
- 非字符串透传。
- ToolMessage 元数据保留。
- 写入失败错误状态。
- Graph 调用顺序和正文首 token 标签。

## 当时的边界

- 阈值按 JavaScript 字符串长度判断，显示大小按 UTF-8 字节计算。
- 输出文件是本地缓存，没有自动淘汰机制。
- 已经存在于更早 checkpoint 的大 ToolMessage 不会被追溯外置。
- 模型如需完整输出，仍要主动读取文件。
