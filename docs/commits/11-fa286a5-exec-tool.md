# 11 添加安全命令执行工具

## Commit 信息

- Commit：[`fa286a5`](https://github.com/qlypupil/mini-agent/commit/fa286a5002f4536b3fe429428efd756c818e2ae4)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

读取单个文件不足以完成目录浏览、文本搜索和 Git 状态分析，但允许模型执行任意 shell 字符串会立即暴露命令注入和写操作风险。

本提交采用结构化白名单，而不是“过滤危险字符”的任意 shell 方案。

## 模型输入

```ts
{
  command: 'ls' | 'find' | 'rg' | 'pwd' |
    'git_status' | 'git_diff' | 'git_log'
  path?: string
  query?: string
  maxDepth?: number
}
```

模型选择一个语义命令，Tool 实现负责将结构化字段转换为固定可执行文件和参数数组。模型不能直接提供 `rm`、重定向或管道。

## 进程执行边界

```ts
const child = spawn(command, args, {
  cwd,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

`shell: false` 是核心边界：

- `|` 不会形成管道。
- `>` 不会发生重定向。
- `$()` 和反引号不会执行命令替换。
- 用户输入只会成为单个参数，而不是新的 shell 语句。

## 资源限制

- 单次命令最长运行 5 秒。
- stdout 与 stderr 合计最多 64 KB。
- 超时或输出超限时终止子进程。
- `find` 的最大深度限制为 `0～5`。

路径参数复用当前工作目录、敏感路径和真实路径校验，避免借助 `ls`、`find` 或 `rg` 读取项目外内容。

## 只读 Git 映射

模型使用 `git_status`、`git_diff` 和 `git_log` 这样的逻辑名称，Tool 内部映射为固定 Git 参数。这样可以开放常用只读诊断，而不允许模型自由构造 `git reset`、`checkout` 或 `push`。

## 验证

单元测试覆盖：

- 列出允许目录。
- 返回工作目录。
- 拒绝白名单外命令。
- 拒绝目录外路径。
- 拒绝敏感路径。

真实 Agent 验证模型通过 `exec` 执行 `ls src` 并返回正确目录内容。

## 当时的边界

- 不是通用终端，只支持预定义只读操作。
- 白名单命令可用性依赖本机环境。
- 输出仍直接进入 ToolMessage。
- 进程隔离不等于容器或系统沙箱。
