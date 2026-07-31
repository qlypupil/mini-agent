# 29 将自动压缩编排移入 Agent 层

## Commit 信息

- Commit：[`ed2840d`](https://github.com/qlypupil/mini-agent/commit/ed2840de59c6a0ed88618d0f673f1fb60a702c7c)
- 类型：`refactor`
- 状态：历史实现

## 问题与目标

自动压缩已经实现，但阈值判断、压缩调用和异常收敛写在 `cli.ts`。这意味着其他调用方使用 Agent API 时无法复用完整自动压缩规则，CLI 也承担了核心业务职责。

本提交把自动压缩编排迁移到 `agent.ts`，CLI 只负责触发和展示。

## Agent API

新增状态化返回类型：

```ts
type AutomaticContextCompressionResult =
  | { status: 'not-needed' }
  | { status: 'completed'; compression: ContextCompressionResult }
  | { status: 'failed'; error: string }
```

`compressChatContextIfNeeded()` 完成：

1. 根据 ContextUsage 判断是否达到 80%。
2. 未达到时返回 `not-needed`。
3. 达到时调用可选 `onStart`。
4. 执行核心压缩 API。
5. 将异常转换为 `failed` 状态。

## 职责变化

```text
之前：CLI 判断阈值 -> try/catch -> 调 Agent 压缩 -> 拼状态
之后：CLI 调 Agent API -> 根据返回状态展示文字
```

Agent 层拥有：

- 什么时候需要压缩。
- 调哪个模型。
- 如何执行压缩。
- 失败如何收敛为稳定结果。

CLI 层保留：

- 黄色开始提示。
- 成功、无新增历史和失败文案。
- 累计 3 次后的 `/new` 强提醒。

## 可测试性

API 的 `options.compress` 允许测试注入替代实现，`onStart` 可以单独断言触发时机，不需要真实模型或终端。

测试覆盖 `not-needed`、成功和失败三个分支，证明核心行为不依赖 CLI。

## 保持不变的行为

- 摘要仍使用独立模型请求。
- 缓存仍按 thread 保存。
- SQLite 原始历史不修改。
- 压缩结果仍从下一轮请求生效。

## 设计意义

Context 压缩属于 Agent 如何管理模型输入的核心能力，不属于终端如何显示状态。迁移后，未来 HTTP、桌面或其他客户端都可以调用同一个压缩 API。

## 验证

- Agent 层单元测试。
- CLI 状态展示回归。
- 类型检查、测试、构建和差异检查。

## 当时的边界

- CLI 仍在每轮成功回复后主动调用自动压缩 API。
- Agent 不会在任意调用方完全忘记触发时自行运行后台任务。
- 自动压缩失败仍需等下一轮阈值检查重试。
