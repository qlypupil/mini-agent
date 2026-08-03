# 23 添加 `/sessions` 会话列表命令

## Commit 信息

- Commit：[`d20145e`](https://github.com/qlypupil/mini-agent/commit/d20145e)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

`/new` 能创建新线程，但旧线程只存在数据库中，用户不知道有哪些会话，也无法获得用于后续恢复的 `thread_id`。

本提交增加只读 `/sessions`，列出最近 20 个有用户消息的会话。

## 查询流程

```text
/sessions
  -> 打开 SqliteSaver
  -> 初始化空数据库 Schema（如需要）
  -> 每个 thread 选择最新 checkpoint
  -> 通过 saver 反序列化 checkpoint
  -> 从 messages 逆序查找最后一条 HumanMessage
  -> 按 checkpoint 时间排序
  -> 截取最近 20 条并格式化
```

SQL 使用窗口函数：

```sql
ROW_NUMBER() OVER (
  PARTITION BY thread_id
  ORDER BY checkpoint_id DESC
)
```

这样每个线程只处理最新 checkpoint，避免同一会话在列表中出现多行。

## 消息提取

`getLastUserMessage()` 从后向前查找 `type === 'human'` 的消息，并兼容字符串或数组内容。空白被折叠，空内容会跳过。

列表不展示 AI 或 Tool 最后一条消息，因为用户更容易通过自己最后提出的问题识别会话。

## 展示规则

- 保留完整 `thread_id`，便于恢复。
- 用户输入最多显示 50 个 Unicode 字符。
- 时间显示为“刚刚”“N 分钟前”“N 小时前”“N 天前”或本地日期。
- 空数据库返回“暂无聊天记录”。

首版使用 Markdown 风格管道表格，并转义消息中的 `|`。

## 资源管理

查询函数在 `finally` 中关闭 SQLite 连接。命令只读数据库，不修改当前 `threadId`，也不调用 AI。

## 验证

- 最新 checkpoint 选择和排序。
- 最后一条 HumanMessage 提取。
- 数组消息内容转换。
- Unicode 截断和相对时间。
- 空列表与表格格式。
- 命令无参数校验及错误展示。

## 当时的边界

- Markdown 管道表格在终端宽度和中英文混排下对齐不稳定。
- 查询需要逐个调用 saver 反序列化最新 checkpoint。
- 只能查看，尚不能恢复会话。
