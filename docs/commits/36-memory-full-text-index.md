# 36 长期记忆全文索引实现说明

## Commit 信息

- Commit：待提交
- 类型：`feat`
- 状态：当前实现
- 基线：`557c56b docs: 移除 Commit 文档文件名中的短 Hash`
- 实现范围：长期记忆 FTS5 外部内容表、索引同步触发器及存储层回归测试。

## 一、背景

项目已经通过独立的 `.data/memory.db` 保存长期记忆，并由 `memory_create` Tool 将用户事实、事件、偏好和技能写入 `memory` 表。现阶段只有参数化写入能力，后续 `memory_search` 如果直接使用 `LIKE '%query%'`，会存在以下问题：

- 无法利用全文倒排索引，数据量增长后需要扫描整张表。
- 难以同时检索自然语言 `content` 和 JSON 关键词 `keywords`。
- 无法使用 FTS5 的列查询、相关性排序和短语查询能力。

因此，本阶段先建立与 `memory` 主表关联的 FTS5 索引，为后续搜索 Tool 和请求前召回提供存储基础。本阶段不实现用户可调用的搜索接口，也不改变模型 Context。

## 二、目标

本次实现需要满足：

1. Agent 初始化长期记忆数据库时，同时幂等创建 `memory_fts`。
2. FTS 表不重复保存主表原文，通过 `memory.id` 关联对应记录。
3. 新记忆写入后立即进入全文索引。
4. `content` 或 `keywords` 更新后移除旧词项并写入新词项。
5. 主表记录删除后同步删除对应索引。
6. 重复启动不能重复创建表或触发器。
7. 不修改独立的 LangGraph checkpointer 数据库。

## 三、非目标

本阶段不实现：

- `memory_search` Tool。
- 请求前自动召回和 Context 注入。
- 记忆更新或删除 Tool。
- 按类型、重要性或时间组合排序。
- 向量检索、语义重排或近似记忆去重。
- 旧数据回填和数据库迁移框架。
- 自定义中文分词器。

## 四、FTS5 表结构

`memory_fts` 与 `memory` 在 [db.ts](../../src/agent/storage/db.ts) 的同一份 `MEMORY_SCHEMA` 中创建，并且位于主表之后：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  keywords,
  content='memory',
  content_rowid='id'
);
```

字段关系：

| FTS 字段 | 主表字段 | 用途 |
| --- | --- | --- |
| `rowid` | `memory.id` | 将全文命中结果定位到完整记忆记录。 |
| `content` | `memory.content` | 索引可独立理解的自然语言记忆。 |
| `keywords` | `memory.keywords` | 索引模型生成的 JSON 关键词数组。 |

这里使用 FTS5 external-content 模式：原始 `content` 和 `keywords` 仍由 `memory` 主表持有，FTS5 的影子表保存词项和倒排索引，不再保存一份可独立读取的原文副本。

需要明确，`content='memory'` 只定义内容来源和 `rowid` 映射，不会自动监听主表变化。如果没有额外同步逻辑，普通 `SELECT` 可能仍能从主表读取行，但 `MATCH` 无法命中新写入的数据。

## 五、索引同步触发器

Schema 创建三个 SQLite 触发器，覆盖新数据的完整生命周期。

### 新增记忆

`memory_fts_after_insert` 在主表插入成功后，将相同 `id`、`content` 和 `keywords` 写入 FTS 索引：

```sql
INSERT INTO memory_fts(rowid, content, keywords)
VALUES (NEW.id, NEW.content, NEW.keywords);
```

现有 `storage/memory.ts` 不需要感知 FTS5，也不需要执行第二条业务 SQL。所有通过 `memory_create` 或其他合法入口写入的新记录都会由数据库统一维护索引。

### 删除记忆

`memory_fts_after_delete` 使用 FTS5 的特殊 `delete` 命令删除旧词项：

```sql
INSERT INTO memory_fts(memory_fts, rowid, content, keywords)
VALUES ('delete', OLD.id, OLD.content, OLD.keywords);
```

删除命令必须携带旧 `rowid` 和旧字段值，使 FTS5 能够准确移除原有倒排记录。

### 更新记忆

`memory_fts_after_update` 只监听 `id`、`content` 和 `keywords`：

1. 用旧字段执行 FTS5 `delete`。
2. 用新字段和新 `rowid` 重新插入索引。

`type`、`importance`、`session_id` 和时间字段不参与全文索引，单独修改这些字段不会产生无意义的 FTS 重建。

现有 `memory_update_updated_at` 触发器会在业务字段变化后再次更新 `updated_at`。由于 FTS 触发器使用 `AFTER UPDATE OF id, content, keywords`，这次只修改时间戳的内部更新不会再次触发 FTS 同步，避免重复删除和插入索引。

## 六、启动与初始化顺序

当前启动路径保持不变：

```text
CLI 加载 agent.ts
  -> initializeDatabase()
  -> 创建 .data 目录
  -> 打开 .data/memory.db
  -> 幂等创建 memory、memory_fts 和触发器
  -> 关闭数据库连接
  -> 初始化 checkpointer 和 StateGraph
  -> 进入 CLI 交互
