# 35 长期记忆创建 Tool 实现说明

## Commit 信息

- Commit：[`4772571`](https://github.com/qlypupil/mini-agent/commit/477257162d62124dcd02b8fc61f291995d282135)
- 类型：`feat`
- 状态：当前实现
- 基线：`5eb6c7a docs: 记录消息硬上限实现`
- 实现范围：长期记忆数据库初始化、存储层和 `memory_create` Tool。

## 一、背景

当前 Agent 已经通过 LangGraph checkpointer 保存完整聊天历史，但聊天历史与长期记忆解决的是两个不同问题：

- checkpointer 用于恢复某个 `thread_id` 对应的对话状态。
- 长期记忆用于保存经过筛选的用户事实、重要事件、偏好和技能，供后续跨轮次或跨会话检索。

当前项目已经建立独立的 `.data/memory.db`，并在启动时幂等创建 `memory` 表。下一步需要增加一个由模型主动调用的 `memory_create` Tool，让模型在判断某条用户信息具有长期价值时，将其写入 `memory` 表。

本阶段只建立“创建记忆”能力，不负责检索、更新、删除和自动注入。

## 二、目标

本次实现需要满足以下目标：

1. 模型能够根据明确规则判断是否需要创建长期记忆。
2. Tool 只接收记忆内容，不允许模型自行填写 `session_id`。
3. `session_id` 必须来自当前 LangGraph 请求的 `configurable.thread_id`。
4. 记忆写入 [db.ts](../../src/agent/storage/db.ts) 中 `DB_PATH` 指向的 SQLite 数据库。
5. `keywords` 以 JSON 数组字符串写入 TEXT 字段。
6. Tool 返回简短、结构化的创建结果，避免重复占用 Context。
7. 写入失败时沿用现有统一 Tool 错误协议，不将失败显示为成功。
8. 不重写或裁剪现有 checkpointer 历史。

## 三、非目标

本阶段不实现：

- 从数据库检索记忆。
- 将记忆自动注入下一轮模型请求。
- 更新或删除已有记忆。
- 基于向量、全文搜索或模型判断的语义去重。
- 用户画像聚合。
- 多用户隔离。
- 对旧数据执行数据库迁移。

因为目前没有记忆检索能力，模型无法可靠判断数据库中是否已经存在语义相同的记忆。本阶段允许重复记录，后续在记忆检索和更新流程中统一解决。

## 四、总体架构

采用“存储层 + Tool 适配层 + Agent 决策规则”三层结构：

```text
用户输入
  -> 模型根据系统提示词判断信息是否值得长期保存
  -> 模型调用 memory_create
  -> Tool 从运行配置读取 configurable.thread_id
  -> storage/memory.ts 执行参数化 INSERT
  -> SQLite 返回新增记录 ID
  -> Tool 返回精简结果
  -> 模型继续生成面向用户的正文回复
```

最终文件职责：

```text
src/agent/
  agent.ts
  storage/
    db.ts
    memory.ts
  tools/
    index.ts
    memory_create_tool.ts
    memory_create_tool.test.ts
```

### `storage/memory.ts`

负责数据库相关逻辑：

- 定义创建记忆的内部数据类型。
- 使用 `DB_PATH` 打开数据库。
- 将关键词数组序列化为 JSON。
- 使用参数化 SQL 插入记录。
- 返回新增记录 ID。
- 确保数据库连接在成功或失败后都被关闭。

### `tools/memory_create_tool.ts`

负责 Tool 业务适配：

- 声明 Tool 名称、描述和 Zod Schema。
- 从 Tool 回调的运行配置中提取并校验 `thread_id`。
- 提供可注入数据库路径的 Tool 工厂，供默认注册和临时数据库测试复用。
- 接收已经通过 Zod 校验的模型参数。
- 调用存储层创建记忆。
- 返回适合模型读取的精简结果。

### `tools/index.ts`

负责 LangChain Tool 注册：

- 将 `memory_create` 加入现有 `tools` 数组，继续由统一注册表向 Graph 暴露工具。

### `agent.ts`

负责模型决策规则：

- 明确哪些信息应该保存。
- 明确哪些信息不得保存。
- 要求每条记忆是可独立理解的原子陈述。

## 五、数据模型

现有数据表：

```sql
CREATE TABLE memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords TEXT,
  importance INTEGER DEFAULT 3,
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

字段语义：

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `id` | SQLite | 自增主键。 |
| `type` | 模型 | 记忆类型，只能是 `fact`、`event`、`preference`、`skill`。 |
| `content` | 模型 | 可脱离当前聊天独立理解的自然语言陈述。 |
| `keywords` | 模型 | 关键词数组，写入前序列化为 JSON。 |
| `importance` | 模型或默认值 | `1～5` 的整数，默认 `3`。 |
| `session_id` | LangGraph runtime | 创建该记忆时的当前 `thread_id`。 |
| `created_at` | SQLite | 创建时间。 |
| `updated_at` | SQLite | 创建时自动填写，业务字段更新时由触发器刷新。 |

类型语义：

- `fact`：相对稳定的用户事实，例如职业、常用技术栈或长期目标。
- `event`：对未来对话有价值的重要经历或已发生事件。
- `preference`：用户对表达方式、工具、技术方案或工作流程的稳定偏好。
- `skill`：用户已经掌握、正在长期学习或明确希望发展的技能。

重要性建议：

- `1`：低价值补充信息。
- `2`：可能偶尔有帮助。
- `3`：默认的重要信息。
- `4`：经常影响后续回答的重要信息。
- `5`：用户明确强调、长期有效且会显著影响交互的信息。

## 六、Tool 输入与输出

模型可见的输入结构：

```ts
const memoryCreateSchema = z.object({
  type: z.enum(['fact', 'event', 'preference', 'skill']),
  content: z.string().trim().min(1).max(2000),
  keywords: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
  importance: z.number().int().min(1).max(5).default(3),
})
```

`session_id` 不属于模型参数。Tool 注册函数应从第二个 `config` 参数获取：

```ts
const sessionId = config.configurable?.thread_id
```

读取后必须验证它是非空字符串。缺少 `thread_id` 时应抛出异常，而不是创建归属不明的记忆。

Tool 建议返回 JSON 字符串：

```json
{"status":"created","id":12}
```

返回值不包含完整 `content` 和 `keywords`，原因是这些参数已经存在于前一条 AI ToolCall 中，重复返回只会增加 ToolMessage 和模型 Context。

## 七、存储实现

内部输入类型建议为：

```ts
export type MemoryType = 'fact' | 'event' | 'preference' | 'skill'

export interface CreateMemoryInput {
  type: MemoryType
  content: string
  keywords?: string[]
  importance?: number
  sessionId: string
}
```

参数化 SQL：

```sql
INSERT INTO memory (
  type,
  content,
  keywords,
  importance,
  session_id
) VALUES (?, ?, ?, ?, ?)
```

写入规则：

1. `content` 使用 Zod 清理后的非空字符串。
2. `keywords` 存在时使用 `JSON.stringify(keywords)`。
3. `keywords` 未提供时写入 `NULL`。
4. `importance` 未提供时写入 `3`。
5. `session_id` 使用当前 LangGraph `thread_id`。
6. 使用 `result.lastInsertRowid` 获取新增记录 ID。
7. 在 `finally` 中关闭数据库连接。

当前记忆写入频率低，每次调用打开数据库、写入后关闭即可。暂时不增加全局连接池或常驻 Repository 实例，避免引入额外生命周期管理。

## 八、模型决策规则

仅注册 Tool 不足以保证模型稳定、正确地创建记忆，需要在系统提示词中增加明确规则。

建议规则：

```text
Use memory_create only for durable user information that can improve future conversations.
Create a memory when the user explicitly asks you to remember something, or when they state a stable fact, preference, important event, or skill with clear future value.
Write each memory as one concise, standalone statement that can be understood without the current conversation.
Do not store temporary task details, one-time requests, model guesses, passwords, API keys, tokens, or other secrets.
Do not infer sensitive or personal facts that the user did not explicitly state.
Create separate memories for separate facts.
```

示例一，应该保存：

```text
用户：以后写 TypeScript 时不要使用 any。
```

```json
{
  "type": "preference",
  "content": "用户偏好 TypeScript 代码不使用 any 类型。",
  "keywords": ["TypeScript", "any", "coding preference"],
  "importance": 4
}
```

示例二，不应该保存：

```text
用户：帮我把这个变量改成 userName。
```

这是一次性任务指令，对未来会话没有稳定价值。

示例三，不应该保存：

```text
用户：我的 API Key 是 sk-xxxx，请帮我测试。
```

密钥和 Token 不得进入长期记忆。

## 九、与 LangGraph 和 checkpointer 的关系

现有 [graph.ts](../../src/agent/runtime/graph.ts) 已经使用 `ToolNode` 统一执行 Tool，因此不需要新增 Graph 节点或修改工具循环。

模型调用 `memory_create` 后，系统会产生：

1. 包含 ToolCall 的 AIMessage。
2. 包含创建结果的 ToolMessage。
3. 最终面向用户的 AIMessage。

这些消息会按照现有 LangGraph 行为进入当前会话的 checkpointer，这是正常聊天历史。本方案不会回写、替换或删除已有 checkpointer 数据。

真正的长期记忆记录单独写入 `.data/memory.db`。即使后续聊天历史被 Context 压缩或 ToolMessage 被请求前简化，已写入的记忆行也不会受到影响。

## 十、错误处理

沿用当前统一 Tool 错误协议：

- 参数不符合 Zod Schema：Tool 调用校验失败。
- 缺少 `thread_id`：抛出明确错误。
- 数据库无法打开：抛出原始数据库错误。
- SQL 写入失败：抛出原始数据库错误。
- Tool 不捕获异常并伪造成功结果。

LangGraph 会将异常转换为带错误状态的 ToolMessage，CLI 继续使用现有失败展示逻辑。

## 十一、安全边界

本方案提供以下保护：

- 使用参数化 SQL，模型内容不能改变 SQL 结构。
- `session_id` 由运行时注入，模型无法指定其他会话。
- Zod 限制类型、内容长度、关键词数量和重要性范围。
- 系统提示词禁止保存密钥、密码和 Token。

需要明确的是，提示词规则不能提供绝对的数据防泄漏保证。当前 Schema 没有敏感数据分类字段，代码也无法可靠理解任意自然语言中的所有秘密。本阶段主要依赖明确的模型规则；如果未来需要处理多用户或高敏感数据，应增加用户确认、敏感信息检测和数据加密设计。

## 十二、测试方案

### 存储层单元测试

使用临时 SQLite 文件，不写入项目的 `.data/memory.db`：

1. 正常写入 `type`、`content`、`keywords`、`importance` 和 `session_id`。
2. `keywords` 正确保存为 JSON 数组字符串。
3. 未提供 `keywords` 时保存为 `NULL`。
4. 未提供 `importance` 时保存为 `3`。
5. 返回的 ID 与数据库记录 ID 一致。
6. 数据库写入失败时抛出异常。

### Tool 单元测试

1. 合法参数能够创建记忆。
2. 非法 `type` 被拒绝。
3. 空 `content` 被拒绝。
4. `importance` 小于 `1` 或大于 `5` 时被拒绝。
5. 关键词数量或长度超限时被拒绝。
6. 缺少 `thread_id` 时拒绝写入。
7. 返回值只包含状态和记录 ID。

### Graph 集成测试

使用 Fake Model 主动生成 `memory_create` ToolCall：

1. Graph 能够执行 Tool 并继续生成最终回复。
2. 数据库中的 `session_id` 等于 Graph 配置中的 `thread_id`。
3. ToolMessage 的 Tool 名称和调用 ID 保持完整。
4. Tool 异常时产生错误状态的 ToolMessage。
5. 现有 checkpointer 中的历史消息没有被重写。

不依赖真实 Kimi 或 DeepSeek 接口完成自动化测试，避免模型行为和网络状态导致测试不稳定。

## 十三、验收标准

实现完成后应满足：

- 模型工具列表中存在 `memory_create`。
- Tool Schema 不包含 `session_id`。
- 模型能够保存四种合法类型的记忆。
- SQLite 记录包含正确的当前 `thread_id`。
- `keywords` 是合法 JSON 或 `NULL`。
- `importance` 始终位于 `1～5`。
- Tool 成功结果简短且包含记录 ID。
- Tool 失败不会显示为成功。
- 现有聊天、Context 压缩、Tool 输出处理和 checkpointer 流程不受影响。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `git diff --check` 全部通过。

## 十四、后续阶段

完成创建能力后，建议按以下顺序继续：

1. `memory_search`：按关键词、类型、重要性和时间检索候选记忆。
2. 请求前召回：根据当前用户输入检索相关记忆，并以非持久化投影注入模型 Context。
3. `memory_update`：合并冲突信息、修正旧事实并刷新 `updated_at`。
4. 记忆去重：结合精确匹配、FTS 和模型判断处理近似重复。
5. 用户画像：从稳定的长期记忆生成可更新的 Profile。

这些阶段应继续保持长期记忆数据库与 LangGraph checkpointer 分离，避免记忆操作破坏原始聊天历史。

## 十五、实施结果

最终实现与本方案的核心边界一致：

- 新增 `storage/memory.ts`，通过参数化 SQL 写入记忆，并在 `finally` 中关闭数据库连接。
- 新增 `memory_create_tool.ts`，Schema 不包含 `session_id`，会话 ID 只从 Tool 运行配置获取。
- `memory_create` 已加入统一工具注册表，现有 StateGraph 无需增加节点。
- `agent.ts` 已加入长期记忆决策规则，禁止保存临时任务、模型猜测和密钥等敏感信息。
- Tool 成功时只返回 `{"status":"created","id":<number>}`，写入异常继续走统一 Tool 错误协议。
- 单元测试和 Graph 集成测试均使用临时 SQLite 文件，不污染 `.data/memory.db`。

验证结果：

- `pnpm typecheck` 通过。
- `pnpm test --runInBand` 通过，共 28 个测试套件、147 条测试。
- `pnpm build` 通过。
- `git diff --check` 通过。
