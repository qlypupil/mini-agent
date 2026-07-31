# 19 将包名与 CLI 重命名为 termclaw

## Commit 信息

- Commit：[`0924ab6`](https://github.com/qlypupil/mini-agent/commit/0924ab6)
- 类型：`chore`
- 状态：历史实现

## 问题与目标

早期包名是 `mini-agent`，全局命令是 `miniagent`。这个名称存在占用和辨识度问题，本提交统一改为 `termclaw`，并同步所有用户可见入口和测试断言。

## 命名迁移

```json
{
  "name": "termclaw",
  "bin": {
    "termclaw": "dist/agent/cli.js"
  }
}
```

Commander 命令名同步从 `miniagent` 改为 `termclaw`。包名、bin 名和帮助信息保持一致，避免出现安装一个名字、运行另一个名字的情况。

## 同步范围

- `package.json` 包名与 bin。
- Commander 命令名。
- README 使用示例。
- Roadmap 和提交历史描述。
- 文件读写 Tool 测试中的临时目录前缀与断言。
- 锁文件中的项目包名。

本提交还补充作者和文档地址元数据，为下一步启动欢迎屏提供数据来源。

## 展示依赖准备

同一提交加入 `chalk`、`boxen`、`figlet` 和 `@types/figlet`。这些依赖在本提交中主要作为下一阶段终端品牌展示的准备，实际 Banner 代码在第 20 个提交加入。

## 为什么需要一次性同步

重命名如果只修改 `package.json.name`，会留下：

- 旧全局命令仍然存在。
- 帮助文本显示旧名字。
- README 命令不可用。
- 测试继续断言旧路径或旧标识。

因此命名迁移必须覆盖安装入口、运行入口、文档和测试，而不是局部字符串替换。

## 验证

- `termclaw --help` 和 `termclaw --version` 正常。
- 构建和测试不再依赖 `miniagent` 名称。
- pnpm 锁文件与包元数据一致。

## 当时的边界

- 仓库 URL 仍是原 GitHub 项目地址，不因 npm 包名改变。
- 旧的全局软链接需要由本机包管理操作清理或替换。
- 新增的展示依赖尚未用于 CLI，下一提交才完成视觉层实现。
