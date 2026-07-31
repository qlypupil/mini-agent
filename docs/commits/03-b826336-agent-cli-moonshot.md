# 03 添加 Agent CLI 与 Moonshot 集成

## Commit 信息

- Commit：[`b826336`](https://github.com/qlypupil/mini-agent/commit/b826336eecc2aa40b89ab6eb222e8e208f3ab033)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

依赖已经就绪，但项目还不能和模型对话。本提交建立第一个可用闭环：终端接收用户输入，Agent 调用 Moonshot，模型需要时调用示例 Tool，最终回复以流式 token 输出。

## 总体流程

```text
readline 获取用户输入
  -> runAgentStream()
  -> LangChain createAgent
  -> ChatOpenAI 调用 Moonshot 兼容接口
  -> 可选 search Tool
  -> streamMode: messages
  -> CLI 逐 token 输出正文
```

## 模型配置

模型使用 `ChatOpenAI`，但请求地址指向 Moonshot：

```ts
const model = new ChatOpenAI({
  model: 'moonshot-v1-8k',
  apiKey: MOONSHOT_API_KEY,
  configuration: {
    baseURL: 'https://api.moonshot.cn/v1',
  },
  streaming: true,
})
```

API Key 从环境变量读取；缺少 `MOONSHOT_API_KEY` 时在启动阶段直接报错，避免发起注定失败的请求。`.env.example` 只声明变量名，不保存真实密钥。

## Agent 与示例 Tool

本提交使用 `createAgent()` 将模型、系统提示词和一个固定结果的示例 `search` Tool 组合起来：

```ts
const agent = createAgent({
  model,
  tools: [search],
  systemPrompt: 'You are a helpful assistant.',
})
```

此时的 `search` 不是实时搜索服务，只根据查询内容返回两种天气文本。它的目的，是验证模型产生 ToolCall、Tool 执行、结果回传模型和最终回答这一整条协议。

## 流式输出过滤

`streamMode: 'messages'` 会产生模型消息、Tool 调用分片和其他图事件。CLI 只应显示模型正文，因此实现按节点和消息内容过滤：

```ts
if (metadata?.langgraph_node !== 'model_request') continue
if (!content || toolCallChunks.length > 0) continue
```

这避免将 Tool 参数 JSON 当成 AI 正文输出。正文 token 同时传给回调并累加到 `fullResponse`，调用方既能实时展示，也能获得完整结果。

## CLI 职责

`src/agent/cli.ts` 使用 `readline` 循环完成：

- 展示 `You:` 提示符。
- 跳过空输入。
- 输入 `exit` 时关闭 readline 并退出。
- 调用 `runAgentStream()`。
- 用 `process.stdout.write()` 连续输出流式 token。
- 捕获请求异常并恢复下一轮输入。

## 变更文件

- 新增 `.env.example`、`src/agent/agent.ts` 和 `src/agent/cli.ts`。
- 更新 `package.json`，增加开发和生产启动脚本。
- 更新 README 与 Roadmap，说明配置和验证状态。

## 验证

- 构建后的 CLI 能连接 Moonshot。
- 输入 `hi` 与 `who are you` 都收到正常流式回复。
- 示例 Tool 链路可由模型触发。

## 当时的边界

- 虽然请求配置包含 `thread_id`，但 Agent 没有 checkpointer，因此不会保存多轮历史。
- Moonshot Base URL 仍然硬编码。
- 示例 `search` 不访问真实网络。
- 流式事件仍使用部分 `any`。

后续提交分别解决可配置 API 地址和真正的会话状态。
