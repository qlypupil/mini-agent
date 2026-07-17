#!/usr/bin/env node

import * as readline from 'readline'
import { runAgentStream } from './agent'
import { createProgram } from './command'

// 固定 ID 让 MemorySaver 在本次 CLI 进程中续接每一轮消息。
// 退出 CLI 后内存清空，下一次启动会开始新的会话。
const THREAD_ID = 'user-session-1'

// readline 将终端标准输入和输出封装为可交互的行级读写接口。
function createInterface(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})
}

const rl = createInterface()

function listenForEscape(controller: AbortController): () => void {
	if (!process.stdin.isTTY) {
		return () => {}
	}

	readline.emitKeypressEvents(process.stdin)
	process.stdin.setRawMode(true)

	const onKeypress = (_character: string, key: { name?: string }) => {
		if (key.name === 'escape') {
			controller.abort()
		}
	}

	process.stdin.on('keypress', onKeypress)

	return () => {
		process.stdin.off('keypress', onKeypress)
		process.stdin.setRawMode(false)
	}
}

// 将 readline 基于回调的 question API 包装为 Promise，方便在 while 循环中使用 await。
function prompt(question: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			resolve(answer)
		})
	})
}

async function chat(userInput: string): Promise<void> {
	// write 不自动换行，使每个流式 token 能连续显示。
	process.stdout.write('\nAI: ')

	const controller = new AbortController()
	const stopListening = listenForEscape(controller)

	try {
		await runAgentStream(
			userInput,
			(token: string) => {
				process.stdout.write(token)
			},
			THREAD_ID,
			controller.signal,
		)
		process.stdout.write('\n\n')
	} catch (error) {
		if (controller.signal.aborted) {
			process.stdout.write('\n\n已取消当前请求。\n\n')
			return
		}
		throw error
	} finally {
		stopListening()
	}
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

void createProgram(main).parseAsync(process.argv)
