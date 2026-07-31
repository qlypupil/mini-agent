# 06 拆分 Agent CLI 命令定义

## Commit 信息

- Commit：[`08710be`](https://github.com/qlypupil/mini-agent/commit/08710beaf71647e50af69c50fe53722e0ef23e3f)
- 类型：`refactor`
- 状态：历史实现

## 问题与目标

首版 `cli.ts` 同时承担可执行入口、Commander 元信息、readline 生命周期和聊天循环。随着 CLI 参数和交互能力增加，这些职责需要拆分。

本提交还把构建产物注册为本机全局命令，让用户不必每次输入完整 Node 路径。

## 职责拆分

```text
src/agent/command.ts
  -> 定义命令名称、描述、版本和默认 action

src/agent/cli.ts
  -> 保留 shebang、readline、聊天循环和程序启动
```

`command.ts` 提供工厂函数：

```ts
export function createProgram(runChat: () => Promise<void>): Command {
  return new Command()
    .name('miniagent')
    .description(packageMetadata.description)
    .version(packageMetadata.version)
    .action(runChat)
}
```

需要注意：这个提交当时的命令名是 `miniagent`，不是后来的 `termclaw`。第 19 个历史提交才完成统一重命名。

## 可执行入口

`cli.ts` 保留：

```ts
void createProgram(main).parseAsync(process.argv)
```

同时 `package.json` 增加：

```json
{
  "bin": {
    "miniagent": "dist/agent/cli.js"
  }
}
```

构建后的 `cli.js` 依靠 shebang 作为可执行入口，通过 `npm link` 暴露为本机命令。

## readline 工厂

本提交抽取 `createInterface()`，把标准输入输出的创建集中起来。虽然函数很小，但它为后续终端测试、按键监听和生命周期调整提供了单一入口。

## 设计取舍

- Commander 只管理进程级命令和元信息。
- 聊天循环继续留在 CLI，不让命令定义模块依赖 Agent 细节。
- 版本和描述从 `package.json` 读取，避免在多个文件重复维护。

## 验证

- `miniagent --help`。
- `miniagent --version`。
- 直接启动并输入 `exit`，进程正常结束。

## 当时的边界

- 还没有 `/new`、`/sessions` 等聊天内命令。
- 全局命令名和包名仍处于早期命名阶段。
- `command.ts` 后来会重新合并进新的交互命令结构。
