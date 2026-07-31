# 24 支持 `/rewind` 恢复历史会话

## Commit 信息

- Commit：[`f77ed9c`](https://github.com/qlypupil/mini-agent/commit/f77ed9c)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

`/sessions` 能显示历史线程 ID，但 CLI 仍无法切换回这些线程。本提交增加 `/rewind <thread_id>`，让后续模型请求续接指定 SQLite 会话。

## 命令流程

```text
/rewind <thread_id>
  -> 校验参数数量为 1
  -> hasChatSession(thread_id)
  -> 不存在：输出未找到
  -> 存在：把 CLI 当前 threadId 替换为目标 ID
  -> 下一条普通输入使用该 ID 调用 Agent
```

命令本身不会立即加载消息到 CLI，也不会调用模型。真正恢复发生在下一轮 Agent 调用时，SqliteSaver 根据新的 `thread_id` 读取 checkpoint。

## 会话存在性检查

`hasChatSession()` 使用参数化 SQL：

```sql
SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1
```

它只检查记录是否存在，不读取完整消息，也不修改数据库。空字符串直接返回 `false`。

首次使用命令时数据库可能尚未初始化，因此先通过 saver 的 `getTuple()` 触发 Schema 初始化，再执行查询。

## 命令上下文扩展

`InteractiveCommandContext` 新增：

```ts
rewindSession: (threadId: string) => Promise<boolean>
```

命令模块只依赖这个接口，不直接持有 CLI 变量或 SQLite 连接。CLI 决定如何切换当前线程，存储模块决定如何验证线程存在。

## 错误处理

- 参数不是一个：显示 `/rewind <thread_id>` 用法。
- 线程不存在：显示“未找到会话”。
- 数据库异常：显示“恢复会话失败”及错误信息。
- 成功：显示恢复后的完整 ID。

## 验证

- 存在和不存在的线程查询。
- 空数据库自然返回不存在。
- 命令参数校验和异常分支。
- 构建产物恢复指定测试会话且不调用 AI。

## 当时的边界

- 名称叫 `rewind`，实际语义是切换到历史线程最新 checkpoint，不是把当前线程回滚到某个中间 checkpoint。
- 不显示线程标题或别名，只使用 UUID。
- 不合并当前会话与目标会话。
