# 18 内置完整 skill-creator 资源

## Commit 信息

- Commit：[`0ba7941`](https://github.com/qlypupil/mini-agent/commit/0ba7941)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

此前构建脚本只复制 `SKILL.md`，适合只包含说明文件的简单 Skill。但完整的 `skill-creator` 还包含许可证、参考文档、子 Agent、HTML 资源和 Python 脚本，只复制入口文件会让 Skill 指向不存在的配套资源。

本提交完成两件事：

1. 将完整 `skill-creator` 目录加入内置 Skills。
2. 把构建复制策略从“只复制 `SKILL.md`”扩展为“复制 Skills 目录内所有非 TypeScript 资源”。

## 资源结构

该 Skill 不再是单文件说明，而是一个资源包：

```text
skill-creator/
  SKILL.md
  LICENSE.txt
  agents/
  assets/
  eval-viewer/
  references/
  scripts/
```

`SKILL.md` 负责入口和路由，其他目录分别提供评估 Agent、可视化页面、Schema 参考和自动化脚本。

## 构建策略调整

复制条件改为：

```ts
function shouldCopyFile(fileName) {
  return !fileName.endsWith('.ts')
}
```

原因是 Skills 目录中的 TypeScript 源码已经由 `tsc` 编译；其他资源不会进入 `dist`，必须按相对路径原样复制。

```text
src/agent/skills/<relative path>
  -> dist/agent/skills/<relative path>
```

保持目录结构是必要条件，因为 Skill 文档中的相对路径需要在开发环境和构建产物中得到相同解析结果。

## 设计取舍

- 不为每种扩展名维护白名单，避免遗漏 HTML、Python、许可证或未来资源。
- 只排除 TypeScript，防止把源码与编译结果重复打包。
- 继续由统一 `copy-skills.mjs` 处理资源，不把复制逻辑散落到每个 Skill。

## 验证

- 构建后完整 `skill-creator` 目录存在于 `dist`。
- `load_skill` 仍能读取入口 `SKILL.md`。
- Skill 引用的参考文件、脚本和页面在构建产物中存在。

## 当时的边界

- 构建脚本默认信任仓库内 Skill 资源。
- Skill 的 Python 脚本依赖本机运行环境。
- npm 包体积会随完整 Skill 资源增长。
- Agent 仍只在启动时披露 Skill 目录，配套资源需按 Skill 指令按需使用。
