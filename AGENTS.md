# 项目规范

- 使用 `pnpm` 管理依赖，禁止生成或提交 `package-lock.json`、`yarn.lock`。
- 源码放在 `src/`，单元测试与源码同目录，命名为 `*.test.ts`。
- 改动 TypeScript 代码后，至少运行 `pnpm typecheck` 与 `pnpm test`。
- 依赖变动后提交 `pnpm-lock.yaml`。
- 已验证的开发进度更新到 `ROADMAP.md`。