```

`initializeDatabase()` 仍通过一次 `database.exec(MEMORY_SCHEMA)` 执行完整 Schema。应用进入对话前，全文索引和同步触发器已经存在。

## 七、数据处理决策

本项目仍处于开发阶段，本次明确按全新数据处理：

- 不检测旧版数据库中是否已有 `memory` 记录。
- 不执行 `INSERT INTO memory_fts(memory_fts) VALUES ('rebuild')`。
- 不引入 `PRAGMA user_version` 或迁移脚本。
- 本地开发库原有 1 条长期记忆已一次性清空，并重置 `memory` 的自增序列。
- `.data/checkpointer.db` 未修改，会话历史不受影响。

清表是本次开发环境中的一次性操作，没有写入项目启动代码。后续启动不会删除已经创建的新记忆。

## 八、检索边界

当前表结构使用 FTS5 默认的 `unicode61` tokenizer。它适合英文和由空格、标点分隔的关键词，但不会对连续中文文本执行语义分词。

例如：

```text
用户偏好 TypeScript 代码不使用 any 类型。
```

其中连续中文可能被索引为“用户偏好”“代码不使用”等完整词项，直接搜索“偏好”不一定命中。`keywords` 中独立保存的 JSON 关键词会被 JSON 标点分隔，可以补充部分精准召回，但不能替代完整的中文检索设计。

后续实现 `memory_search` 时还需要决定：

- 是否继续依赖模型生成的独立关键词。
- 是否使用 trigram、自定义中文分词或额外的标准化字段。
- 如何转义用户输入中的 FTS5 操作符，避免合法输入导致 `MATCH` 语法错误。
- 如何组合 `bm25()`、`importance`、类型和时间进行排序。

这些问题不会阻止当前索引基础设施工作，但必须在公开搜索能力前确定。

## 九、测试方案

[db.test.ts](../../src/agent/storage/db.test.ts) 使用临时 SQLite 文件验证 Schema，不污染项目的 `.data/memory.db`。

### 幂等初始化

连续调用两次 `initializeDatabase()`，确认只存在：

- `memory` 主表。
- `memory_fts` 虚拟表。
- `memory_fts_after_insert`。
- `memory_fts_after_update`。
- `memory_fts_after_delete`。

### 索引同步

同一条临时记忆依次执行：

1. 插入 TypeScript 内容和关键词，两个字段都能通过 `MATCH` 命中相同 `rowid`。
2. 更新为 Rust 内容和关键词，旧词项不再命中，新词项能够命中。
3. 删除主表记录，更新后的词项也不再命中。

现有 `updated_at` 默认值和自动刷新测试继续通过，证明新增 FTS 触发器没有破坏原有时间戳行为。

## 十、验收结果

实现完成后已经确认：

- `.data/memory.db` 中 `memory` 记录数为 `0`。
- 实际数据库存在 `memory_fts` 和三个同步触发器。
- `pnpm typecheck` 通过。
- `pnpm test --runInBand` 通过，共 28 个测试套件、148 条测试。
- `pnpm build` 通过。
- `git diff --check` 通过。

## 十一、后续阶段

全文索引只解决候选检索的存储基础，下一步仍需实现：

1. `memory_search`：构造安全的 FTS5 查询，并返回完整 `memory` 记录。
2. 混合排序：综合全文相关性、重要性和更新时间选择候选记忆。
3. 请求前召回：根据当前用户输入检索记忆，以非持久化投影注入模型 Context。
4. 更新与去重：在新事实与旧记忆冲突或近似重复时进行合并。

在这些能力完成前，`memory_create` 仍只负责写入；`memory_fts` 会持续维护新数据索引，但不会主动改变任何模型请求。
