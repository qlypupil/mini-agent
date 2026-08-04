# 43 Read／Write Tool 路径分级授权

## Commit 信息

- Commit：待提交
- 类型：`feat`
- 状态：当前实现
- 基线：`98e95e1 docs: 补齐危险路径判断提交信息`
- 实现范围：在 LangGraph Tool 执行前，根据权限等级、文件参数、项目边界和危险路径规则决定自动执行、策略阻止或请求用户确认。

## 一、背景

第 41 阶段要求所有 ToolCall 在执行前逐项确认，第 42 阶段建立跨平台危险路径基线和 `isDangerousPath(filepath)`。当前两项能力彼此独立：即使是无副作用的 `current_time`，也会触发确认；即使目标是明确禁止的系统凭据，用户确认后仍可能执行。

本阶段将两项能力组合为分级授权流程：

- 没有外部文件目标的 `read`／`write` Tool 自动执行。
- 项目内普通文件自动执行。
- 静态高危路径和无效路径直接阻止，不能通过用户确认放行。
- 项目外普通读取直接执行，项目外普通写入继续使用 human-in-the-loop 确认。
- `exec`、`network`、`db` 权限保持逐次确认。

## 二、文件参数元数据

当前文件 Tool 的模型参数名是 `path`，不是 `filepath`：

```ts
read_file  -> args.path
write_file -> args.path
```

不能通过扫描任意 `args.path` 猜测文件语义，否则未来 Tool 的同名业务字段可能被误判；也不能只凭 `read`／`write` 推断，因为 `current_time`、`load_skill` 和 `profile_update` 没有模型可控文件路径。

权限等级、Tool 权限元数据及挂载辅助函数统一归属
`src/agent/permission/index.ts`。`PermissionedTool` 增加可选的文件参数元数据：

```ts
interface ToolFilePathMetadata {
  file_path_arg?: string
}
```

注册规则：

| Tool | 权限 | `file_path_arg` |
| --- | --- | --- |
| `read_file` | `read` | `path` |
| `write_file` | `write` | `path` |
| `current_time` | `read` | 无 |
| `load_skill` | `read` | 无 |
| `profile_update` | `write` | 无 |

当 `permission_level` 为 `read` 或 `write`，但 Tool 没有 `file_path_arg`，或本次参数中没有可用字符串路径时，授权节点不询问用户，直接交给 ToolNode。Tool 自身的 Zod Schema 和实现仍负责处理缺失或无效业务参数。

## 三、危险路径检查结果

原有 `isDangerousPath()` 只返回布尔值，无法区分不可覆盖的静态规则与允许用户明确选择的动态目录。项目当前位于 `~/Documents`，而 `Documents` 属于动态 `deny_read_unless_user_selected` 规则；若只使用布尔值，普通项目文件也会被阻止。

保留现有布尔 API，并新增详细检查结果：

```ts
type DangerousPathStatus =
  | 'safe'
  | 'deny'
  | 'user_selection_required'
  | 'invalid'

interface DangerousPathInspection {
  status: DangerousPathStatus
  requestedPath?: string
  resolvedPath?: string
  ruleIds: string[]
}
```

状态语义：

- `safe`：规范化路径和真实路径均未命中规则。
- `deny`：命中公共或操作系统静态规则，或者 Windows 特殊设备／别名规则。
- `user_selection_required`：只命中动态个人目录、可移动介质、网络或云存储规则。
- `invalid`：路径为空、含 NUL、引号残缺、变量无法展开、平台不支持或解析异常。

`isDangerousPath()` 继续在状态不是 `safe` 时返回 `true`，保持第 42 阶段兼容。

## 四、项目目录判断

项目根目录在 Graph 创建时从 `process.cwd()` 获取并解析真实路径，避免运行过程中工作目录变化影响授权边界。

项目内自动执行必须同时满足：

1. 规范化请求路径位于项目根目录内。
2. symlink／junction 解析后的真实目标也位于项目根目录内。
3. 没有命中静态 `deny` 规则。
4. 路径检查结果不是 `invalid`。

这意味着：

- `./src/index.ts`：直接执行。
- 项目内 symlink 指向 `/tmp/file.txt`：不能按纯项目内路径处理；Read 在外部目标安全时直接执行，Write 请求确认。
- 项目外 symlink 指向项目内：同样按跨边界路径处理，Read 直接执行，Write 请求确认。
- 项目内 `.env`、私钥、云凭据：静态规则优先，直接阻止。
- 项目位于 `Documents`：动态规则被项目可信根豁免，普通源码仍可自动执行。

路径是否位于项目内不能使用字符串前缀，例如 `/project-other` 不能被 `/project` 误判。实现使用目标平台的 `relative()`，只有结果为空或既不以 `..` 开头、也不是绝对路径时才属于根目录。

## 五、按权限拆分决策

公共权限类型和元数据保存在 `permission/index.ts`，路径授权按行为拆分：

```text
permission/
  index.ts   # 公共权限类型与 withPermissionLevel
  read.ts    # authorizeRead
  write.ts   # authorizeWrite
  util.ts    # 项目边界与 isInProjectDir
```

