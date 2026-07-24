export interface InteractiveCommand {
	name: string
	args: string[]
	rawArgs: string
}

export interface InteractiveCommandContext {
	startNewSession: () => void
	listSessions: () => Promise<string>
	rewindSession: (threadId: string) => Promise<boolean>
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
}

// 返回 true 表示输入已作为本地命令处理，调用方不应再将它发送给 AI。
export const handleInteractiveCommand = createInteractiveCommandHandler(commands)
