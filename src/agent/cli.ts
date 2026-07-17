import * as readline from 'readline'
import { runAgentStream } from './agent'

// 当前 Agent 未配置 checkpointer；固定 ID 仅传递给本次运行配置，
// 不会自动保存或恢复历史消息。
const THREAD_ID = 'user-session-1'

// readline 将终端标准输入和输出封装为可交互的行级读写接口。
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

// 将 readline 基于回调的 question API 包装为 Promise，方便在 while 循环中使用 await。
function prompt(question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer)
		})
	})
}

async function chat(userInput: string): Promise<void> {
	// 流式输出期间暂停读取用户输入，避免新输入与模型 token 交错在同一终端行。
	rl.pause()

	// write 不自动换行，使每个流式 token 能连续显示。
	process.stdout.write('\nAI: ')

	await runAgentStream(
		userInput,
		(token: string) => {
			process.stdout.write(token)
		},
		THREAD_ID,
	)

	process.stdout.write('\n\n')

	// 当前回复结束后恢复终端输入，等待下一轮提问。
	rl.resume()
}

async function main(): Promise<void> {
	console.log('=== Agent 聊天控制台 (输入 "exit" 退出) ===\n')

	while (true) {
		// prompt 会等待用户提交一整行输入，不会阻塞 Node.js 的事件循环。
		const userInput = await prompt('You: ')

		if (!userInput.trim()) continue
		if (userInput.toLowerCase() === 'exit') {
			console.log('再见！')
			// 关闭底层标准输入监听，允许 Node.js 正常退出。
			rl.close()
			break
		}

		try {
			await chat(userInput)
		} catch (err) {
			console.error('请求出错:', (err as Error).message)
		}
	}
}

main()
