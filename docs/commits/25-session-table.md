# 25 使用终端表格展示会话列表

## Commit 信息

- Commit：[`965402a`](https://github.com/qlypupil/mini-agent/commit/965402a)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

`/sessions` 首版使用 Markdown 管道表格。终端不会像 Markdown 渲染器一样计算列宽，中英文宽度和长 UUID 会导致视觉错位。

本提交引入 `cli-table3`，只替换展示层，不改变 SQLite 查询和会话数据结构。

## 格式化变化

此前手工拼接：

```text
| thread_id | 最后用户输入的问题 | 时间 |
| ...       | ...                | ...  |
```

改为：

```ts
const table = new Table({
  head: ['thread_id', '最后用户输入的问题', '时间'],
})

table.push([threadId, lastUserMessage, relativeTime])
return table.toString()
```

`cli-table3` 负责边框、列宽和 Unicode 终端字符，不再需要手工转义管道符。

## 保持不变的行为

- 每个线程只取最新 checkpoint。
- 只展示最后用户输入。
- 消息最多 50 个 Unicode 字符。
- 保留完整 `thread_id`。
- 使用相对时间。
- 空列表仍返回本地提示。

这说明本提交是展示层重构，不改变 `/sessions` 的业务语义。

## 依赖取舍

终端表格涉及中英文宽度、边框和 ANSI 控制字符，手工实现容易出现大量布局边界。引入专用轻量库比继续扩展字符串拼接更可维护。

## 验证

- 测试断言 Unicode 边框和表头。
- 验证完整线程 ID、截断消息和相对时间仍存在。
- 类型检查、测试和构建通过。
- 构建产物 `/sessions` 在终端正确显示边框表格。

## 当时的边界

- 极窄终端仍可能换行。
- 没有交互式选择或方向键恢复。
- 表格只展示最多 20 条最近会话。
