# 04 支持配置 Moonshot API 地址

## Commit 信息

- Commit：[`a36d2e8`](https://github.com/qlypupil/mini-agent/commit/a36d2e8bad4a9dbb638a5c9e688197cf6fdc7e26)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

首版 Moonshot Agent 将 API 地址直接写在源码中。这对官方接口可用，但无法支持代理网关、测试环境或其他 OpenAI 兼容入口。

本提交把“必须配置的密钥”和“可选配置的地址”分开：

- `MOONSHOT_API_KEY` 仍为必填。
- `MOONSHOT_BASE_URL` 改为可选，未配置时使用官方地址。

## 实现

```ts
const MOONSHOT_BASE_URL =
  process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1'
```

然后把计算后的地址传给 `ChatOpenAI`：

```ts
configuration: {
  baseURL: MOONSHOT_BASE_URL,
}
```

使用 `??` 而不是布尔短路，表达的是“没有提供值时使用默认配置”。这一改动不改变原有用户的默认运行行为。

## 配置与文档

- `.env.example` 增加 `MOONSHOT_BASE_URL` 示例。
- README 标明 API Key 必填、Base URL 可选。
- 不在仓库中写入任何真实密钥或内部网关地址。

## 影响范围

本提交只调整模型客户端初始化，不改变：

- Agent 的 Tool 列表。
- 流式消息处理。
- CLI 交互。
- 模型名称。

## 验证

```bash
pnpm typecheck
pnpm test --runInBand
pnpm build
```

## 当时的边界

- 环境变量只控制 Moonshot 地址，还没有多模型注册表。
- 错误地址或不兼容网关仍会在真实请求阶段失败。
- 会话历史仍未保存。

这个提交保持改动单一，为下一步接入 checkpointer 留出清晰基线。
