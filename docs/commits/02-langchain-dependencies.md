# 02 添加 LangChain 依赖

## Commit 信息

- Commit：[`e3d8185`](https://github.com/qlypupil/mini-agent/commit/e3d818507ffd5b9ff6b92ace64aebb3348356bbb)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

工程基座已经可以编译和测试，但还没有模型客户端、Agent 编排、Graph 状态或 Tool 协议。这个提交只负责准备依赖，不同时创建 Agent 入口。

将依赖准备与业务实现分开有两个作用：

- 可以单独确认包版本和锁文件是否正确。
- 后续 Agent 提交只聚焦模型配置、Tool 和流式调用，不混入大段安装差异。

## 依赖职责

本提交在 `package.json` 和 `pnpm-lock.yaml` 中加入 LangChain 体系依赖，核心职责分别是：

| 依赖方向 | 后续用途 |
| --- | --- |
| LangChain 主包 | 创建 Agent 和组织模型调用。 |
| `@langchain/core` | Message、Tool、Runnable 等基础协议。 |
| `@langchain/langgraph` | Graph 状态、checkpointer 和工具循环。 |
| `@langchain/openai` | 调用兼容 OpenAI 协议的 Moonshot 接口。 |

## 变更范围

本提交只修改：

```text
package.json
pnpm-lock.yaml
```

没有新增 `src/agent`，也没有读取 API Key 或发起网络请求。依赖安装成功不代表模型已经可用，只代表编译器和包管理器能够解析后续实现需要的模块。

## 设计取舍

- 复用 Moonshot 的 OpenAI 兼容接口，而不是为模型服务重新实现 HTTP 客户端。
- 同时引入 LangChain 与 LangGraph，为后续 Tool 和会话状态留下明确演进路径。
- 提交锁文件，避免 SDK 的间接依赖在不同机器上漂移。

## 验证

主要验证点是 pnpm 能完成安装并生成稳定锁文件，现有 TypeScript、Jest 和构建链路不因新增依赖而退化。

## 当时的边界

- 没有 Agent 实例。
- 没有模型配置或环境变量。
- 没有验证 Moonshot API 连通性。
- 没有决定会话状态如何持久化。

下一步提交才使用这些依赖建立真实的终端 Agent。
