# 12 添加受限 JavaScript 执行工具

## Commit 信息

- Commit：[`48d945f`](https://github.com/qlypupil/mini-agent/commit/48d945f87c72518f1b7b56b04df5d62aa38f3007)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

结构化 `exec` 适合只读项目查询，但不适合让模型完成临时计算、数据转换或算法验证。直接在 Agent 进程内使用 `eval` 会共享文件、网络、环境变量和进程权限，因此不能接受。

本提交把模型生成的 JavaScript 放入独立 Node.js 子进程，并使用 Node 权限模型限制能力。

## 执行模型

```text
模型生成 JavaScript
  -> Zod 限制源码长度
  -> spawn 独立 node 进程
  -> --permission 默认拒绝高风险能力
  -> --input-type=module --eval 执行
  -> 收集 stdout 和 stderr
  -> 返回 Tool 结果
```

子进程参数包含：

```text
node --permission --input-type=module --eval <code>
```

没有授予文件系统、网络、子进程或 worker 权限，因此代码默认不能访问这些宿主能力。

## 环境隔离

子进程不启动 shell，并且只继承运行 Node 所需的有限环境，而不是项目完整 `process.env`。这样模型代码不能直接读取 `.env` 已加载的 API Key。

## 资源限制

- 源码最大 20 KB。
- 执行时间最大 5 秒。
- stdout 与 stderr 合计最大 64 KB。
- 超时或输出超限时终止子进程。

错误被转换为模型可读结果，覆盖 Node 缺失、语法错误、运行时异常、超时和输出超限。

## 为什么不用主进程 `eval`

主进程执行会共享：

- Agent 的环境变量和 API Key。
- 当前文件系统权限。
- 网络访问。
- 已加载模块和全局状态。
- CLI 进程稳定性。

独立进程可以在超时后终止，并把崩溃限制在本次 Tool 调用内。

## 验证

9 条测试覆盖单行计算、多行异步代码、复杂数据处理、特殊字符、语法错误、运行时错误、超时、输出限制和权限隔离。

## 当时的边界

- 依赖支持权限模型的 Node.js 版本。
- 结果只能通过 stdout/stderr 返回。
- 不是强对抗型沙箱，不能替代容器或专用代码执行平台。
- Tool 失败在当时仍可能以普通字符串表达，错误协议后来才统一。
