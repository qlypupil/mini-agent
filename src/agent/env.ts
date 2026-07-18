import * as dotenv from 'dotenv'

// 所有 Agent 模块经此处一次性加载 .env，避免工具初始化早于环境变量或重复输出 dotenv 日志。
dotenv.config({ quiet: true })
