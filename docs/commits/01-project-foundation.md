# 01 初始化 Node TypeScript 与 Jest 开发环境

## Commit 信息

- Commit：[`015c97e`](https://github.com/qlypupil/mini-agent/commit/015c97ea7a88562ebe82fadf76c60d1e15d61e7d)
- 类型：`init`
- 状态：历史实现

## 问题与目标

这是项目的第一个提交。提交前没有可以编译、测试或持续维护的工程结构，因此首要目标不是实现 Agent，而是建立一条最小、可验证的 TypeScript 开发链路。

本提交需要同时解决：

1. 用统一的包管理器安装和锁定依赖。
2. 让 TypeScript 源码能够进行类型检查和构建。
3. 让 Jest 能执行 TypeScript 单元测试。
4. 先建立项目规范、路线图和忽略规则。

## 主要结构

本提交一次性创建了以下基础文件：

| 文件 | 职责 |
| --- | --- |
| `package.json` | 定义项目元数据、脚本和依赖。 |
| `pnpm-lock.yaml` | 锁定依赖解析结果。 |
| `pnpm-workspace.yaml` | 声明 pnpm 工作区。 |
| `tsconfig.json` | 配置 TypeScript 编译。 |
| `jest.config.cjs` | 配置 Jest 与 `ts-jest`。 |
| `src/index.ts` | 最小运行时代码。 |
| `src/index.test.ts` | 最小单元测试。 |
| `AGENTS.md` | 项目协作和工程约束。 |
| `ROADMAP.md` | 记录项目进度和验证状态。 |
| `.gitignore` | 排除依赖、构建产物和本地文件。 |

## 最小验证闭环

源码只实现了一个简单的求和函数：

```ts
export function sum(left: number, right: number): number {
  return left + right
}
```

这个函数没有 Agent 业务价值，它的作用是同时验证三个环节：

```text
TypeScript 源码
  -> tsc 类型检查和构建
  -> ts-jest 转换测试文件
  -> Jest 执行断言
```

如果这条链路不能稳定通过，后续接入模型 SDK、CLI 和 LangGraph 时就无法区分业务错误与工程配置错误。

## 工程决策

- 使用 `pnpm`，并提交锁文件，保证不同环境解析到一致依赖。
- 将源码集中放入 `src/`，测试与源码放在一起，便于定位行为和覆盖范围。
- 从第一天开始维护 `AGENTS.md` 与 `ROADMAP.md`，把协作规则和真实进度纳入代码仓库。
- 同时提供 `typecheck`、`test` 和 `build`，避免只验证“能运行”而遗漏类型或测试问题。

## 验证

该提交的成功标准是以下命令全部通过：

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 当时的边界

- 尚未安装 LangChain 或 LangGraph。
- 没有模型、Agent、Tool 或 CLI。
- `sum()` 只是工程冒烟测试，后续 Agent 入口建立后不再承担核心业务职责。

下一步是在这个可验证基座上安装 Agent 所需依赖，而不是直接把模型调用逻辑混入工程初始化提交。
