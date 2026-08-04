# 42 跨平台危险路径基线与匹配器

## Commit 信息

- Commit：[`ae2e00e`](https://github.com/qlypupil/mini-agent/commit/ae2e00e24dace6dff402be3164ae0af58826e825)
- 类型：`feat`
- 状态：当前实现
- 基线：`38f2efd fix: 完善画像持久化与实时日期判断`
- 实现范围：建立 macOS、Windows、Linux 危险读取路径基线，并提供可独立调用和测试的 `isDangerousPath(filepath)` 判断函数；本阶段不接入现有 Tool。

## 一、背景

第 40 阶段已经为 Tool 增加权限等级，第 41 阶段已经要求所有 ToolCall 在执行前取得用户确认，但用户确认只能回答“是否允许本次调用”，不能判断目标文件本身是否包含系统凭据、浏览器会话或其他高风险数据。

本阶段先建立文件路径风险判断基础能力，解决两个问题：

1. 使用统一数据文件维护跨平台危险目录和文件，不把大量路径散落在业务代码中。
2. 将模型或用户给出的不同路径表达形式规范化后再判断，避免相对路径、环境变量、符号链接或 Windows 别名绕过字符串检查。

静态黑名单不可能覆盖所有应用、重定向目录和未来系统变化，因此这里采用“白名单为主、危险路径清单作为第二层防线”的模型。个人目录默认视为危险，但后续权限层可以根据用户明确选择的文件或目录建立临时授权。

## 二、危险路径数据

`src/agent/permission/dangerous-path.json` 使用版本化结构维护规则：

```text
policy
  -> 匹配要求、通配语义和安全边界
variables
  -> USER_HOME、APPDATA、XDG_CONFIG_HOME 等路径变量
dynamic_rules
  -> 个人已知目录、可移动介质、网络与云存储
rules
  -> common / darwin / win32 / linux
references
  -> Apple、Microsoft、Linux 及相关工具的官方资料
```

当前清单包含：

- 38 组规则。
- 277 个按平台生效的路径模式。
- 2 组需要运行时展开的动态目录规则。
- 21 条官方资料依据。

主要风险类别包括：

- SSH、GnuPG、云平台、Kubernetes、包管理器和开发工具凭据。
- `.env`、私钥、证书包、Terraform state、密码库和钱包。
- 浏览器 Cookie、会话、密码、历史和扩展数据。
- 邮件、消息、联系人、日历、照片、设备备份和命令历史。
- macOS Keychain／TCC、Windows Registry Hive／DPAPI、Linux shadow／进程内存。
- 交换文件、崩溃转储、日志、备份、回收站和原始设备。

JSON 中统一使用 `/` 作为分隔符，`*` 匹配单个路径段内字符，`**` 匹配任意层级。以 `/**` 结尾的模式同时匹配目录本身和全部后代。

## 三、判断函数接口

默认调用只需要一个参数：

```ts
isDangerousPath(filepath: string): boolean
```

返回规则：

- `true`：路径命中危险规则，或者输入无法被安全解析。
- `false`：路径在当前规则和解析结果下未被识别为危险。

函数还提供可选 `DangerousPathOptions`，用于跨平台测试及后续权限层注入：

```ts
interface DangerousPathOptions {
  platform?: NodeJS.Platform
  cwd?: string
  env?: Readonly<NodeJS.ProcessEnv>
  userHomes?: readonly string[]
  resolveRealPath?: (absolutePath: string) => string | undefined
}
```

生产环境不传参数时使用当前操作系统、当前工作目录、进程环境变量和系统 Home。测试可以在 macOS 上注入 Windows 或 Linux 上下文，不需要修改只读的 `process.platform`。

## 四、路径规范化

判断前依次执行：

```text
原始 filepath
  -> 校验空值、NUL 和引号完整性
  -> 展开 ~、%VAR%、${VAR}、$VAR
  -> 使用目标平台的 path.win32 或 path.posix 解析相对路径
  -> 折叠 . 与 ..，统一为 / 分隔符
  -> 应用平台大小写和 Windows 路径别名规则
  -> 匹配公共规则、平台规则和动态规则
  -> 解析真实路径后再次匹配
```

变量最多递归展开 10 次，支持变量值继续引用另一个变量。`KUBECONFIG` 按目标平台的路径列表分隔符拆成多个独立文件。未知变量、循环引用、残缺引号、NUL、未知操作系统和内部解析异常均默认返回 `true`，避免错误输入进入放行分支。

相对路径严格以传入的 `cwd` 或当前工作目录为基准。未加引号路径的前后空格作为真实文件名保留；完整的单引号或双引号只用于包裹整个路径表达式。

## 五、平台差异

### macOS

- 使用 POSIX 路径解析，并采用保守的大小写不敏感匹配，避免默认 APFS 卷上的大小写绕过。
- 保护 Keychain、TCC、Mail、Messages、Safari、照片、iCloud、设备备份、FileVault 和 Time Machine 等路径。
- `/Volumes` 下挂载内容默认视为需要用户明确选择的外部存储。

### Windows

- 使用 `path.win32`，环境变量名称与规则匹配均不区分大小写。
- 支持 `%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%`、`%SYSTEMROOT%` 等表达形式。
- 按 Win32 语义处理普通路径段末尾的点和空格。
- 设备命名空间、UNC、管理共享、ADS、保留设备名和 8.3 短文件名默认判为危险。
- 非系统盘默认按动态挂载存储处理。

### Linux

- 使用区分大小写的 POSIX 匹配。
- 支持 XDG 默认目录和环境变量覆盖。
- 保护 shadow、sudo、SSH／TLS／VPN 密钥、NetworkManager、systemd credentials、`/proc` 进程数据、桌面 Keyring、容器及集群凭据。
- `/media`、`/mnt` 和 `/run/media` 默认按外部挂载存储处理。

## 六、真实路径复检

仅检查用户提供的字符串会被符号链接或 Windows junction 绕过。函数在目标平台等于当前运行平台时调用 `realpathSync.native()`：

- 已存在目标直接解析最终真实路径。
- 目标尚不存在时逐级寻找最近的现存父目录，解析该父目录后再拼回缺失部分。
- 原始规范化路径和真实路径任意一个命中规则都返回 `true`。
- 遇到权限错误或其他无法确认真实目标的异常时默认返回 `true`。

这一判断只能降低检查与使用不一致的风险。未来 Tool 接入时仍须在真正打开文件之前立即复检，且必须使用与检查完全一致的路径解析结果。

## 七、构建与依赖

- 不增加第三方依赖，glob 匹配使用项目内的受限 `*`／`**` 编译逻辑。
- `tsconfig.json` 开启 `resolveJsonModule`，TypeScript 构建时将 `dangerous-path.json` 复制到 `dist/agent/permission/`。
- JSON 是路径风险事实来源；TypeScript 负责变量展开、平台规范化和匹配执行。

## 八、测试与验收

定向测试覆盖：

1. 公共规则的目录本身、后代、`.env`、私钥和 KUBECONFIG 列表。
2. 绝对路径、相对路径、`~`、`$HOME`、`${HOME}` 和带引号路径。
3. Windows `%USERPROFILE%`、`%APPDATA%`、`%LOCALAPPDATA%` 及大小写差异。
4. Windows UNC、原始设备、ADS、保留设备名、8.3 别名、尾随点和空格。
5. macOS Keychain、Messages、浏览器、TCC、个人目录和挂载卷。
6. Linux shadow、`/proc`、Keyring、浏览器、个人目录和挂载点。
7. 注入的真实路径解析器，以及临时文件系统中的真实 symlink／junction。
8. 空路径、NUL、未知变量、未知平台和解析异常的默认拒绝。
9. 三个平台中与规则无关的普通路径保持 `false`。

实现验证结果：

- `pnpm typecheck` 通过。
- `pnpm test --runInBand` 通过，共 35 个测试套件、250 条测试。
- `isDangerousPath` 定向测试 36 条全部通过。
- `pnpm build` 通过，构建产物包含 JSON，编译后的匹配器可直接加载执行。
- `git diff --check` 通过。

## 九、当前边界

- `isDangerousPath` 本阶段尚未接入 `read_file`、`write_file` 或其他 Tool，不代表危险路径已经被运行时拦截。
- `exec` 接收任意 shell 命令，不能依靠解析命令字符串可靠提取所有间接文件访问；后续应采用进程级文件系统沙箱。
- 静态规则无法发现全部非标准 Home、重定向 Known Folder、自定义挂载点和应用私有目录，调用方可通过可信系统 API 结果传入 `userHomes` 等上下文补充。
- 函数只返回布尔值，不返回命中的规则 ID、风险等级或用户授权状态；这些属于后续权限决策层。
- 用户确认、显式文件选择和危险路径判断是三层不同机制，任何一层都不能替代操作系统沙箱及最小权限配置。
