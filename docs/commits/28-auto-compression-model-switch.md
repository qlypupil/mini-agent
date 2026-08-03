# 28 自动 Context 压缩与模型切换

## Commit 信息

- Commit：[`2ffc47f`](https://github.com/qlypupil/mini-agent/commit/2ffc47f2a4eb16ffb06ffdbaed9b8acd36307f37)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

上一阶段只能手动管理 Context，80% 告警也不会自动减少模型输入。同时单一 Kimi 配置在服务过载时没有切换路径。

本提交同时建立：

1. 达到阈值后的累计 Context 摘要。
2. Kimi 与 DeepSeek 的运行时模型切换。
3. `/model` 和 `/context` 的方向键交互菜单。

这三部分通过 StateGraph Runtime Context 连接，但都不重写 SQLite 原始聊天记录。

## 自动压缩选择范围

默认保留最近 6 条消息：

```ts
export const RECENT_CONTEXT_MESSAGES_TO_KEEP = 6
```

如果第 6 条边界落在 AI ToolCall 与 ToolMessage 之间，保留边界会向前扩展，直到整组 Tool 协议都处于保留区。实际保留数量因此可能超过 6 条。

## 增量累计摘要

压缩状态包含：

```ts
interface ContextCompression {
  summary: string
  compressedMessageIds: string[]
  compressionCount: number
  updatedAt: string
}
```

每次压缩只选择：

- 位于保留区之前。
- 尚未出现在 `compressedMessageIds` 中。

的新消息。模型接收“已有摘要 + 新增历史”，生成新的累计摘要。这样不会在每次达到阈值时重复总结全部旧消息。

如果缓存中的任意 message ID 已经不在当前线程，缓存会视为失效，避免把其他历史版本的摘要错误套用到当前消息。

## 非持久化投影

下一轮请求前，Graph 用一个摘要 HumanMessage 替换已压缩 ID 对应的消息，仅构造模型输入：

```text
SQLite state：原始 messages 保持完整
模型输入：累计摘要 + 最近未压缩消息
```

摘要不会通过 `RemoveMessage` 写回 checkpointer。

## 压缩缓存

`ContextCompressionStore` 保存到：

```text
.data/context-compression/<sha256(thread_id)>.json
```

- 文件名不直接暴露原始线程 ID。
- 数据带版本号和运行时结构校验。
- 写入临时文件后 `rename`，避免进程中断留下半个 JSON。
- 无效 JSON 或版本不匹配按无缓存处理。

## 压缩提示

- 压缩结果从下一轮模型请求开始使用。
- 失败时保留原历史和旧缓存，下一次达到阈值时可重试。
- 累计压缩达到 3 次后强烈建议 `/new`，但不会停止继续压缩。

## 模型注册表

```ts
export const MODEL_PROVIDERS = ['kimi', 'deepseek'] as const
```

每个模型定义独立的 API Key、Base URL、模型名环境变量和默认值。默认仍为 Kimi；DeepSeek 使用官方 OpenAI 兼容地址和 `deepseek-v4-flash`。

DeepSeek thinking mode 被关闭，因为标准 Tool 循环不会回传其要求的 `reasoning_content`：

```ts
modelKwargs: {
  thinking: { type: 'disabled' },
}
```

## 动态模型注入

Graph 不再固定绑定一个模型实例。本轮模型通过 Runtime Context 传入：

```text
CLI 当前 provider
  -> Agent 取得或缓存对应 ChatOpenAI
  -> graph runtime.context.model
  -> model_request.bindTools(tools)
```

切换模型只影响后续模型调用和摘要调用，不改变 `thread_id`、checkpointer 消息或压缩缓存。

## 交互菜单

裸 `/model` 与 `/context` 在 TTY 中显示方向键菜单；完整子命令仍保留，非 TTY 环境使用文本回退。菜单退出后必须恢复 readline 和 raw mode 状态。

## 验证

- 保留最近消息和跨边界 Tool 组。
- 已压缩 ID 不重复处理。
- 累计摘要、缓存校验和原子写入。
- Graph 只投影摘要，不修改 SQLite。
- Kimi/DeepSeek 配置、缺失 Key、模型上限和动态注入。
- TTY 方向键菜单及非 TTY 回退。
- DeepSeek 真实接口和流式回复验证。

## 当时的边界

- 压缩在 CLI 层判断阈值并编排，职责仍偏向交互层。
- 摘要是有损信息变换。
- 自动压缩依赖额外一次模型请求。
- 缓存与 checkpointer 分开，修改历史时必须清理或校验缓存。
