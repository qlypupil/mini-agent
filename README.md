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

`MOONSHOT_API_KEY` 是必填项；`MOONSHOT_BASE_URL` 可选，未设置时使用 Moonshot 默认地址。

## 会话记忆

Agent 使用 LangGraph `MemorySaver` 按 `threadId` 保存短期会话历史。CLI 在一次启动期间使用固定的会话 ID，因此后续提问可以引用前文；退出 CLI 或重启进程后历史会清空。

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
