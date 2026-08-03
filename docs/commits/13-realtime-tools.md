# 13 接入实时搜索与本机时间工具

## Commit 信息

- Commit：[`b5ff031`](https://github.com/qlypupil/mini-agent/commit/b5ff031)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

原有 `search` Tool 返回固定天气文本，无法回答真实新闻、天气、价格或体育信息。模型自身知识也不能可靠回答“今天”和“现在”这类时间敏感问题。

本提交用两个不同来源解决实时信息：

- `current_time` 从运行 CLI 的本机获取时间。
- `web_search` 通过 Tavily 获取外部实时搜索结果。

## Tool 选择规则

系统提示词明确划分：

```text
当前日期或时间 -> 必须调用 current_time
新闻、天气、价格、体育等实时信息 -> 必须调用 web_search
其他非实时问题 -> 可以直接回答
```

这条规则很重要，因为“提供 Tool”不等于模型会稳定使用 Tool。对时间敏感问题，系统提示词必须阻止模型仅凭训练记忆作答。

## `current_time`

`current_time` 不需要模型参数，返回本机时间、时区和格式化信息。它的可信来源是运行 Agent 的操作系统，而不是模型猜测。

边界是本机时区：如果用户询问其他地区时间，首版 Tool 没有时区参数。

## `web_search`

本提交使用 `@langchain/tavily` 的原生 `TavilySearch`：

```ts
export const webSearchTool = new TavilySearch({
  name: 'web_search',
  maxResults: 3,
  topic: 'general',
  includeAnswer: true,
  tavilyApiKey: process.env.TAVILY_API_KEY,
})
```

选择原生 Tool 可以保持标准 ToolCall 和 ToolMessage 协议，避免手工包装结果时出现与 Moonshot 工具循环不兼容的问题。

## 环境加载

新增 `src/agent/env.ts`，把 dotenv 初始化集中起来。需要读取环境变量的模型和 Tool 都导入同一入口，减少模块加载顺序差异。

## Tool 事件

Agent 流式处理开始识别 Tool 的 started、completed 和 failed 状态，并通过 `onToolEvent` 交给 CLI 展示。ToolCall ID 用于防止同一个流式调用被重复报告。

## 迁移内容

- 删除固定结果的旧 `search.ts` 及测试。
- 新增 Tavily 搜索和本机时间实现及测试。
- 更新系统提示词、环境变量示例和 README。

## 验证

- 单元测试覆盖本机时间格式和 Tavily 配置。
- 类型检查、测试和构建通过。
- 真实新闻搜索可以返回外部结果并生成最终摘要。

## 当时的边界

- `web_search` 依赖 `TAVILY_API_KEY` 和外部服务可用性。
- 搜索结果质量与时效由 Tavily 决定。
- Tool 错误识别仍兼容解析普通 JSON 错误字段，尚未统一异常协议。
