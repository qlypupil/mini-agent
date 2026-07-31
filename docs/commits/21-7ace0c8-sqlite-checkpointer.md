# 21 使用 SQLite 持久化会话记忆

## Commit 信息

- Commit：[`7ace0c8`](https://github.com/qlypupil/mini-agent/commit/7ace0c8)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

`MemorySaver` 只能在当前 Node.js 进程中保存状态。CLI 退出后，之前的对话无法恢复。

本提交用 SQLite `SqliteSaver` 替换内存 checkpointer，使聊天状态跨进程持久化。

## 存储结构

```ts
export const CHECKPOINT_DATABASE_PATH = resolve(
  process.cwd(),
  '.data/checkpointer.db',
)

export function createCheckpointer(databasePath = CHECKPOINT_DATABASE_PATH) {
  mkdirSync(dirname(databasePath), { recursive: true })
  return SqliteSaver.fromConnString(databasePath)
}
```

数据库路径相对于启动 CLI 时的当前工作目录，因此不同项目目录可以拥有彼此独立的会话数据库。

`.data/` 加入 `.gitignore`，本地聊天记录不会进入 Git。

## 状态恢复流程

```text
Agent 调用 + thread_id
  -> SqliteSaver 查询该线程最新 checkpoint
  -> 恢复 LangGraph messages 和状态
  -> 执行本轮模型/Tool 循环
  -> 写入新的 checkpoint
```

Agent API 不需要自己序列化 BaseMessage；checkpointer 负责 LangGraph 状态协议。

## 历史时点说明

这个提交刚完成 SQLite 接入时，CLI 仍固定使用：

```ts
const THREAD_ID = 'user-session-1'
```

因此多次启动会自动续接同一个固定线程。每次启动生成随机会话 ID 的行为是在下一提交 `/new` 中引入的。

## 测试设计

测试使用临时数据库路径：

1. 创建 checkpointer。
2. 写入指定 `thread_id` 的 checkpoint。
3. 关闭或重新创建实例。
4. 使用相同线程读取状态。
5. 验证消息或标记完整恢复。

这样验证的是跨实例 SQLite 持久化，而不是同一个对象的内存缓存。

## 验证

- SQLite checkpointer 单元测试通过。
- 两次独立 CLI 进程使用相同线程，第二次能够恢复第一轮保存的信息。
- `.data/checkpointer.db` 在首次运行后创建。

## 当时的边界

- 固定线程会让所有启动共享同一历史。
- 还没有会话列表、创建和恢复命令。
- 这是完整聊天状态，不是筛选后的长期记忆。
- 数据库 Schema 由 LangGraph saver 管理，业务代码不应直接修改 checkpoint 内容。
