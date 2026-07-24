#!/usr/bin/env node

import * as readline from 'readline'
import chalk from 'chalk'
import { runAgentStream } from './agent'
import { printStartupBanner } from './banner'
import { createProgram } from './command'

// 固定 ID 让 SQLite checkpointer 在同一目录的多次 CLI 启动间续接会话。
const THREAD_ID = 'user-session-1'

const youLabel = () => chalk.green.bold('You: ')
const aiLabel = () => chalk.blue.bold('AI: ')

// readline 将终端标准输入和输出封装为可交互的行级读写接口。
function createInterface(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})
}

const rl = createInterface()

let activeController: AbortController | undefined
let inputClosed = false

// 整个 CLI 生命周期内保持 raw mode，避免在 readline 回调期间切换模式而重复回显输入。
function setupKeyboardControls(): () => void {
	if (!process.stdin.isTTY) {
		return () => {}
	}

	readline.emitKeypressEvents(process.stdin)
	const wasRaw = process.stdin.isRaw
	process.stdin.setRawMode(true)

	const onKeypress = (_character: string, key: { name?: string }) => {
		if (key.name === 'escape' && activeController) {
			activeController.abort()
		}
	}

	process.stdin.on('keypress', onKeypress)

	return () => {
		process.stdin.off('keypress', onKeypress)
		process.stdin.setRawMode(wasRaw)
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
	// write 不自动换行，使每个流式 token 能连续显示；AI 正文保持默认颜色。
	process.stdout.write(`\n${aiLabel()}`)

	// 每轮请求独享控制器，避免 ESC 取消到下一轮对话。
	const controller = new AbortController()
	activeController = controller

	try {
		await runAgentStream(
			userInput,
			(token: string) => {
				process.stdout.write(token)
			},
			THREAD_ID,
			controller.signal,
			(event) => {
				if (event.status === 'started') {
					process.stdout.write(
						`\n${chalk.yellow.dim(`[Tool] ${event.name} started.`)}\n`,
					)
					return
				}

				if (event.status === 'failed') {
					const detail = event.error
						? chalk.red.dim(`: ${event.error.slice(0, 200)}`)
						: ''
					process.stdout.write(
						`\n${chalk.red(`[Tool] ${event.name} failed`)}${detail}\n\n${aiLabel()}`,
					)
					return
				}

				process.stdout.write(
					`\n${chalk.green.dim(`[Tool] ${event.name} completed.`)}\n\n${aiLabel()}`,
				)
			},
		)
		process.stdout.write('\n\n')
	} catch (error) {
		if (controller.signal.aborted) {
			process.stdout.write(`\n\n${chalk.yellow('已取消当前请求。')}\n\n`)
			return
		}
		throw error
	} finally {
		if (activeController === controller) {
			activeController = undefined
		}
	}
}

async function main(): Promise<void> {
	const stopKeyboardControls = setupKeyboardControls()
	rl.once('close', () => {
		inputClosed = true
		stopKeyboardControls()
	})

	printStartupBanner()

	while (!inputClosed) {
		// prompt 会等待用户提交一整行输入，不会阻塞 Node.js 的事件循环。
		const userInput = await prompt(youLabel())
		if (inputClosed) break

		if (!userInput.trim()) continue
		if (userInput.toLowerCase() === 'exit') {
			console.log(chalk.cyan.dim('再见！'))
			// 关闭底层标准输入监听，允许 Node.js 正常退出。
			rl.close()
			break
		}

		try {
			await chat(userInput)
		} catch (err) {
			console.error(
				chalk.red('请求出错:'),
				chalk.red.dim((err as Error).message),
			)
		}
	}
}

void createProgram(main).parseAsync(process.argv)
