# 08 统一 Agent 工具与终端输入

## Commit 信息

- Commit：[`10611a3`](https://github.com/qlypupil/mini-agent/commit/10611a395947cf2ccf5ff078e83c069e49523359)
- 类型：`feat`
- 状态：历史实现

## 问题与目标

前一阶段有两个独立问题：

1. Tool 实现、LangChain 元信息和 Agent 注册混在 `agent.ts`，难以独立测试和扩展。
2. 每轮请求切换 raw mode 会干扰 readline，导致中文输入出现重复回显。

本提交同时建立统一 Tool 注册入口，并稳定终端输入生命周期。

## Tool 分层

```text
tools/search.ts
  -> 纯业务函数，只接收 query 并返回结果

tools/index.ts
  -> LangChain tool() 包装
  -> name、description、Zod schema
  -> 导出统一 tools 数组

agent.ts
  -> 只导入 tools 注册表
```

注册入口：

```ts
const searchTool = tool(
  ({ query }: { query: string }) => search(query),
  {
    name: 'search',
    description: 'Search the web for information',
    schema: z.object({ query: z.string() }),
  },
)

export const tools = [searchTool]
```

新增 Tool 时只需实现业务函数、测试业务边界，并在一个注册表中声明模型可见协议。

## 测试收益

`search.test.ts` 直接测试 `search()`，不需要构造模型、Agent 或 ToolCall。这样可以区分：

- 业务函数是否返回正确内容。
- LangChain Tool Schema 是否正确注册。
- 模型是否选择调用 Tool。

三者属于不同层级，不应由同一种测试混在一起验证。

## 终端输入修复

raw mode 改为 CLI 生命周期内统一管理，不再在每次 `readline.question()` 回调后反复切换。CLI 使用 `activeController` 表示当前是否存在可取消请求：

```ts
const controller = new AbortController()
activeController = controller
```

ESC 只在 `activeController` 存在时取消本轮请求，不影响等待用户输入的 readline 状态。

## 验证

- `search.test.ts` 覆盖两条实现分支。
- `pnpm test --runInBand`、`pnpm typecheck` 和 `pnpm build` 通过。
- `pnpm dev` 输入中文天气问题时只回显一次。

## 当时的边界

- `search` 仍是固定结果示例，不是真实网页搜索。
- 统一注册表只有一个 Tool，尚未验证文件和命令安全边界。
- 工具运行日志仍由具体 Tool 自己输出。

接下来多个安全 Tool 都会沿用“纯函数实现 + `tools/index.ts` 注册”的结构。
