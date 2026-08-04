# 44 Exec 静态命令权限

## Commit 信息

- Commit：[`95f439f`](https://github.com/qlypupil/mini-agent/commit/95f439f71f30eb02955038870e1c798379e87074)
- 类型：`feat`
- 状态：当前实现
- 基线：`52d011f feat: 拆分读写权限策略`
- 实现范围：在 LangGraph 执行 `exec` 权限 Tool 前检测 `command` 中显式的目录切换、可静态识别的非 Shell 语言入口和跨平台危险操作；命中时直接阻止。只有整条命令可静态证明为安全只读操作时自动执行，其他命令继续请求用户确认。

## 一、背景

第 43 阶段已经将 Read、Write 权限拆成独立策略，但 `exec`、`run_js` 和 `run_py` 仍统一进入用户确认。完整 shell 命令既可以通过 `cd`、`pushd` 等指令改变子进程工作目录，也可以直接调用 Python、JavaScript、Java、Go 等语言入口，绕过按用途拆分的代码执行 Tool。

本阶段对三类明确行为增加不可由确认覆盖的阻止规则：

- 阻止显式目录切换。
- 阻止命令位置上可静态识别的非 Shell 语言运行时、编译器和直接脚本入口；Python 提示模型可选择 `run_py`，JavaScript／TypeScript 提示可选择 `run_js`。
- 阻止命令文本中可静态确认的超级权限、删除、写入、权限修改、进程与服务控制、用户修改、敏感信息获取及网络／远程控制行为。

在危险操作阻止规则之上，本阶段增加严格的安全命令集合，减少 `ls`、`pwd`、`git status` 等明确只读操作的重复确认。只有命令入口、参数和全部复合命令片段都通过检查时才自动执行。

以下调用可自动执行：

```bash
cat README.md
find src -name prompt.ts
git status --short
git diff
git log -1
echo hello
date
whoami
```

该规则不是 shell 安全解析器，也不把无法确认副作用的任务一律判为危险。以下不透明调用仍按普通 Exec 请求确认：

```bash
bash scripts/check.sh
pnpm test
make check
```

更完整的文件系统限制仍需后续进程级沙箱。

## 二、模块职责

新增 `src/agent/permission/exec.ts`，提供五个独立函数：

```ts
isChangingDirectory(command: string): boolean
detectLanguageExecution(command: string): 'python' | 'javascript' | 'other' | undefined
detectDangerousOperation(command: string, options?): DangerousExecOperation | undefined
isSafeExecCommand(command: string, options?): boolean
authorizeExec(args: Record<string, unknown>): ToolAuthorization
```

- `isChangingDirectory()` 只负责检测命令文本。
- `detectLanguageExecution()` 只负责从命令位置识别语言入口并分类。
- `detectDangerousOperation()` 只负责识别直接可见的跨平台危险操作。
- `isSafeExecCommand()` 只负责证明整条命令是否属于严格的只读安全集合。
- `authorizeExec()` 只负责将检测结果转换为权限动作。
- `runtime/graph.ts` 根据可信的 `permission_level` 分发到 Exec 策略。
- `tools/exec_tool.ts` 继续只负责实际执行、超时和输出限制。

授权逻辑不放在 `agent.ts`。逐个 ToolCall 的名称、参数和权限只在 StateGraph 的 `authorize_tools` 节点中可用，`agent.ts` 仅负责创建和调用 Graph。

## 三、目录切换检测

本阶段使用明确约定的轻量正则：

```ts
export function isChangingDirectory(command: string): boolean {
  return /(?:^|[\s;|&])(?:cd|chdir|pushd|popd)(?:\s|$)/i.test(command)
}
```

检测范围：

- 命令开头的 `cd`、`chdir`、`pushd`、`popd`。
- 位于空白、`;`、`|` 或 `&` 之后的上述单词。
- 大小写不敏感。
- 关键字后必须是空白或命令结尾，避免将 `cdrom` 等普通单词判为目录切换。

该正则是保守启发式判断：字符串、注释或普通参数中的独立 `cd` 也可能被阻止；通过变量、转义、脚本或其他程序间接改变目录也可能不命中。漏检结果仍是 `ask`，不会自动执行。

## 四、语言执行入口检测

语言检测只检查每个 shell 命令段的可执行入口，不扫描所有普通参数，避免把以下只读文本操作误判为代码执行：

```bash
echo python
rg node README.md
cat app.py
```

检测器使用项目内的轻量词法扫描，不增加 shell 解析依赖：

- 在引号外按换行、`;`、`|`、`&`、括号和反引号识别命令边界。
- 跳过前置环境变量赋值和 shell 控制关键字。
- 识别绝对路径、相对路径、Windows 路径、`.exe`／`.cmd` 后缀和常见版本后缀。
- 识别 `env`、`command`、`exec`、`nohup`、`time` 及明确的包执行入口，例如 `npx tsx`、`pnpm exec ts-node`。
- 直接位于命令位置的 `.py`、`.js`、`.ts` 等脚本文件按对应语言分类。

首批分类范围：

| 分类 | 入口示例 | 拒绝原因 |
| --- | --- | --- |
| Python | `python`、`python3.12`、`pypy`、`py`、`.py` | `python_execution` |
| JavaScript／TypeScript | `node`、`nodejs`、`deno`、`bun`、`tsx`、`ts-node`、`.js`、`.ts` | `javascript_execution` |
| 其他语言 | Java、.NET、Go、Ruby、Rust、C／C++、PHP、Perl、Lua、Swift、Kotlin、Scala、R、Julia 等常见入口 | `other_language_execution` |

`sh`、`bash`、`zsh`、`dash`、`ash`、`ksh` 等 Shell 入口不属于上述分类。外部 Shell 脚本保持 `ask`；`-c` 内联命令只有在递归检查后全部属于安全集合时才能自动执行。

## 五、跨平台危险操作检测

危险操作使用命令入口、子命令、参数、引号外输出重定向和敏感路径联合判断。规则按 common、macOS、Linux、Windows 组织，命令名统一忽略大小写，并兼容绝对可执行路径及 Windows `.exe`／`.cmd` 后缀。

| 分类 | macOS／Linux 示例 | Windows 示例 | 拒绝原因 |
| --- | --- | --- | --- |
| 超级权限 | `sudo`、`su`、`doas`、`pkexec` | `runas`、`Start-Process -Verb RunAs` | `privilege_escalation` |
| 删除文件／目录 | `rm`、`rmdir`、`unlink`、`shred`、`find -delete`、`git clean/rm` | `del`、`erase`、`rd`、`Remove-Item` | `file_deletion` |
| 修改文件／目录 | `>`、`>>`、`cp`、`mv`、`mkdir`、`touch`、`tee`、`sed -i` | `copy`、`move`、`ren`、`md`、`Set-Content`、`New-Item` | `file_modification` |
| 修改权限 | `chmod`、`chown`、`chgrp`、`chflags`、`setfacl` | `icacls`、`takeown`、`attrib`、`Set-Acl` | `permission_change` |
| 控制进程和服务 | `kill`、`pkill`、`systemctl`、`service`、`launchctl`、`shutdown` | `taskkill`、`sc`、`net start/stop`、`Stop-Process` | `process_service_control` |
| 修改用户信息 | `useradd`、`usermod`、`passwd`、`groupadd`、`dscl` | `net user/localgroup`、本地用户 PowerShell Cmdlet | `user_account_change` |
| 获取敏感信息 | 环境变量、系统身份、进程信息、Keychain／Secret Service，以及读取危险路径 | `systeminfo`、`cmdkey`、凭据命令，以及读取危险路径 | `sensitive_information_access` |
| 网络和远程控制 | `curl`、`wget`、`ssh`、`scp`、`nc`、`telnet`、`ping`、`dig` | `Invoke-WebRequest`、`netsh`、`winrm`、`mstsc` | `network_remote_control` |

上下文规则：

- `git status/diff/log` 可在参数安全时自动执行；其他未命中危险规则的只读或不透明子命令保持确认，删除、写入和远程子命令直接阻止。
- `npm`、`pnpm`、`yarn` 的 `test/run` 等不透明任务保持确认；`install/add/remove/update/publish` 等明确修改或联网子命令直接阻止。
- `cat`、`head`、`tail`、`grep`、`find`、`ls` 等读取普通路径可在参数安全时自动执行；静态危险路径始终阻止，项目内普通路径豁免所在个人目录的动态规则，项目外动态保护目录按敏感信息阻止。
- 引号外 `>`、`>>`、`&>` 等文件输出重定向按修改阻止；`2>&1`、`1>&2` 等文件描述符合并不视为文件修改。
- 递归检查 `bash -c "..."`、`cmd /c ...`、`powershell -Command ...` 中的直接危险操作；外部 Shell 脚本文件的内容不在本阶段展开。

## 六、安全命令自动放行

自动放行采用正向安全集合，不以“没有命中危险规则”等同于安全。首批范围如下：

| 平台 | 自动放行入口 |
| --- | --- |
| 公共 | `ls`、`pwd`、`cat`、`head`、`tail`、`grep`、`find`、`echo`、`date`、`whoami` |
| Git | 仅 `git status`、`git diff`、`git log` |
| Windows | `dir`、`type`、`findstr`、`where`、`Get-ChildItem`、`Get-Location`、`Get-Content`、`Select-String`、`Get-Date` |

安全判定遵循以下约束：

- 先执行目录切换、语言入口和危险操作检测；任何拒绝规则都优先于安全集合。
- 管道、`;`、`&&`、`||` 和换行组成的复合命令，只有每个可执行片段都属于安全集合时才自动执行。
- 命令替换、反引号、变量展开、通配符和大括号展开等动态 shell 语法无法静态确定最终命令或路径，因此回退为 `ask`；Windows 环境变量和通配符即使位于引号内也不自动放行。
- `find -delete` 归类为删除；`-exec`、`-execdir`、`-ok`、`-okdir` 等间接执行入口直接阻止；`-fprint`、`-fprint0`、`-fprintf`、`-fls` 等文件输出动作归类为修改。
- `git diff/log --output` 归类为文件修改；`--ext-diff` 和 `--textconv` 等外部执行入口直接阻止。
- 引号外输出重定向仍按文件修改阻止，敏感路径读取仍按敏感信息获取阻止。
- `grep` 递归读取、参数文件，`find` 跟随符号链接、输入路径文件，以及 `ls` 解引用符号链接等扩大读取边界的参数不自动放行。
- `date` 只允许无参数调用、输出格式和明确的显示选项，不自动放行设置系统时间、读取参考文件或其他未知参数。
- `whoami` 从敏感信息命令集合移入安全集合；`id`、`groups`、`ps`、`systeminfo` 等继续阻止。
- Windows `dir/findstr/where` 的递归或参数文件模式、`Get-ChildItem -FollowSymlink` 以及 PowerShell 内联复合命令不自动放行，避免一次安全调用扩大为间接文件读取。
- 未知命令、外部 Shell 脚本、包管理器脚本和无法完整解析的命令都保持 `ask`。

## 七、Exec 决策矩阵

`permission_level: "exec"` 包含 `exec`、`run_js` 和 `run_py`，但后两者没有 `command` 参数。因此不能将缺少 `command` 解释为自动放行。

| 条件 | 动作 |
| --- | --- |
| 没有字符串类型的 `args.command` | `ask` |
| `args.command` 是字符串且命中 `isChangingDirectory()` | `deny`，原因 `directory_change` |
| 命中 Python 执行入口 | `deny`，原因 `python_execution` |
| 命中 JavaScript／TypeScript 执行入口 | `deny`，原因 `javascript_execution` |
| 命中其他语言执行入口 | `deny`，原因 `other_language_execution` |
| 命中任一危险操作 | `deny`，原因使用对应危险操作分类 |
| 整条命令及全部片段通过安全集合与参数检查 | `allow` |
| 以上规则均未命中，但不能静态证明安全 | `ask` |

同一命令同时命中多项规则时，按目录切换、语言入口、危险操作、安全集合的顺序决策，保留既有拒绝行为。安全集合是最后一步，任何未知或漏检结果只会进入 `ask`，不会自动执行。

Read、Write、Network 和 DB 权限行为不变。

## 八、Graph 集成

`authorize_tools` 的可信权限分发增加 Exec 分支：

```text
read    -> authorizeRead
write   -> authorizeWrite
exec    -> authorizeExec
network -> ask
db      -> ask
```

命中任一拒绝规则时生成配对的错误 `ToolMessage`，不进入 interrupt，也不执行 Tool。Graph 按原因提供不同提示：

```text
directory_change            -> 说明禁止切换目录
python_execution            -> 说明 exec 禁止 Python，并提示可选择 run_py
javascript_execution        -> 说明 exec 禁止 JavaScript／TypeScript，并提示可选择 run_js
other_language_execution    -> 说明 exec 只允许 Shell 类脚本，不提供绕过方式
八类危险操作原因           -> 说明对应本地策略限制，不泄露命中的敏感路径
```

通过安全集合的 Exec 调用直接进入 ToolNode，不产生 interrupt；未命中安全集合的 Exec 调用保持现有 human-in-the-loop 流程，只有用户明确批准后才进入 ToolNode。

## 九、测试与验收

专项测试覆盖：

1. `cd /tmp`、`pwd && cd ..`、`pushd`、`popd` 和大小写形式被识别。
2. `pwd`、普通管道和无目录切换的命令不命中。
3. Python、JavaScript／TypeScript 和其他语言的直接入口、路径、版本后缀、Windows 后缀及直接脚本文件被正确分类。
4. `echo python`、`rg node README.md`、`cat app.py`、Shell 脚本及约定的间接任务入口不误判。
5. 八类危险操作覆盖 macOS、Linux、Windows 的直接命令、上下文子命令和输出重定向。
6. 公共安全命令、三个 Git 子命令及 Windows 等价命令在参数安全时返回 `allow`。
7. 复合命令只有全部片段安全时放行；未知片段、动态 shell 语法和外部脚本保持确认。
8. `find` 间接执行／输出、Git 输出／外部执行、重定向及敏感路径仍优先拒绝。
9. Shell 内联安全命令递归放行，危险命令递归阻止，外部 Shell 脚本保持确认。
10. 十二类拒绝原因分别生成正确的错误 ToolMessage，不询问、不执行。
11. Graph 中安全 Exec 不产生 interrupt 并直接执行，未知 Exec 仍支持批准或拒绝。
12. 没有 `command` 的 `run_js`、`run_py` 继续请求确认。
13. Read、Write、Network 和 DB 授权回归不变。
14. `pnpm typecheck`、`pnpm test --runInBand`、`pnpm build` 与 `git diff --check` 通过。

**实际验证**：权限与 Graph 定向测试共 236 条，全量测试共 39 个测试套件、487 条测试；`pnpm typecheck` 与 `pnpm build` 通过。

## 十、当前边界

- 本阶段不解析完整 shell AST，不增加 shell 解析依赖；检测结果只能作为 Tool 路由策略，不能作为完整安全沙箱。
- 危险路径检查只用于可识别读取命令的路径参数，不尝试把任意参数猜成文件路径。
- 正则可能产生保守误判；被误判的命令会直接阻止，需要用户改写为不含目录切换关键字的等价命令。
- 别名、重命名后的可执行文件、任意二进制的真实行为、不透明任务入口及外部 Shell 脚本内部的二次调用无法仅凭外层 `command` 可靠识别，继续进入用户确认。
- `run_js` 使用 Node 权限模型限制文件、网络和子进程；`run_py` 目前只隔离用户 site 与环境变量，仍可访问文件、网络和子进程，二者安全边界不同。
- 只有安全集合内且参数可静态确认的 Exec 命令自动执行；未命中规则的其他命令仍需用户确认。
- 完整目录和文件访问隔离保留给后续跨平台进程级沙箱。
