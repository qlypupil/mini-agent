# Roadmap

## 当前阶段

项目初始化完成，等待业务功能定义。

## 已完成

- 建立 pnpm、TypeScript 与 Jest 基础开发环境。
- 配置类型检查、构建和单元测试脚本。
- 将 TypeScript 模块解析策略迁移至 `NodeNext`。
- 将 TypeScript 升级至 6.0.3，并显式加载 Jest 测试类型。
- 接入 dotenv，并提供 `.env.example` 本地环境变量模板。
- 接入 ts-node 开发启动脚本与 zod 运行时校验依赖。
- 修正 LangChain 工具定义的 `schema` 字段兼容性。
- 补充 Agent CLI 的交互流程与 readline 使用注释。
- 配置构建后的 Agent CLI 启动脚本。
- 支持通过环境变量配置 Moonshot API Base URL。

## 进行中

- 无。

## 待办

- 待确认首个业务功能范围。

## 阻塞

- 无。

## 最近验证

- `pnpm typecheck`、`pnpm build` 与 `pnpm start` 通过。
- 构建产物已完成 Moonshot 集成测试：`hi` 与 `who are you` 均收到正常流式回复。
- `pnpm typecheck`、`pnpm test --runInBand` 与 `pnpm build` 通过。