两套策略返回统一动作：

```ts
type ToolAuthorizationAction = 'allow' | 'deny' | 'ask'
```

Read 决策顺序：

| 条件 | 动作 |
| --- | --- |
| Tool 未声明文件参数，或本次未取得字符串路径 | `allow` |
| 路径检查为 `invalid` | `deny` |
| 命中静态规则 `deny` | `deny` |
| 请求路径和真实路径都在项目内 | `allow` |
| 项目外命中 `user_selection_required` | `deny` |
| 项目外且路径为 `safe` | `allow` |

Write 决策顺序：

| 条件 | 动作 |
| --- | --- |
| Tool 未声明文件参数，或本次未取得字符串路径 | `allow` |
| 路径检查为 `invalid` | `deny` |
| 命中静态规则 `deny` | `deny` |
| 请求路径和真实路径都在项目内 | `allow` |
| 项目外命中 `user_selection_required` | `deny` |
| 项目外且路径为 `safe` | `ask` |

`exec`、`network` 和 `db` 不进入文件策略，保持 `ask`。

两套策略都在静态阻止之后、动态阻止之前判断项目目录，解决项目位于 `Documents` 与项目敏感文件仍需保护的冲突。跨项目边界的 symlink／junction 会单独检查外部一侧：外部路径安全时按对应权限的项目外规则处理，否则阻止。

## 六、LangGraph 流程

`authorize_tools` 根据 `permission_level` 调用 `authorizeRead()` 或 `authorizeWrite()`；其他权限直接分类为 `ask`：

```text
model_request
  -> authorize_tools
       -> allow：保留待执行
       -> deny：生成错误 ToolMessage
       -> ask：加入 interrupt requests
  -> tools：只执行没有对应 ToolMessage 的调用
  -> model_request
```

只有 `ask` 调用出现在 `ToolApprovalInterrupt.requests` 中。恢复数据只需包含这些请求的决定，并按请求顺序映射回原 ToolCall。

同一轮可以同时存在三种动作：

- 自动放行调用不需要用户输入。
- 策略阻止调用不进入 ToolNode。
- 待确认调用在用户批准后执行，拒绝后生成现有用户拒绝消息。

若一轮没有 `ask` 调用，Graph 不产生 interrupt，直接继续 ToolNode。已有 ToolCall／ToolMessage 配对规则保持不变。

## 七、策略阻止消息

危险路径不请求用户确认，并生成 `status: "error"` 的 ToolMessage：

```text
The requested file path is protected by the local filesystem safety policy.
The tool was not executed. Explain the restriction to the user and do not retry
or bypass it with another tool.
```

消息使用原 Tool 名称和 `tool_call_id`，不向模型额外泄露解析后的系统路径或具体凭据类型。模型随后生成自然语言说明，CLI 不打印 `[Tool]` 执行日志。

## 八、路径解析一致性

权限判断和文件 Tool 必须使用同一套路径表达式语义。`~`、`%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%`、`${HOME}` 等不能只在授权阶段展开、执行阶段却作为普通文件名处理。

危险路径模块提供规范化／真实路径检查结果；`read_file` 和 `write_file` 在实际打开文件前重新调用相同检查能力：

- 防止授权与执行使用不同路径。
- 在用户确认后的实际打开时刻重新解析 symlink／junction。
- 降低确认期间路径目标被替换造成的 TOCTOU 风险。

Tool 内原有 `.env*`、`.git` 和普通文件类型校验继续保留，作为独立纵深防御。

## 九、测试与验收

专项测试至少覆盖：

1. `current_time`、`load_skill`、`profile_update` 等无文件参数的 `read`／`write` Tool 不触发确认。
2. `read_file`、`write_file` 的项目内普通路径自动执行。
3. 项目位于 `Documents` 时，普通项目文件仍自动执行。
4. 项目内 `.env`、SSH 私钥、PEM 等静态高危路径被阻止。
5. Read 访问项目内外普通路径及跨安全边界 symlink／junction 时自动执行。
6. Write 访问项目外普通路径或跨安全边界 symlink／junction 时触发确认，批准后执行、拒绝后不执行。
7. 项目外个人目录、系统凭据、浏览器会话等危险路径直接阻止且不询问。
8. `exec`、`network`、`db` 仍触发确认。
9. 同一轮 `allow`、`deny`、`ask` 混合时，只询问 `ask` 集合且 ToolMessage 完整配对。
10. 无效路径、未知变量和真实路径解析失败默认阻止。
11. `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过。

## 十、当前边界

- 本阶段只处理单个文件路径参数，不支持复制、移动等多路径 Tool；后续应将元数据扩展为路径提取函数或路径数组。
- 用户确认只用于放行项目外普通写入，不能覆盖静态危险路径和动态受保护目录；普通读取不再触发确认。
- `exec` 仍需用户逐次确认，但确认无法限制命令间接访问哪些文件；完整隔离仍依赖后续进程级文件系统沙箱。
- 路径策略只控制 Agent Tool 调用，不改变操作系统 ACL、Full Disk Access、管理员或 root 权限。
