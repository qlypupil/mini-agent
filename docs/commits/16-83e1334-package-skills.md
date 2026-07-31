# 16 打包内置 Skills 并限制 npm 发布内容

## Commit 信息

- Commit：[`83e1334`](https://github.com/qlypupil/mini-agent/commit/83e1334)
- 类型：`build`
- 状态：历史实现

## 问题与目标

TypeScript 编译器只生成 JavaScript 和声明相关产物，不会自动复制 `SKILL.md`。开发环境能发现 Skills，不代表构建产物或 npm 安装后的 CLI 仍能发现它们。

本提交完善构建流水线，使内置 Skill 成为运行时资源，同时限制 npm 包内容。

## 构建流程

```text
clean-dist.mjs
  -> 清理旧 dist，避免残留资源
tsc -p tsconfig.build.json
  -> 只编译运行时源码
copy-skills.mjs
  -> 保持目录结构复制 SKILL.md
  -> 恢复 dist/agent/cli.js 可执行权限
```

`package.json` 将 `build` 串联为上述顺序，确保每次产物都从干净状态生成。

## Skill 资源复制

脚本递归扫描 `src/agent/skills`，只复制名为 `SKILL.md` 的文件：

```text
src/agent/skills/<name>/SKILL.md
  -> dist/agent/skills/<name>/SKILL.md
```

目的不是复制整个源码目录，而是携带运行时发现机制真正需要的资源。

## CLI 权限

构建脚本执行：

```ts
chmodSync(resolve('dist/agent/cli.js'), 0o755)
```

`npm link` 的全局命令是指向构建文件的软链接；重新构建后若丢失可执行权限，全局 CLI 会失效。

## npm 发布范围

`package.json.files` 只允许：

```json
[
  "dist",
  "README.md",
  ".env.example"
]
```

这样测试、源码、本地配置和无关文档不会默认进入发布包。

## 验证

- 构建后 `dist/agent/skills` 包含内置 `SKILL.md`。
- 在项目目录外运行构建产物仍能发现 Skills。
- `npm pack --dry-run` 的文件范围符合预期。
- 全局链接后的 CLI 保持可执行。

## 当时的边界

- 复制脚本只处理 `SKILL.md`，不处理 Skill 的其他资源文件。
- 后续引入完整 `skill-creator` 后，需要扩展复制策略。
- 此提交没有改变 Skill 的发现和加载协议。
