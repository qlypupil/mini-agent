#!/usr/bin/env node

import * as readline from 'readline'
import { randomUUID } from 'node:crypto'
import chalk from 'chalk'
import { Command } from 'commander'
import {
	compressChatContextIfNeeded,
	compressContext,
	describeModel,
	ensureModelConfigured,
	getChatMessages,
	persistContextPatch,
	runAgentStream,
	seedChatSession,
	summarizeMessages,
} from './agent'
import { printStartupBanner } from './cli/banner'
import { ContextSessionManager } from './cli/context_commands'
import { handleInteractiveCommand } from './cli/commands'
import { selectMenu, type SelectMenuOption } from './cli/select_menu'
import {
	formatToolApprovalRequest,
	parseToolApprovalAnswer,
} from './cli/tool_confirmation'
import { formatContextUsage } from './runtime/context_usage'
import type { ToolApprovalRequest } from './runtime/graph'
import {
	getDefaultModelProvider,
	getModelMetadata,
	MODEL_PROVIDERS,
	resolveModelProvider,
	type ModelProvider,
} from './runtime/models'
import {
	formatSessionsTable,
	hasChatSession,
	listRecentChatSessions,
} from './storage/sessions'
import { readFileTool } from './tools/read_file_tool'

// CLI 的版本与描述始终跟随 package.json，避免在命令代码中重复维护元信息。
const packageMetadata = require('../../package.json') as {
	version: string
	description: string
}

// 每次 CLI 启动创建独立会话，避免 SQLite 中的历史消息混入新的终端对话。
let threadId: string = randomUUID()
let modelProvider: ModelProvider = getDefaultModelProvider()

const contextSession = new ContextSessionManager({
	getThreadId: () => threadId,
	setThreadId: (nextThreadId) => {
		threadId = nextThreadId
	},
	getMessages: getChatMessages,
	persistPatch: persistContextPatch,
	seedSession: seedChatSession,
	summarize: (messages) => summarizeMessages(messages, modelProvider),
	readSummaryFile: readFileTool,
})

const youLabel = () => chalk.green.bold('You: ')
const aiLabel = () => chalk.blue.bold('AI: ')

// readline 将终端标准输入和输出封装为可交互的行级读写接口。
function createInterface(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	})
}

let rl = createInterface()

let activeController: AbortController | undefined
let inputClosed = false
let stopKeyboardControls = () => {}

function handleInputClose(): void {
	inputClosed = true
	stopKeyboardControls()
}

function attachInputCloseHandler(): void {
	rl.once('close', handleInputClose)
}

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
function prompt(question: string, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!signal) {
			rl.question(question, resolve)
			return
		}

		signal.throwIfAborted()
		const onAbort = () => {
			reject(signal.reason ?? new Error('The prompt was aborted.'))
		}
		signal.addEventListener('abort', onAbort, { once: true })
		rl.question(question, { signal }, (answer) => {
			signal.removeEventListener('abort', onAbort)
			resolve(answer)
		})
	})
}

async function confirmToolCall(
	request: ToolApprovalRequest,
	signal: AbortSignal,
): Promise<boolean> {
	process.stdout.write(`${chalk.yellow(formatToolApprovalRequest(request))}\n`)

	while (true) {
		const answer = parseToolApprovalAnswer(
			await prompt(chalk.yellow('允许调用此 Tool？[y/N]：'), signal),
		)
		if (answer === 'approve') return true
		if (answer === 'reject') return false
		process.stdout.write(chalk.yellow('请输入 y/yes 或 n/no。\n'))
	}
}

async function showSelectMenu<T extends string>(
	title: string,
	options: SelectMenuOption<T>[],
	initialIndex = 0,
): Promise<T | undefined> {
	// readline 自己会消费方向键；菜单期间临时关闭，完成后再恢复行输入。
	rl.off('close', handleInputClose)
	rl.close()

	try {
		return await selectMenu(title, options, initialIndex)
	} finally {
		if (!inputClosed) {
			rl = createInterface()
			attachInputCloseHandler()
		}
	}
}

async function chooseModel(): Promise<string | undefined> {
	const options = MODEL_PROVIDERS.map((provider) => {
		const metadata = getModelMetadata(provider)
		return {
			value: provider,
			label: `${provider === 'kimi' ? 'Kimi' : 'DeepSeek'}  ${metadata.model}${provider === modelProvider ? '（当前）' : ''}`,
		}
	})

	return showSelectMenu(
		'选择模型：',
		options,
		MODEL_PROVIDERS.indexOf(modelProvider),
	)
}

async function promptRequired(question: string): Promise<string | undefined> {
	const answer = (await prompt(chalk.green(question))).trim()
	return answer || undefined
}

async function chooseContextAction(): Promise<string | undefined> {
	const action = await showSelectMenu('选择 Context 操作：', [
		{ label: '查看当前记录', value: 'show' },
		{ label: '预览暂存修改', value: 'preview' },
		{ label: '压缩指定记录', value: 'summarize' },
		{ label: '替换指定记录', value: 'replace' },
		{ label: '删除指定记录', value: 'remove' },
		{ label: '载入摘要文件', value: 'load-summary' },
		{ label: '应用暂存修改', value: 'apply' },
		{ label: '清除暂存修改', value: 'cancel' },
		{ label: '返回', value: 'back' },
	])

	if (!action || action === 'back') return undefined
	if (['show', 'preview', 'cancel'].includes(action)) return action

	if (action === 'apply') {
		const mode = await showSelectMenu('选择应用方式：', [
			{ label: '仅下一轮请求', value: 'once' },
			{ label: '永久写入当前会话', value: 'persist' },
			{ label: '创建分支会话', value: 'fork' },
			{ label: '返回', value: 'back' },
		])
		return !mode || mode === 'back' ? undefined : `apply ${mode}`
	}

	const selector = await promptRequired(
		action === 'replace'
			? '输入要替换的记录序号：'
			: '输入记录序号或范围（例如 1-6）：',
	)
	if (!selector) return undefined

	if (action === 'summarize' || action === 'remove') {
		return `${action} ${selector}`
	}

	const detail = await promptRequired(
		action === 'replace' ? '输入替换后的内容：' : '输入摘要文件路径：',
	)
	return detail ? `${action} ${selector} ${detail}` : undefined
}

