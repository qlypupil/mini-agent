# 17 重构入口并添加 Python 工具

## Commit 信息

- Commit：[`af2db79`](https://github.com/qlypupil/mini-agent/commit/af2db79)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

这个提交包含两个相关改动：整理 Skills/Tools 的集中入口，以及增加本机 Python 执行能力。

当时将：

- `skills/index.ts` 调整为顶层 `skills.ts`。
- `tools/index.ts` 调整为顶层 `tools.ts`。
- 测试入口同步调整。
- 新增 `run_py_tool.ts` 并注册为 `run_py`。

这次平铺结构后来又在 Agent 大规模整理时迁回职责目录，因此文档只描述当时状态。

## Python 执行流程

```text
模型生成 Python
  -> Zod 与运行时限制源码 20 KB
  -> spawn python3 -I -c <code>
  -> shell: false
  -> 只继承 PATH
  -> 收集 stdout/stderr
  -> 5 秒或 64 KB 时终止
```

`-I` 启用 Python 隔离模式，忽略用户 site 和 `PYTHON*` 环境变量，减少本机环境对执行结果的影响。

## 环境边界

```ts
spawn('python3', ['-I', '-c', code], {
  cwd: process.cwd(),
  shell: false,
  env: { PATH: process.env.PATH ?? '' },
})
```

- 不启动 shell，模型代码不会经过 shell 参数解析。
- 不继承项目完整环境变量，降低 API Key 泄漏风险。
- 保留 `PATH`，使系统可以定位 `python3`。

## 资源和错误处理

- 源码最大 20 KB。
- stdout 与 stderr 合计最大 64 KB。
- 单次运行最长 5 秒。
- 未安装 Python 时返回明确提示。
- 非零退出码返回 stderr 或 stdout。

## 与 `run_js` 的重要差异

`run_js` 使用 Node 权限模型默认拒绝文件和网络；`run_py` 的 `-I` 只隔离 Python 环境，不限制脚本访问文件系统或网络。

因此 `run_py` 不能被描述为与 `run_js` 同等级的权限沙箱。它主要保护项目环境变量和进程稳定性，仍应视为具有本机用户权限的代码执行。

## Tool 注册

`run_py` 加入统一 `tools` 数组，Schema 只暴露 `code`。Tool 描述明确依赖本机 Python、资源限制和环境变量边界，让模型在缺少 Python 时能够解释失败。

## 验证

- 测试正常输出、语法或运行错误、Python 缺失、超时、源码和输出限制。
- 类型检查、测试和构建通过。
- 真实 CLI 调用 `run_py` 执行 `print(2 + 3)` 返回 `5`。

## 当时的边界

- Python 代码仍可使用当前用户拥有的文件和网络权限。
- 没有依赖虚拟环境或项目依赖安装。
- Skills/Tools 顶层平铺入口只是阶段性结构，后续会重新归档。
