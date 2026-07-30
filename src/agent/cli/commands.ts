import { type ContextCompressionResult } from '../runtime/context'

export interface InteractiveCommand {
	name: string
	args: string[]
	rawArgs: string
}

export interface InteractiveCommandContext {
	startNewSession: () => void
	listSessions: () => Promise<string>
	rewindSession: (threadId: string) => Promise<boolean>
	manageContext?: (rawArgs: string) => Promise<string>
	chooseContextAction?: () => Promise<string | undefined>
	getCurrentModel?: () => string
	chooseModel?: () => Promise<string | undefined>
	switchModel?: (model: string) => string
	compressContext?: () => Promise<ContextCompressionResult>
	write: (message: string) => void
}

export type InteractiveCommandHandler = (
	command: InteractiveCommand,
	context: InteractiveCommandContext,
) => void | Promise<void>

// 解析结果同时保留分词参数和原始参数，方便后续命令按自己的语法处理参数。
export function parseInteractiveCommand(input: string): InteractiveCommand | undefined {
	const trimmedInput = input.trim()
	if (!trimmedInput.startsWith('/')) return undefined

	const [name = '', ...args] = trimmedInput.slice(1).split(/\s+/)
	return {
		name: name.toLowerCase(),
		args,
		rawArgs: trimmedInput.slice(name.length + 1).trim(),
	}
}

export function createInteractiveCommandHandler(
	commands: Record<string, InteractiveCommandHandler>,
): (
	input: string,
	context: InteractiveCommandContext,
) => Promise<boolean> {
	return async (input, context) => {
		const command = parseInteractiveCommand(input)
		if (!command) return false

		if (!command.name) {
			context.write('命令不能为空。')
			return true
		}

		const handler = commands[command.name]
		if (!handler) {
			context.write(`未知命令: /${command.name}`)
			return true
		}

		await handler(command, context)
		return true
	}
}

const commands: Record<string, InteractiveCommandHandler> = {
	new: (command, context) => {
		if (command.args.length > 0) {
			context.write('用法: /new')
			return
		}

		context.startNewSession()
		context.write('已开启新会话。')
	},
	sessions: async (command, context) => {
		if (command.args.length > 0) {
			context.write('用法: /sessions')
			return
		}

		try {
			context.write(await context.listSessions())
		} catch (error) {
			context.write(`读取会话失败: ${(error as Error).message}`)
		}
	},
	rewind: async (command, context) => {
		if (command.args.length !== 1) {
			context.write('用法: /rewind <thread_id>')
			return
		}

		const [threadId] = command.args
		try {
			if (!await context.rewindSession(threadId)) {
				context.write(`未找到会话: ${threadId}`)
				return
			}

			context.write(`已恢复会话: ${threadId}`)
		} catch (error) {
			context.write(`恢复会话失败: ${(error as Error).message}`)
		}
	},
	context: async (command, context) => {
		if (!context.manageContext) {
			context.write('当前环境不支持 Context 管理。')
			return
		}

		try {
			let rawArgs = command.rawArgs
			if (!rawArgs && context.chooseContextAction) {
				const selectedAction = await context.chooseContextAction()
				if (!selectedAction) {
					context.write('已取消 Context 操作。')
					return
				}
				rawArgs = selectedAction
			}

			context.write(await context.manageContext(rawArgs))
		} catch (error) {
			context.write(`Context 操作失败: ${(error as Error).message}`)
		}
	},
	model: async (command, context) => {
		if (!context.getCurrentModel || !context.switchModel) {
			context.write('当前环境不支持模型切换。')
			return
		}

		if (command.args.length === 0) {
			if (context.chooseModel) {
				try {
					const selectedModel = await context.chooseModel()
					if (!selectedModel) {
						context.write('已取消模型切换。')
						return
					}
					context.write(`已切换模型: ${context.switchModel(selectedModel)}`)
				} catch (error) {
					context.write(`模型切换失败: ${(error as Error).message}`)
				}
				return
			}

			context.write(
				`当前模型: ${context.getCurrentModel()}\n可选模型: kimi, deepseek\n切换用法: /model <kimi|deepseek>`,
			)
			return
		}

		if (command.args.length !== 1) {
			context.write('用法: /model <kimi|deepseek>')
			return
		}

		try {
			context.write(`已切换模型: ${context.switchModel(command.args[0])}`)
		} catch (error) {
			context.write(`模型切换失败: ${(error as Error).message}`)
		}
	},
	compact: async (command, context) => {
		if (command.args.length > 0) {
			context.write('用法: /compact')
			return
		}

		if (!context.compressContext) {
			context.write('当前环境不支持 Context 压缩。')
			return
		}

		try {
			context.write('正在压缩 Context...')
			const result = await context.compressContext()
			if (!result.compressed) {
				context.write(
					`当前没有新的可压缩历史，已保留最近 ${result.retainedMessageCount} 条消息。`,
				)
				return
			}

			context.write(
				`Context 压缩完成：本次压缩 ${result.newlyCompressedMessageCount} 条消息，保留最近 ${result.retainedMessageCount} 条消息，累计压缩 ${result.compressionCount} 次。\n压缩结果将在下一轮对话中使用，SQLite 原始聊天记录未修改。`,
			)
			if (result.compressionCount >= 3) {
				context.write('强烈建议输入 /new 命令开启新会话。')
			}
		} catch (error) {
			context.write(`Context 压缩失败: ${(error as Error).message}`)
		}
	},
}

// 返回 true 表示输入已作为本地命令处理，调用方不应再将它发送给 AI。
export const handleInteractiveCommand = createInteractiveCommandHandler(commands)
