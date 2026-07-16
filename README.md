# mini-agent

基于 TypeScript 的 Node.js 项目骨架，使用 pnpm 管理依赖，并通过 Jest 执行单元测试。

## 环境要求

- Node.js 24 或更高版本
- pnpm 11

## 安装

```bash
pnpm install
```

## 常用命令

```bash
# 类型检查
pnpm typecheck

# 运行单元测试
pnpm test

# 监听模式运行单元测试
pnpm test:watch

# 编译 TypeScript 到 dist/
pnpm build
```

## 测试约定

测试文件与源码放在同一目录，使用 `*.test.ts` 命名。Jest 会通过 `ts-jest` 直接执行 TypeScript 测试文件。

```text
src/
  index.ts
  index.test.ts
```
