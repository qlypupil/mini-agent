# 26 显示 Context 用量并提示新会话

## Commit 信息

- Commit：[`e8ce501`](https://github.com/qlypupil/mini-agent/commit/e8ce501)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

SQLite 会持续积累聊天消息，但用户此前看不到模型请求已经使用多少 Context，也不知道何时接近接口上限。

本提交在每轮成功回复后显示最终模型请求的输入 token、已知上下文上限和百分比，并在达到 80% 时建议开启新会话。

## Context 数据来源

Agent 在流式消息中收集模型返回的 `usage_metadata`，然后选择最后一个包含 `input_tokens` 的值：

```ts
export function getLatestInputTokens(usageMetadata: unknown[]) {
  let inputTokens: number | undefined
  for (const usage of usageMetadata) {
    if (typeof usage.input_tokens === 'number') {
      inputTokens = usage.input_tokens
    }
  }
  return inputTokens
}
```

一次 Agent 运行可能经历多次模型调用，例如模型先生成 ToolCall，再读取 Tool 结果生成正文。最后一次请求通常包含最完整的本轮 Context，因此展示最后一个 usage，而不是求和。

## 模型上限

当时默认模型改为 `kimi-k2.6`，已知上限映射为：

```ts
const MODEL_CONTEXT_LIMITS = {
  'kimi-k2.6': 262_144,
}
```

模型名称可通过环境变量覆盖。未知模型没有可靠上限时显示“未知”，不猜测百分比。

## 展示格式

```text
Context: 1,830 / 262,144 tokens (0.70%)
```

数字按英文千分位格式化，百分比保留两位小数。缺少 usage 或上限时对应字段显示“未知”。

## 80% 判断

```ts
inputTokens / contextLimit >= 0.8
```

判断使用未格式化的原始数值，因此恰好 80% 会触发警告，不受显示时四舍五入影响。

警告内容说明：

- Context window 接近接口上限。
- 即将需要压缩，可能丢失信息。
- 建议使用 `/new` 开启新会话。

这个提交只有提示，没有真正执行自动压缩。

## 验证

- 已知与未知模型上限。
- 多个 usage 中选择最后一个有效输入 token。
- 缺失 usage 的格式化。
- 79.99%、80% 和超过 80% 的边界。
- 构建产物真实回复后显示 Context 用量。

## 当时的边界

- 依赖模型 API 返回 usage metadata。
- 上限映射需要随模型配置维护。
- 只告警，不减少发送给模型的消息。
- token 百分比是最终模型请求的输入占用，不是整轮所有调用的计费 token 总和。
