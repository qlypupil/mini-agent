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

## 后续演进：相对日期锚定

当前实现不再把所有天气等实时请求直接交给 `web_search`。用户的问题包含“当前”“现在”“今天”“明天”“后天”等相对日期，并询问天气、新闻、价格或体育信息时，模型必须按顺序执行：

```text
current_time
  -> 等待本机日期与时区结果
  -> web_search（查询词包含明确的 YYYY-MM-DD 日期）
  -> 使用 current_time 结果校验今天／明天／后天等日期标签
  -> 最终答复
```

`current_time` 和 `web_search` 不能在同一批 ToolCall 中提出，因为搜索查询需要使用前一个 Tool 返回的日期。接入 human-in-the-loop 后，两个调用分别等待用户确认；用户拒绝或 Tool 失败时，模型不得猜测日期，也不得用另一个 Tool 绕过拒绝。

该顺序不暂停每轮 Profile／Memory 判断。消息同时包含明确的当前用户属性时，独立的持久化 Tool 可以和 `current_time` 位于第一批调用，但 `web_search` 仍必须等待下一轮。例如当前 Profile 尚无郑州信息时，“我的城市在郑州，你查下当前的天气吧”应先提出 `current_time` 与 `profile_update`，收到结果后再提出带明确日期的 `web_search`。没有成功的 `profile_update` ToolMessage 时，最终答复不得声称画像已经更新。

搜索结果可能包含旧页面、跨时区日期或相互冲突的预报。模型必须以 `current_time` 返回的本机日期和时区为相对日期基准：

- 搜索词应包含地点、主题和明确日期，例如 `郑州天气 2026-08-03`。
- “今天”只能对应本机当前日期，“明天”和“后天”分别由该日期递增一天和两天。
- 结果日期与基准不一致时，不能把旧日期标成今天或明天；没有匹配日期的可靠结果时，应明确说明未检索到对应日期的信息。
- 不含相对日期的普通实时查询仍直接调用 `web_search`，不额外调用 `current_time`。

顺序约束同时写入 System Prompt、`current_time` description 和 `web_search` description，避免模型只根据 Tool 元信息选型时跳过前置步骤。它只调整 Tool 选择与结果解释，不修改两个 Tool 的输入输出契约、权限等级或执行实现。

### 当前验证

- Prompt 回归覆盖严格两阶段流程、同批调用禁令、明确日期查询、相对日期标签校验、失败时禁止猜测，以及 Profile／Memory 独立判断。
- Tool 注册回归确认 `current_time` 与 `web_search` descriptions 同步包含前置 ToolMessage、禁止同批调用和 `YYYY-MM-DD` 查询要求。
- 真实 Kimi 对“我的城市在郑州，你查下当前的天气吧”先提出 `current_time` 与 `profile_update`，收到模拟成功结果后再查询 `郑州天气 2026-08-03`；最终正确标注今天 8 月 3 日、明天 8 月 4 日和后天 8 月 5 日。
- 真实 DeepSeek 首轮曾把 `current_time` 与无日期搜索并发，强化状态机和 Tool descriptions 后复测通过；最终第一批提出 `current_time` 与 `profile_update`，第二批查询 `郑州 天气 2026-08-03 今天`，日期标签正确。
- 真实模型验证只模拟 ToolMessage，没有执行 Profile 写入或 Tavily 搜索，未修改项目 `.data`。
- `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过，共 34 个测试套件、214 条测试。