async function chat(userInput: string): Promise<void> {
	let responseStarted = false
	let toolLogLineReady = true
	process.stdout.write('\n')

	// 每轮请求独享控制器，避免 ESC 取消到下一轮对话。
	const controller = new AbortController()
	activeController = controller
	const requestThreadId = threadId
	const requestModelProvider = modelProvider
	const contextControl = contextSession.peekNextContextControl(requestThreadId)

	try {
		const result = await runAgentStream(
			userInput,
			(token: string) => {
				// 只有首个用户可见正文 token 到达时才显示 AI 标签。
				if (!responseStarted) {
					process.stdout.write(aiLabel())
					responseStarted = true
				}
				process.stdout.write(token)
				toolLogLineReady = false
			},
			requestThreadId,
			controller.signal,
			(event) => {
				if (event.status === 'started') {
					// 正文之后发生 Tool 调用时，先结束当前行再由 Graph 打印 Tool 名称。
					if (!toolLogLineReady) {
						process.stdout.write('\n')
						toolLogLineReady = true
					}
					return
				}

				if (event.status === 'rejected') {
					const separator = toolLogLineReady ? '' : '\n'
					process.stdout.write(
						`${separator}${chalk.yellow(`[Tool] ${event.name} rejected`)}\n`,
					)
					toolLogLineReady = true
					return
				}

				if (event.status === 'failed') {
					const detail = event.error
						? chalk.red.dim(`: ${event.error.slice(0, 200)}`)
						: ''
					const separator = toolLogLineReady ? '' : '\n'
					process.stdout.write(
						`${separator}${chalk.red(`[Tool] ${event.name} failed`)}${detail}\n`,
					)
					toolLogLineReady = true
					return
				}
			},
			contextControl,
			requestModelProvider,
			async (request) => {
				if (!toolLogLineReady) {
					process.stdout.write('\n')
				}
				toolLogLineReady = true
				return confirmToolCall(request, controller.signal)
			},
		)
		if (contextControl) {
			contextSession.completeNextContextControl(requestThreadId)
		}
		process.stdout.write(
			`\n${chalk.gray(formatContextUsage(result.contextUsage))}\n\n`,
		)
		const automaticCompression = await compressChatContextIfNeeded(
			requestThreadId,
			result.contextUsage,
			requestModelProvider,
			{
				onStart: () => {
					process.stdout.write(
						`${chalk.yellow('警告：Context window 接近大模型接口上限，正在自动压缩 Context，可能会丢失信息。')}\n`,
					)
				},
			},
		)

		if (automaticCompression.status === 'failed') {
			process.stdout.write(
				`${chalk.red(`Context 自动压缩失败：${automaticCompression.error}`)}\n${chalk.yellow('原始聊天记录未修改，下轮达到阈值时将重试压缩。')}\n\n`,
			)
		} else if (automaticCompression.status === 'completed') {
			const { compression } = automaticCompression
			if (compression.compressed) {
				process.stdout.write(
					`${chalk.green(`Context 压缩完成：本次压缩 ${compression.newlyCompressedMessageCount} 条消息，保留最近 ${compression.retainedMessageCount} 条消息，累计压缩 ${compression.compressionCount} 次。`)}\n${chalk.gray('压缩结果将在下一轮对话中使用，SQLite 原始聊天记录未修改。')}\n`,
				)
			} else {
				process.stdout.write(
					`${chalk.yellow(`当前没有新的可压缩历史，已保留最近 ${compression.retainedMessageCount} 条消息。`)}\n`,
				)
			}

			if (compression.compressionCount >= 3 || !compression.compressed) {
				process.stdout.write(
					`${chalk.red.bold('强烈建议输入 /new 命令开启新会话。')}\n`,
				)
			}
			process.stdout.write('\n')
		}
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
	stopKeyboardControls = setupKeyboardControls()
	attachInputCloseHandler()

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

		const commandHandled = await handleInteractiveCommand(userInput, {
			startNewSession: () => {
				contextSession.clear()
				threadId = randomUUID()
			},
			listSessions: async () => formatSessionsTable(await listRecentChatSessions()),
			rewindSession: async (targetThreadId) => {
				if (!await hasChatSession(targetThreadId)) return false

				contextSession.clear()
				threadId = targetThreadId
				return true
			},
			manageContext: (rawArgs) => contextSession.handle(rawArgs),
			chooseContextAction: process.stdin.isTTY ? chooseContextAction : undefined,
			compressContext: () => compressContext(threadId, modelProvider),
			getCurrentModel: () => describeModel(modelProvider),
			chooseModel: process.stdin.isTTY ? chooseModel : undefined,
			switchModel: (value) => {
				const nextProvider = resolveModelProvider(value)
				ensureModelConfigured(nextProvider)
				modelProvider = nextProvider
				return describeModel(nextProvider)
			},
			write: (message) => {
				console.log(chalk.cyan(message))
			},
		})
		if (commandHandled) continue

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

// 默认 action 保持无参数运行 termclaw 时直接进入交互聊天。
void new Command()
	.name('termclaw')
	.description(packageMetadata.description)
	.version(packageMetadata.version)
	.action(main)
	.parseAsync(process.argv)
