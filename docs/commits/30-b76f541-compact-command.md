# 30 添加 `/compact` 手动压缩命令

## Commit 信息

- Commit：[`b76f541`](https://github.com/qlypupil/mini-agent/commit/b76f5416638ef082292a2c821d361c5bae8798e9)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

自动压缩只在 Context 达到 80% 后触发。用户可能希望在切换任务、准备长操作或主动整理历史时提前压缩。

本提交增加 `/compact`，直接复用 Agent 核心压缩函数，不复制第二套摘要逻辑。

## API 命名

原 `compressChatContext()` 重命名为更直接的：

```ts
compressContext(threadId, modelProvider)
```

同时保留旧名称别名：

```ts
export const compressChatContext = compressContext
```

这样新增命令使用清晰名称，已有调用方不会立即失效。

## 命令流程

```text
/compact
  -> 校验无额外参数
  -> 输出“正在压缩”
  -> 调用当前 thread 和当前模型的 compressContext()
  -> 有新历史：展示压缩数量、保留数量和累计次数
  -> 无新历史：本地提示
  -> 失败：展示错误
```

命令不作为普通聊天消息发送给 AI。但如果存在待压缩历史，核心压缩函数仍会单独调用模型生成摘要，因此“本地命令”不等于“零模型调用”。

## 复用规则

手动与自动压缩共享：

- 最近 6 条消息保留。
- Tool 调用组边界保护。
- `compressedMessageIds` 去重。
- 累计摘要。
- 按 thread 的独立缓存。
- SQLite 原历史不修改。

手动命令绕过的只有 80% 阈值，不绕过压缩算法。

## 降级处理

命令上下文中的 `compressContext` 是可选能力。调用环境没有提供时，返回“当前环境不支持 Context 压缩”，而不是抛出未定义函数错误。

## 验证

- 参数校验。
- 无能力、无历史、成功、累计 3 次和失败分支。
- 空会话执行 `/compact` 不发送普通聊天请求。
- 类型检查、测试、构建和差异检查通过。

## 当时的边界

- 摘要仍可能丢失细节。
- 命令不能选择具体消息范围，精细操作仍使用 `/context`。
- 压缩结果从下一轮模型请求开始使用。
