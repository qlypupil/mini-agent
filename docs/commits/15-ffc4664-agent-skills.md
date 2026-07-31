# 15 接入 Agent Skills 与按需加载

## Commit 信息

- Commit：[`ffc4664`](https://github.com/qlypupil/mini-agent/commit/ffc4664)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

把所有专业工作流都写进系统提示词会快速膨胀 Context，也不利于独立维护。本提交引入 Skills：启动时只暴露名称和描述，模型匹配到任务后再通过 `load_skill` 读取完整说明。

## 渐进式加载流程

```text
启动时递归扫描 SKILL.md
  -> 解析 YAML frontmatter
  -> 只保留 name、description、path
  -> 系统提示词列出技能目录

模型判断任务匹配某个 Skill
  -> 调用 load_skill(name)
  -> Tool 返回完整 SKILL.md
  -> 模型按完整说明继续任务
```

这种模式把每轮固定成本限制在技能元数据，只有真正使用时才支付完整 Skill 内容的 Context 成本。

## Skill 发现

`discoverSkills()` 递归查找名为 `SKILL.md` 的文件，并要求文件以 YAML frontmatter 开头，且至少包含非空 `name` 与 `description`。

异常文件不会让整个 Agent 启动失败，而是输出诊断并跳过。重复名称只保留一个，并提示目录名与 Skill 名不一致的问题。

## 系统提示词目录

`buildSkillsInstruction()` 把元数据转为 XML 风格目录，并对 `<`、`>`、`&`、引号进行转义：

```xml
<available_skills>
  <skill>
    <name>planner</name>
    <description>...</description>
  </skill>
</available_skills>
```

转义避免 Skill 元数据破坏提示词结构。

## `load_skill`

Tool Schema 使用启动时发现的 Skill 名称构造枚举，模型只能请求目录中真实存在的名称。Tool 读取对应 `SKILL.md` 完整内容，未知名称明确失败。

## 内置 Skills

本提交增加 `planner` 和 `programmer-resume` 两个示例 Skill，用于验证发现、目录披露和按需加载链路。

## 验证

- Skill 递归发现和 frontmatter 解析测试。
- 重复名称、无效文件和目录名不一致诊断。
- XML 转义和空目录行为测试。
- `load_skill` 成功与未知名称测试。
- 构建与真实模型调用验证。

## 当时的边界

- 只扫描包内 Skill 目录。
- 完整 Skill 内容进入 ToolMessage，过大文件会占用 Context。
- 构建后的 `dist` 还不能自动包含非 TypeScript 的 `SKILL.md`，下一提交解决资源复制。
