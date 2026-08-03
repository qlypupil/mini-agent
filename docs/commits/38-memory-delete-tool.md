# 38 长期记忆删除 Tool 实现说明

## Commit 信息

- Commit：[`f02c5fa`](https://github.com/qlypupil/mini-agent/commit/f02c5fac52865c3b6e6c73e8c49e9af5c404a17a)
- 类型：`feat`
- 状态：当前实现
- 基线：`34e26ea docs: 补齐长期记忆检索提交信息`
- 实现范围：`memory_delete` Tool、按 ID 删除、FTS5 触发器同步、模型调用规则与回归测试。

## 一、背景

长期记忆当前已经形成创建和检索闭环：

1. `memory_create` 将具有未来价值的用户信息写入 `memory`。
2. `memory_fts` 通过外部内容表和触发器同步全文索引。
3. `memory_retrieve` 根据模型整理的关键词返回最多 5 条候选记忆及其 ID。

但用户要求“忘记”或“删除”某条记忆时，模型没有受控的删除入口。本阶段新增 `memory_delete`，让模型在用户明确授权且目标唯一时删除一条长期记忆。

## 二、目标与非目标

本次实现需要满足：

1. Tool 只接受一条已经确定的记忆 ID。
2. 用户只提供自然语言描述时，模型先调用 `memory_retrieve` 定位 ID。
3. 删除 `memory` 主表记录后，由现有触发器同步清理 `memory_fts` 索引。
4. 目标不存在时返回可识别的幂等结果，不把它伪装成执行错误。
5. 删除 Tool 不接收 `session_id`、关键词、SQL 或批量 ID。
6. 删除操作不修改 LangGraph checkpointer 中的会话历史。

本次不实现：

- 按关键词直接批量删除。
- 模糊匹配后自动删除多条候选。
- 软删除、回收站或撤销删除。
- 记忆更新、冲突合并和语义去重。
- 多用户权限与用户归属隔离。

## 三、核心决策

| 决策 | 方案 |
| --- | --- |
| Tool 名称 | `memory_delete` |
| Tool 文件 | `src/agent/tools/memory_delete_tool.ts` |
| 模型输入 | `id: number` |
| ID 边界 | 正整数，且不超过 `Number.MAX_SAFE_INTEGER` |
| 删除数量 | 每次恰好一条 |
| 主表操作 | 参数化执行 `DELETE FROM memory WHERE id = ?` |
| FTS 清理 | 复用 `memory_fts_after_delete` 触发器 |
| 成功结果 | `{"status":"deleted","id":<id>}` |
| 不存在结果 | `{"status":"not_found","id":<id>}` |
| 会话范围 | 当前个人 Agent 的全部长期记忆，不按 `session_id` 过滤 |

删除目标使用 ID，而不是直接使用关键词。关键词适合召回候选，但不能作为破坏性操作的唯一定位条件。相似偏好、重复事件或近义描述都可能被同一组关键词命中，直接执行关键词删除会扩大误删范围。

## 四、调用流程

模型按以下顺序处理删除意图：

```text
用户明确要求删除或遗忘某条长期记忆
  -> 当前 Context 是否已有可信的准确记忆 ID
     -> 有：调用 memory_delete
     -> 无：调用 memory_retrieve 整理候选
        -> 唯一且明确匹配：调用 memory_delete
        -> 多个候选可能匹配：展示候选并询问用户
        -> 没有候选：说明未找到，不调用 memory_delete
  -> 根据 deleted / not_found 结果回复用户
```

典型的单一目标链路：

```text
用户：忘记我喜欢芒果这件事。
AI -> memory_retrieve({ keywords: ["水果偏好", "芒果"] })
Tool -> { status: "found", memories: [{ id: 12, ... }] }
AI -> memory_delete({ id: 12 })
Tool -> { status: "deleted", id: 12 }
AI：已删除这条记忆。
```

若检索同时返回“喜欢芒果”和“对芒果过敏”等可能目标，模型必须先询问用户具体删除哪一条，不能根据措辞自行猜测。

## 五、存储层删除与 FTS5 同步

存储层新增 `deleteMemory(id, databasePath)`，只执行一条参数化 SQL：

```sql
DELETE FROM memory WHERE id = ?;
```

这里不能再手动执行第二条 `memory_fts` 删除语句。现有数据库 Schema 已定义：

```sql
CREATE TRIGGER IF NOT EXISTS memory_fts_after_delete
AFTER DELETE ON memory
FOR EACH ROW
BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, content, keywords)
  VALUES ('delete', OLD.id, OLD.content, OLD.keywords);
END;
```

因此一次主表删除会完成两项变化：

1. 从 `memory` 删除业务记录。
2. 触发器使用旧 ID、内容和关键词移除 `memory_fts` 中对应词项。

主表语句和 `AFTER DELETE` 触发器位于同一个 SQLite 事务中。触发器失败时，主表删除也不会单独提交。业务层若再次直接删除 FTS 索引，反而可能重复执行 FTS5 的特殊 `delete` 命令，破坏索引一致性。

`better-sqlite3` 的执行结果通过 `changes` 判断状态：

- `changes === 1`：返回 `true`。
- `changes === 0`：记录已不存在或 ID 从未存在，返回 `false`。
- 数据库或表不可用：继续抛出 SQLite 异常，交给统一 Tool 错误协议处理。

## 六、Tool Schema 与结果协议

模型只看到一个输入字段：

```ts
const memoryDeleteSchema = z.object({
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
```

以下输入会被拒绝：

- `0` 或负数。
- 小数。
- 超过 JavaScript 安全整数范围的值。

关键词、内容、`session_id` 和批量 ID 不在模型可见的 Schema 中，也不参与删除目标定位。

Tool 返回紧凑 JSON，不回显已删除的完整记忆内容：

```json
{"status":"deleted","id":12}
```

目标不存在时返回：

```json
{"status":"not_found","id":12}
```

`not_found` 是正常的幂等结果。记忆可能已由前一次请求删除，模型只需据实说明，不应把它报告为数据库故障。

## 七、模型决策边界

系统提示词新增以下规则：

- 只有用户明确表达删除或遗忘意图时才允许调用 `memory_delete`。
- 当前 Context 没有准确 ID 时必须先调用 `memory_retrieve`。
- 只有一个候选明确匹配时才能继续删除。
- 多个候选可能匹配时必须先让用户选择。
- 不得猜测 ID，也不得从模糊措辞中推断删除意图。
- 用户陈述与旧记忆冲突，不等于用户要求删除旧记忆。

如果用户说“我现在更喜欢 Rust”，系统仍可以把最新明确陈述作为当前回答依据，但不能因此自动删除“用户偏好 TypeScript”这条旧记忆。冲突更新属于后续 `memory_update` 或冲突处理能力。

对于唯一明确的目标，本阶段不增加第二次确认。用户已经明确要求删除，检索只负责确定数据库记录；重复确认会让普通遗忘请求变得冗长。存在歧义时则必须确认，因为此时目标尚未确定。

## 八、与 Graph 和 Context 的关系

`memory_delete` 加入现有 Tool 注册表后，不需要增加新的 StateGraph 节点。检索和删除可以经过两轮标准工具循环完成：

```text
model_request
  -> memory_retrieve ToolCall
  -> tools
  -> memory_retrieve ToolMessage
  -> model_request
  -> memory_delete ToolCall
  -> tools
  -> memory_delete ToolMessage
  -> model_request
  -> 最终回复
```

ToolCall 和 ToolMessage 会作为正常对话消息写入当前 thread 的 checkpointer，用于保持协议完整；删除操作只修改独立的 `.data/memory.db`，不会删除、裁剪或重写已有聊天历史。

## 九、错误处理与安全边界

- SQL 使用参数绑定，模型不能注入 SQL 片段。
- Schema 只接受单个安全正整数 ID。
- Tool 不提供关键词批量删除或无条件清表能力。
- 目标不存在返回 `not_found`，数据库执行失败则抛出异常。
- LangGraph 继续将执行异常转换为 `ToolMessage(status: "error")`。
- Tool 返回值不包含 `session_id`、原始关键词或完整删除内容。
- 当前实现面向单用户个人 Agent；未来转为多用户服务前，必须增加用户归属校验，不能只凭全局 ID 删除。

删除是不可逆的数据变更。当前开发版本不实现回收站，因此模型决策边界和唯一 ID 定位是首版的主要安全控制。

## 十、实际文件改动

```text
src/agent/
  agent.ts                              # 增加删除意图和歧义处理规则
  runtime/graph.test.ts                 # 验证检索后删除的连续 Tool 循环
  storage/
    memory.ts                           # 增加按 ID 删除方法
    memory.test.ts                      # 验证主表和 FTS 索引同步删除
  tools/
    index.ts                            # 注册 memory_delete
    memory_delete_tool.ts               # Tool Schema、工厂和结果协议
    memory_delete_tool.test.ts          # Tool 输入、输出和同步删除测试
docs/
  commits/
    38-memory-delete-tool.md             # 本实现说明
    README.md                            # 增加第 38 篇索引
ROADMAP.md                               # 验证后同步开发进度
```

不修改 `db.ts`、数据库 Schema、现有 FTS 触发器、依赖或 lockfile。

## 十一、测试覆盖

### 存储层

1. 删除已存在的 ID 返回 `true`。
2. 对应 `memory` 主表记录消失。
3. 对应 `memory_fts` 词项无法再命中。
4. 无关记忆和索引仍然存在。
5. 删除不存在的 ID 返回 `false` 且不改变其他记录。
6. 缺少 `memory` 表时抛出 SQLite 异常。

### Tool 层

1. 成功时返回紧凑的 `deleted` JSON。
2. 目标不存在时返回 `not_found` JSON。
3. 模型输入 Schema 只暴露 `id`。
4. `0`、负数、小数和超出安全整数范围的 ID 被拒绝。
5. 工厂可以注入临时数据库路径，不污染项目数据库。

### Graph 集成

1. Fake Model 先调用 `memory_retrieve`，再使用返回的 ID 调用 `memory_delete`。
2. Graph 连续完成两轮 Tool 循环并生成最终回复。
3. 删除 ToolMessage 保留 `name`、`tool_call_id` 和结构化结果。
4. 主表记录和 FTS 索引均被删除。
5. 删除前已经存在的 checkpointer 历史不被重写。

## 十二、验证结果

- 删除相关定向测试通过：3 个测试套件、31 条测试。
- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过，共 30 个测试套件、172 条测试。
- 构建产物使用独立临时数据库完成 Tool 回归：统一注册表包含 `memory_delete`，删除结果为 `deleted`，随后 `memory` 与 `memory_fts` 的匹配记录均为 0。
- `git diff --check` 通过；40 个 Markdown 文件的相对链接全部有效。
- 真实 Kimi、DeepSeek 的自主工具选择尚未验证，不在本阶段文档中宣称通过。

## 十三、后续边界

1. 使用真实 Kimi 和 DeepSeek 验证单一目标、多个候选和不存在目标三种删除决策。
2. 评估软删除、短期撤销或审计记录是否有实际需求。
3. 在实现 `memory_update` 时统一处理新旧偏好冲突，避免用删除代替更新。
4. 多用户版本增加用户归属字段，并将检索和删除都限制在同一用户范围内。
