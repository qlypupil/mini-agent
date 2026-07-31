# 20 优化终端配色并添加欢迎屏

## Commit 信息

- Commit：[`71304a8`](https://github.com/qlypupil/mini-agent/commit/71304a8)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

CLI 已具备流式聊天、Tool 状态和 ESC 取消，但所有信息主要依靠纯文本区分。随着 Tool 事件增加，用户输入、AI 正文、工具状态和错误需要稳定的视觉层级。

本提交使用 `figlet`、`boxen` 和 `chalk` 建立启动 Banner 与状态配色，不改变 Agent 核心行为。

## Banner 结构

`printStartupBanner()` 输出三层信息：

1. `figlet` 渲染的产品名。
2. `boxen` 包裹的版本、描述、作者和文档地址。
3. ESC 取消和 `exit` 退出的快捷操作。

元数据直接读取 `package.json`：

```ts
const packageMetadata = require('../../package.json')
```

这样版本、名称和文档地址只维护一份。作者或文档缺失时使用占位符，不让 Banner 因可选字段为空而崩溃。

## 颜色语义

| 信息 | 样式语义 |
| --- | --- |
| `You:` | 绿色粗体。 |
| `AI:` | 蓝色粗体。 |
| Tool started | 黄色弱化。 |
| Tool completed | 绿色弱化。 |
| Tool failed | 红色，并截断错误详情。 |
| 取消提示 | 黄色。 |
| 请求异常 | 红色。 |

AI 正文保持终端默认颜色，避免长文本整段着色影响阅读。

## Tool 状态展示

Tool 事件发生时 CLI 插入状态行，然后重新输出 `AI:` 标签。失败详情最多显示前 200 个字符，防止异常堆栈破坏终端布局。

## 终端生命周期

本提交保留已有的 TTY 判断、活动 AbortController 和 raw mode 恢复逻辑。视觉调整不能改变取消和 readline 的工作方式。

## 验证

- 启动时正确显示 termclaw 标题和包信息。
- 用户、AI、Tool 和错误使用预期颜色。
- 非 TTY 环境不因 raw mode 失败。
- `--help`、`--version` 和正常聊天保持可用。

## 当时的边界

- 颜色是否显示取决于终端能力。
- Banner 每次启动都会输出，没有静默配置。
- Tool 过程会多次输出 `AI:`，后续提交才把标签收紧为正文首 token 展示。
