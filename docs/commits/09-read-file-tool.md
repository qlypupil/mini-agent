# 09 添加安全文件读取工具

## Commit 信息

- Commit：[`847adab`](https://github.com/qlypupil/mini-agent/commit/847adab41a0f7bdfaec1c275bbf7aadfaf0a9854)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

Agent 需要读取项目文件才能理解代码，但直接把任意路径交给文件系统会暴露工作目录外文件、环境变量和 Git 元数据。

本提交增加 `read_file`，目标不是“尽量提示模型只读安全文件”，而是在运行时代码中强制限制读取边界。

## 模型可见接口

Tool 只接收一个相对路径：

```ts
schema: z.object({
  path: z.string().describe(
    'A relative path to a file in the current directory.',
  ),
})
```

Schema 用于指导模型生成参数，但真正的安全校验必须在 `readFileTool()` 内完成，因为 Tool 参数仍可能来自错误模型输出或手工调用。

## 路径校验流程

```text
拒绝绝对路径
  -> 以 process.cwd() 解析目标
  -> relative() 检查是否出现 .. 越界
  -> 拒绝 .git 和 .env* 路径段
  -> realpath() 解析符号链接
  -> 再次检查真实路径是否位于根目录内
  -> 确认目标是普通文件
  -> 按 UTF-8 读取
```

关键判断是对规范化后的真实路径再次校验：

```ts
const resolvedPath = await realpath(requestedPath)
assertSafePath(assertInsideRoot(root, resolvedPath))
```

如果只检查用户输入字符串，工作目录内的符号链接仍可能指向目录外文件。

## 敏感文件保护

任意路径段等于 `.git` 或以 `.env` 开头时拒绝读取。这样既拦截根目录文件，也拦截子目录中的同名敏感路径。

这不是完整的秘密扫描器，但能阻断最常见的 API Key 和 Git 内部数据泄漏入口。

## 文件职责

- `read_file_tool.ts`：路径解析、安全校验和 UTF-8 读取。
- `read_file_tool.test.ts`：安全边界回归测试。
- `tools/index.ts`：Tool 名称、描述、Schema 和注册。

## 验证

测试覆盖：

- 允许读取当前目录中的普通文本文件。
- 拒绝绝对路径。
- 拒绝 `..` 越出当前目录。
- 拒绝符号链接指向目录外。
- 拒绝 `.env*` 和 `.git`。
- 拒绝目录等非普通文件。

## 当时的边界

- 只支持 UTF-8 文本。
- 没有按字节限制读取结果，超大文本仍可能占用 Context。
- 不支持按行或按区间读取。
- 当前工作目录由启动 CLI 的位置决定。

后续 Tool 输出持久化和 Context 简化会进一步处理大结果问题。
