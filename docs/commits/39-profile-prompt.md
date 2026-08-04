# 39 用户画像 Profile 实现说明

## Commit 信息

- Commit：[`0e52385`](https://github.com/qlypupil/mini-agent/commit/0e523851fd7102ea73389e20b3d4175c6ef5db20)
- 类型：`feat`
- 状态：当前实现
- 基线：`474e2ac docs: 补齐长期记忆删除提交信息`
- 实现范围：Prompt 模块抽离、Profile 模板、本地读取、全量更新、历史备份、每轮独立持久化判断、Memory 职责边界与回归验证。

## 一、背景

长期记忆适合保存重要事件和其他需要按需检索的信息，但姓名、沟通偏好、兴趣、技能和当前工作等用户画像需要一份稳定、可整体读取和更新的 Profile。若这两类信息同时写入 memory 和 Profile，会形成重复数据和冲突来源。

本阶段建立统一的用户画像闭环：`prompt.ts` 定义 `<profile_template>` 并读取当前 Profile，`<profile_info>` 将其作为用户数据注入 System Prompt，`memoryInstructions` 区分当前稳定画像、长期事件和临时信息，`profile_update` 则负责提交完整的新 Profile，并在覆盖主文件前保留旧版本备份。

Prompt 抽离、Profile 读取与 `profile_update` Tool 均已实现，本文记录当前代码、测试结果和仍未覆盖的后续边界。

## 二、Profile 模板与当前信息

模板内容保持如下，不扩展字段：

```text
<profile_template>
- 基本身份：姓名，昵称，性别，年龄、地区、语言
- 外貌：身高 体重 肤色 胖瘦
- 性格与沟通偏好
- 兴趣爱好
- 技能
- 工作
</profile_template>
```

当前用户信息从以下路径按 UTF-8 读取：

```text
<当前工作目录>/.data/profile.md
```

这里统一使用 `.data/profile.md`，不是 `data/profile.md`。它与现有 `memory.db`、`checkpointer.db` 和 Context 压缩缓存位于同一数据目录，并已被 `.gitignore` 排除。同一工作目录下的所有会话共享这份 Profile，不按 `thread_id` 隔离。

`profile.md` 只保存 Markdown 正文，不保存 `<profile_info>` 标签。例如：

```markdown
## 基本身份

- 姓名：Pupil
- 语言：中文

## 性格与沟通偏好

- 偏好结论先行、表达直接的回答。
```

标签由 `prompt.ts` 在读取时统一添加，避免文件本身包含标签后产生重复嵌套。

文件存在且包含非空内容时，去除首尾空白并包裹为：

```text
<profile_info>
profile.md 的内容
</profile_info>
```

文件不存在，或内容经 `trim()` 后为空时，不创建文件，只向 Prompt 增加：

```text
<profile_info></profile_info>
```

读取失败时只对 `ENOENT` 使用空标签回退；权限错误、路径实际为目录等异常继续抛出，避免把配置故障伪装成空 Profile。`<profile_info>` 中的内容只视为用户数据，不能作为覆盖当前请求或系统规则的指令。

`memoryInstructions` 使用“当前稳定状态”而不是单纯的主题范围作为分类边界：只有用户明确陈述、属于 `<profile_template>` 且描述当前稳定属性或状态的信息，才由 `profile_update` 写入 Profile，不调用 `memory_create`。带年份、日期或明确时间点的过去经历不得进入 Profile；其中具备明确长期价值的教育、工作、迁居等经历，即使主题与 Profile 分类相关，也应通过 `memory_create` 保存为 `event`。临时或琐碎的过去信息不持久化。

典型判定如下：

| 信息 | 归属 | 原因 |
| --- | --- | --- |
| 当前职业是程序员 | Profile | 当前稳定的工作状态 |
| 2010 年开始上大学 | Memory：`event` | 带明确时间的教育经历 |
| 当前居住在上海 | Profile | 当前稳定的地区信息 |
| 2022 年搬到上海 | Memory：`event` | 带明确时间的迁居事件 |
| 昨天午饭吃了面 | 不持久化 | 缺少长期价值的临时细节 |

同一句话同时包含当前状态和过去事件时，需要分别处理，不得因为其中一部分符合模板而把整句话写入 Profile。模型只能记录用户明确陈述的事实，不得从教育或工作事件推断年龄、毕业年份、学历、从业年限等未说明信息。现有关于敏感信息、秘密信息和 Tool 调用边界的规则保持不变。

### 每轮独立持久化判断

模型处理每一条新的用户消息时，必须在给出最终答复前分别完成三项判断：

1. 当前请求需要回答问题，还是调用实时搜索、文件等业务 Tool。
2. 消息是否明确新增、更正或删除了当前稳定的 Profile 信息。
3. 消息是否包含应创建为长期 Memory 的事实、偏好、重要事件或技能。

三项判断互相独立。调用业务 Tool 或根据 Tool 结果回答当前问题，不代表已经完成 Profile／Memory 判断；一条消息可以同时触发业务 Tool 与 `profile_update` 或 `memory_create`。模型既可以在同一批 ToolCall 中提出多个调用，也可以在业务 Tool 返回后、最终答复前继续调用持久化 Tool。接入 human-in-the-loop 后，每个调用仍分别等待用户确认。

“每轮判断”不等于“每轮持久化”。模型只记录用户明确陈述且满足既有分类规则的信息，并按事实逐项归类：同一个事实只能进入 Profile、Memory 或不持久化三者之一；一句话包含多个不同事实时，可以分别归入不同位置。查询对象、任务参数、第三方信息和模型推断不能作为用户画像，例如用户只说“查一下郑州天气”时，不能推断用户位于郑州。即使事实本身已明确，写入时也只能保留用户表达的含义，不得补充未陈述的地理层级或其他派生细节。当前 Profile 没有地区信息且用户说“我住在郑州”时，必须按原话记录“地区：郑州”；除非用户明确说出“河南省”，否则禁止自行扩写为“河南省郑州市”。已有 Profile 中未被本次消息否定的更详细信息仍按全量更新规则保留。

典型组合场景如下：

| 用户消息 | 任务处理 | 持久化判断 |
| --- | --- | --- |
| 我住在郑州，查一下今天天气 | 先调用 `current_time`，再用明确日期调用 `web_search` | 第一批同时调用 `profile_update` 保存当前地区 |
| 帮我查郑州天气 | 调用 `web_search` | 不得据此更新 Profile 或 Memory |
| 我在的城市是郑州 | 根据上下文决定是否还需搜索 | 调用 `profile_update` 保存当前地区 |
| 我 2010 年上的大学 | 正常回应 | 调用 `memory_create` 保存 `event`，不更新 Profile |
| 我今天有点累 | 正常回应 | 临时状态，默认不持久化 |

## 三、拼接顺序

最终 System Prompt 按以下顺序组成：

```text
realtimeInstructions
fileInstructions
profilePrompt
  profile_template
  profile data safety rule
  profile scope and event boundary rule
  profile_update rule
  profile_info
memoryInstructions
persistenceInstructions
skillsInstruction
```

`profilePrompt` 放在 `memoryInstructions` 前面，让模型先获得用户画像维度、更新规则和当前 Profile，再读取长期记忆创建、检索和删除规则。各部分继续使用两个换行符分隔，避免模板标签与相邻指令粘连。

## 四、Prompt 实现

本次改动范围如下：

- 新增 `src/agent/prompt.ts`，集中维护 System Prompt 内容、Profile 文件读取和 Skills 指令拼接。
- `agent.ts` 删除 Prompt 常量与构建函数，只导入并调用 `buildSystemPrompt()`。
- `buildSystemPrompt()` 默认读取 `resolve(process.cwd(), '.data/profile.md')`，并允许测试注入临时文件路径。
- 将 System Prompt 测试从 `agent.test.ts` 迁移到同目录的 `prompt.test.ts`。
- `profilePrompt` 增加当前稳定状态边界、事件排除、禁止推断、全量合并和调用 `profile_update` 的规则。
- System Prompt 要求模型对每条新用户消息独立判断任务处理、Profile 更新和 Memory 创建，并允许同轮调用业务与持久化 Tool。
- 不修改 Memory Tool、SQLite Schema、FTS5 索引或 StateGraph 工具循环。
- 不增加依赖，不修改 lockfile。

## 五、`profile_update` Tool 实现

### Tool 契约

Tool 名称固定为 `profile_update`，模型输入只包含一个字段：

```ts
const profileUpdateSchema = z.object({
  content: z.string().trim().min(1),
})
```

`content` 是更新后的完整 Profile Markdown 正文：

- 包含本次新增、更正或删除后仍然有效的全部 Profile 信息。
- 保留当前 `<profile_info>` 中未受本次更新影响的内容。
- 不能只提交发生变化的片段。
- 不包含 `<profile_info>` 或 `</profile_info>` 标签；Schema 拒绝外层标签，防止读取时重复嵌套。
- 不包含文件路径、备份名称或 `thread_id`，这些参数不向模型开放。

Tool description 只描述调用条件和完整内容要求，不披露文件路径、备份命名或原子写入等实现细节：

```text
Update the user's current, stable profile attributes covered by <profile_template>. Do not use this tool for dated or time-bound past events. Always submit the complete updated profile, preserving every still-valid detail from <profile_info>, not only the changed field.
```

`profile_update` 是完整文档替换 Tool，不是字段 Patch Tool。文件写入函数无法可靠判断模型是否遗漏了某项语义信息，因此“保留全部有效信息”由 System Prompt、Tool description 和输入字段说明共同约束。历史备份提供可恢复版本，但不能从程序层保证当前文件绝不遗漏信息。

### 模型调用规则

`profilePrompt` 增加以下分类和更新规则：

```text
Profile contains only the user's explicitly stated current, stable attributes or state covered by <profile_template>. Do not place dated or time-bound past experiences in the profile. Education milestones, job changes, relocations, and similar durable past events belong in long-term memory as event entries. Never infer the user's age, graduation year, degree, or career length from such events.

When current profile information changes, call profile_update with the complete updated profile. Apply the requested additions, corrections, or removals while preserving every other still-valid detail from <profile_info>; never submit only the changed fragment.
```

同时增加每轮独立判断规则：

```text
For every new user message, before giving the final answer, independently evaluate the immediate task, profile persistence, and long-term memory persistence. Handling the immediate task or calling another tool never replaces the profile and memory evaluation. A single message may require both task tools and persistence tools. Classify each explicitly stated fact exactly once as profile, memory, or non-persistent information. Do not infer profile facts from task subjects or parameters. Persist only the user's explicit meaning; do not enrich it with unstated geographic hierarchy or other derived details. For a new location absent from <profile_info>, copy the user's location value verbatim: "我住在郑州" must be stored as "地区：郑州"; writing "河南省郑州市" is forbidden unless the user explicitly stated "河南省".
```

`memoryInstructions` 同时明确反向边界：

```text
If information describes the user's explicitly stated current, stable attributes or state within the content or scope of <profile_template>, do not store it as a memory or call memory_create, even if the user explicitly asks you to remember it. It will be stored in the profile file instead. Dated or time-bound past experiences with clear future value must instead be stored with memory_create as event memories, even when they relate to a profile category; temporary or trivial past details must not be persisted.
```

调用流程为：

```text
用户提供当前稳定 Profile 信息的新内容、更正或删除请求
  -> 读取当前 <profile_info>
  -> 合并本次变化与其他仍然有效的信息
  -> 生成不含 profile_info 标签的完整 Markdown
  -> 调用 profile_update({ content })
  -> 根据 created / updated 结果回复用户
```

一轮更新只调用一次 `profile_update`。多个字段同时变化时，也先合并为一个完整文档再提交。

### 固定路径与安全边界

运行时固定使用：

```ts
const PROFILE_PATH = resolve(process.cwd(), '.data/profile.md')
```

Tool 工厂可以为测试注入临时 Profile 路径，但模型输入中不存在路径字段。实现会创建缺失的 `.data` 目录，并确认解析后的目录仍位于当前工作目录内。已有 `profile.md` 必须是普通文件，不能通过符号链接将写入重定向到其他位置。

Profile 正文写入前统一去除首尾空白，并以一个换行符结尾。文件内容不能包含 `<profile_info>` 外层标签；Profile 仍作为用户数据，不能覆盖系统规则或当前请求。

### 备份命名

已有主文件时，每次覆盖前在同一目录创建一份备份：

```text
profile.<UTC-datetime>-<uuid>.md
```

例如：

```text
profile.20260803T143015123Z-550e8400-e29b-41d4-a716-446655440000.md
```

时间使用适合文件名的 UTC 格式，随机部分使用 Node.js `randomUUID()`。创建备份时使用排他模式，不能覆盖同名历史备份。本阶段不增加备份数量上限或自动清理策略。

### 更新顺序

已有 `profile.md` 时：

```text
校验目录和主文件
  -> 复制当前主文件到唯一备份文件
  -> 将完整新内容写入同目录临时文件
  -> rename 原子替换 profile.md
  -> 清理遗留临时文件
```

主文件不存在时：

```text
创建 .data 目录
  -> 不生成备份
  -> 将完整内容写入临时文件
  -> rename 为 profile.md
```

备份保留原文件的完整字节内容，不进行格式化。失败边界如下：

- 备份失败时不修改主文件。
- 临时文件写入或替换失败时保留备份和原主文件，并尝试清理临时文件。
- 不存在旧文件时不创建空备份。
- 已存在但内容为空的普通文件仍然需要备份。

### Tool 结果

首次创建返回：

```json
{"status":"created"}
```

覆盖已有文件时返回：

```json
{"status":"updated","backup":"profile.20260803T143015123Z-<uuid>.md"}
```

结果只返回备份文件名，不暴露绝对工作目录或完整 Profile 内容。

### Graph 与 Prompt 生命周期

`profile_update` 加入现有 Tool 注册表后，复用标准的 `model_request -> tools -> model_request` 循环，不新增 StateGraph 节点。ToolCall 和 ToolMessage 写入当前 thread 的 checkpointer，Profile 主文件和备份独立存储在 `.data` 中。

当前 `buildSystemPrompt()` 只在 Agent 初始化时执行，因此 Profile 是进程启动时的静态快照：

- Tool 更新会立即写入磁盘。
- 当前工具循环仍能从 ToolCall 参数和 ToolMessage 得知本次更新结果。
- 同一进程中的后续 `/new` 会话仍使用旧的 System Prompt。
- 重启进程后才会从新 `profile.md` 加载更新后的 Profile。

若后续要求更新后立即影响所有会话，需要将 Graph 的 `systemPrompt: string` 改为每轮请求动态构建；该改动不属于首版 `profile_update` 范围。

### 实际文件改动

```text
src/agent/
  prompt.ts                              # 增加 profile_update 调用规则
  prompt.test.ts                         # 验证规则、Profile 内容和 Prompt 顺序
  runtime/
    graph.test.ts                        # 验证标准 Tool 循环和历史保持
  tools/
    index.ts                             # 注册 profile_update
    profile_update_tool.ts               # Schema、Tool、备份与原子写入
    profile_update_tool.test.ts          # 创建、全量更新、备份与安全边界
docs/
  commits/
    39-profile-prompt.md                 # Profile 读取与更新完整说明
    README.md                            # 更新第 39 篇索引主题
ROADMAP.md                               # 同步 Profile 读写完成状态
```

不修改 `write_file_tool.ts`、Memory Tool、SQLite Schema、FTS5 索引、依赖或 lockfile。

### Tool 测试与验收

1. Schema 只暴露 `content`，拒绝空白和 `<profile_info>` 外层标签。
2. description 只允许当前稳定的 Profile 属性，排除带时间的过去事件，并要求完整 Profile 和保留有效旧信息，但不包含路径、备份或原子写入细节。
3. `.data` 不存在时创建目录和主文件，返回 `created` 且不生成备份。
4. 已有文件时先生成唯一备份，再写入完整新内容并返回 `updated`。
5. 备份与更新前主文件字节一致，连续更新不会覆盖历史备份。
6. 已有空文件时仍创建备份。
7. 备份失败时主文件不变，临时写入或替换失败时清理临时文件。
8. 主文件为目录、符号链接或 `.data` 解析到工作目录外时拒绝更新。
9. System Prompt 明确区分当前稳定状态与带时间的过去事件，禁止从事件推断未陈述信息，并要求全量合并后调用一次 `profile_update`。
10. Graph 将 Tool 结果返回模型，并保持已有 checkpointer 历史不变。
11. Tool 已加入统一注册表。
12. `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过。
13. 构建产物使用临时工作目录验证创建、备份和更新，不污染真实 `.data/profile.md`。

上述运行时代码、注册、Prompt 规则和回归测试均已完成。

## 六、验证标准

1. 构建出的 System Prompt 包含完整的 `<profile_template>`。
2. 文件不存在时包含精确的 `<profile_info></profile_info>`。
3. 空文件和纯空白文件同样使用空标签。
4. 非空文件内容全部位于 `<profile_info>` 与 `</profile_info>` 之间。
5. Profile 数据安全规则位于实际 Profile 内容之前。
6. `profilePrompt` 位于 `memoryInstructions` 前面。
7. `memoryInstructions` 禁止将符合模板的当前稳定状态存为 memory，同时要求把具备长期价值的带时间经历保存为 `event` memory，并忽略临时琐事。
8. Skills 指令仍位于 Agent 基础指令之后。
9. 非 `ENOENT` 文件错误不会被静默吞掉。
10. `pnpm typecheck`、`pnpm test`、`pnpm build` 与 `git diff --check` 通过。
11. System Prompt 明确要求每条新用户消息在最终答复前独立完成任务、Profile 与 Memory 判断。
12. System Prompt 允许业务 Tool 与持久化 Tool 共存，同时禁止从查询地点等任务参数推断 Profile，或为明确事实补充用户未陈述的派生细节。

## 七、验证结果

- 9 条 Prompt 测试覆盖 Profile 文件不存在、纯空白、正常内容、非 `ENOENT` 读取错误、`profile_update` 规则顺序、带时间经历归属 `event` memory、每轮独立判断、显式事实边界，以及相对日期实时查询不跳过 Profile 更新。
- 10 条 `profile_update` 测试覆盖首次创建、内容规范化、历史备份、连续更新、空文件备份、Schema、description、统一注册、目录和符号链接边界。
- Graph 回归确认 Fake Model 可调用 `profile_update`，ToolMessage 保留名称和调用 ID，主文件与备份正确写入，已有 checkpointer 历史不被重写。
- `agent.ts` 已不再包含 System Prompt 常量或构建逻辑，只调用 `prompt.ts` 导出的 `buildSystemPrompt()`。
- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过，共 34 个测试套件、214 条测试。
- 构建产物在独立临时工作目录完成首次创建和再次更新，得到 `created`、`updated`、一个历史备份和正确的新旧文件内容，未访问项目真实 `.data/profile.md`。
- 构建产物检查确认“当前稳定状态归 Profile”“带时间经历归 `event` memory”和“禁止从事件推断个人信息”三项规则均进入最终 System Prompt；`profile_update` description 同步排除带时间的过去事件。
- 本地实际误分类修正通过 `profile_update` 先备份再更新，迁移后的 `event` memory 已由正式 `memory_retrieve` 流程命中，`memory_fts` 同步有效。
- 真实 Kimi 回归中，“居住地＋当前天气”第一批选择 `current_time` 与 `profile_update`，第二批使用明确日期调用 `web_search`；纯天气地点不更新 Profile，带年份教育经历只选择 `memory_create(event)`，临时状态不调用持久化 Tool。
- 真实 DeepSeek 回归通过同类分类场景；首次组合场景将“郑州”扩写为“河南省郑州市”，收紧显式事实规则后生成精确的“地区：郑州”；相对日期状态机强化后，最终同样先完成 `current_time` 与 `profile_update`，再执行带日期搜索。
- 真实模型回归只模拟成功 ToolMessage 以观察完整选择链，没有执行搜索、写入 Profile 或写入 Memory，因此未污染项目 `.data`。
- `git diff --check` 通过。

## 八、后续边界

- `buildSystemPrompt()` 在 Agent 初始化时执行，Profile 是当前进程启动时的快照；运行期间修改文件需要重启后才能进入 System Prompt。
- `.data/profile.md` 归属于当前工作目录，并由同一目录下的所有会话共享，不按 `thread_id` 隔离。
- `profile_update` 已形成 Profile 信息分类、读取、全量持久化和历史备份闭环。
- 继续使用真实 Kimi 和 DeepSeek 验证单字段更正、多字段合并、信息删除，以及获批后的完整 Profile 文件更新。
- 根据实际备份增长速度评估保留数量和清理策略，首版不自动删除备份。
- 若全量替换仍频繁遗漏旧信息，改为结构化 Profile Schema 或 Patch Tool。
- 请求前自动召回仍属于长期记忆 Roadmap 的后续事项。
