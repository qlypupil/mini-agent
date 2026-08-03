# 10 添加安全文件写入工具

## Commit 信息

- Commit：[`ca73113`](https://github.com/qlypupil/mini-agent/commit/ca73113780d274a0f8f5596b50b3f11a2dbf1a19)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

文件读取只能帮助 Agent 分析项目，无法完成创建或修改文件。写入能力的风险更高：路径越界可能覆盖用户文件，符号链接可能绕过目录限制，模型也不应改写 `.env` 或 Git 元数据。

本提交增加 `write_file`，允许创建和完整覆写当前工作目录中的 UTF-8 文件，同时强制执行路径边界。

## 输入协议

```ts
{
  path: string
  content: string
}
```

- `path` 必须是当前目录内的相对路径。
- `content` 是文件的完整内容，不是增量补丁。
- Tool 不自动创建缺失的父目录。

## 新建与覆写的不同校验

目标文件可能尚不存在，因此不能统一直接调用 `realpath(target)`。

新建文件流程：

```text
解析目标路径
  -> 校验目标字符串没有越界或敏感段
  -> realpath(parent)
  -> 校验真实父目录仍在工作目录内
  -> writeFile 创建文件
```

覆写已有文件流程：

```text
lstat(target)
  -> 允许普通文件或符号链接继续检查
  -> realpath(target)
  -> 校验符号链接最终目标仍在工作目录内
  -> 确认最终目标是普通文件
  -> writeFile 完整覆写
```

父目录真实路径校验是新建场景的关键：

```ts
const resolvedParentPath = await realpath(dirname(requestedPath))
assertSafePath(assertInsideRoot(root, resolvedParentPath))
```

## 安全边界

- 拒绝绝对路径和 `..` 越界。
- 拒绝 `.git` 与 `.env*` 路径段。
- 拒绝通过父目录符号链接向项目外创建文件。
- 拒绝覆写指向目录外的符号链接。
- 拒绝目录等非普通文件目标。

## 返回值

成功时只返回相对路径确认，不暴露绝对工作目录：

```text
Wrote file: <relative path>
```

## 验证

6 条单元测试覆盖创建、覆写、绝对路径、目录外路径、敏感文件和越界符号链接。真实 Agent 集成测试还验证模型能调用 Tool 创建内容精确匹配的文件。

## 当时的边界

- 只支持完整覆写，不支持 append 或 patch。
- 不创建父目录。
- 没有用户确认步骤，模型决定调用后会直接写入。
- 不处理并发写入冲突。

该实现把可写范围限制在工作目录，但并不等价于操作系统级沙箱。
