# mini-agent

基于 TypeScript 的 Node.js 项目骨架，使用 pnpm 管理依赖，并通过 Jest 执行单元测试。

## 环境要求

- Node.js 24 或更高版本
- pnpm 11

## 安装

```bash
pnpm install
```

## 环境变量

复制 `.env.example` 为 `.env`，在其中填写本地环境变量：

```bash
cp .env.example .env
```

应用入口会通过 `dotenv` 自动加载 `.env`。`.env` 已被 Git 忽略，禁止提交密钥或 token。

`MOONSHOT_API_KEY` 是必填项；`MOONSHOT_BASE_URL` 可选，未设置时使用 Moonshot 默认地址。使用 `web_search` 时还需要配置 `TAVILY_API_KEY`。

## 会话记忆

Agent 使用 LangGraph `MemorySaver` 按 `threadId` 保存短期会话历史。CLI 在一次启动期间使用固定的会话 ID，因此后续提问可以引用前文；退出 CLI 或重启进程后历史会清空。

## 文件工具

Agent 可以读取或写入当前工作目录及其子目录中的 UTF-8 普通文件。文件工具拒绝绝对路径、`..` 越界、符号链接越界、`.env*` 和 `.git/`，避免模型读取或覆写敏感内容。`write_file` 会创建新文件或完整覆写已有文件，但不会创建缺失的父目录。

`exec` 只允许执行 `ls`、`find`、`rg`、`pwd` 和只读 Git 查询。它不解析 shell 语法，不接受任意命令，并限制单次执行 5 秒、输出 64 KB，避免模型执行删除或其他写入操作。

`run_js` 在 Node 权限模型子进程中执行 JavaScript。子进程不继承项目环境变量，且默认没有文件系统、网络、子进程或 worker 权限；单次执行限制 5 秒、代码 20 KB、输出 64 KB。

`web_search` 使用 Tavily 搜索当前网页信息，每次最多返回 3 条通用搜索结果，并附带 Tavily 生成的答案。查询内容会发送给 Tavily API，并消耗对应的 API 配额。

`current_time` 从本机读取当前日期、时间和时区，专门处理“今天”和“现在”问题。新闻、天气、价格和体育赛事等实时信息由 `web_search` 检索，Agent 会基于成功返回的结果作答。CLI 会显示工具的开始、完成或失败状态，便于区分模型未检索与检索失败。

`web_fetch` 只允许抓取公网 HTTP(S) 地址，拒绝本机和内网地址。请求限制为 10 秒、最多 3 次重定向和 1 MB 响应；为避免超出模型上下文，传给 Agent 的文本最多 8 KB。

## Skills

将 Agent Skills 格式的内置 skill 放入 `src/agent/skills/<skill-name>/SKILL.md`。启动时会发现所有有效 skill 的 `name` 和 `description` 并提供给模型；当任务匹配某个 skill 时，模型调用 `load_skill` 才会读取该 skill 的完整 `SKILL.md`。无效 frontmatter 会被跳过并在终端显示警告。

`pnpm build` 会先清理 `dist/`，仅编译运行时源码，再将所有 `SKILL.md` 复制到 `dist/agent/skills`，并恢复 CLI 入口的可执行权限。发布包只包含运行时构建产物和必要文档，因此全局安装后 `miniagent` 不依赖用户当前目录下的 `src/`。

## 常用命令

```bash
# 类型检查
pnpm typecheck

# 直接运行 TypeScript 入口
pnpm dev

# 运行单元测试
pnpm test

# 监听模式运行单元测试
pnpm test:watch

# 编译 TypeScript 到 dist/
pnpm build

# 执行构建后的 Agent CLI
pnpm start
```

`pnpm start` 执行 `dist/agent/cli.js`，首次运行或修改源码后需先执行 `pnpm build`。

## 全局命令

构建后通过 npm 链接将当前项目注册为本机 `miniagent` 命令：

```bash
pnpm build
npm link

miniagent
miniagent --help
miniagent --version
```

`miniagent` 的版本与描述直接读取 `package.json`。

## 测试约定

测试文件与源码放在同一目录，使用 `*.test.ts` 命名。Jest 会通过 `ts-jest` 直接执行 TypeScript 测试文件。

```text
src/
  index.ts
  index.test.ts
```
