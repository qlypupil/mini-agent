import {
	createInteractiveCommandHandler,
	handleInteractiveCommand,
	parseInteractiveCommand,
} from './interactive_command'

describe('parseInteractiveCommand', () => {
	it('keeps both tokenized and raw arguments for future command syntaxes', () => {
		expect(parseInteractiveCommand(' /rewind thread-123 --force ')).toEqual({
			name: 'rewind',
			args: ['thread-123', '--force'],
			rawArgs: 'thread-123 --force',
		})
	})

	it('returns undefined for regular chat input', () => {
		expect(parseInteractiveCommand('hello')).toBeUndefined()
	})
})

describe('handleInteractiveCommand', () => {
	it('starts a new session for /new without forwarding the input to the Agent', async () => {
		const startNewSession = jest.fn()
		const write = jest.fn()

		const handled = await handleInteractiveCommand('/new', {
			startNewSession,
			write,
		})

		expect(handled).toBe(true)
		expect(startNewSession).toHaveBeenCalledTimes(1)
		expect(write).toHaveBeenCalledWith('已开启新会话。')
	})

	it('keeps regular chat input available for the Agent', async () => {
		const handled = await handleInteractiveCommand('who are you', {
			startNewSession: jest.fn(),
			write: jest.fn(),
		})

		expect(handled).toBe(false)
	})

	it('reports malformed and unknown commands locally', async () => {
		const write = jest.fn()
		const context = { startNewSession: jest.fn(), write }

		await handleInteractiveCommand('/new unexpected', context)
		await handleInteractiveCommand('/sessions', context)

		expect(context.startNewSession).not.toHaveBeenCalled()
		expect(write).toHaveBeenNthCalledWith(1, '用法: /new')
		expect(write).toHaveBeenNthCalledWith(2, '未知命令: /sessions')
	})

	it('allows future commands to define their own argument syntax', async () => {
		const commandHandler = createInteractiveCommandHandler({
			skill: (command, context) => {
				context.write(`skill=${command.rawArgs}`)
			},
		})
		const write = jest.fn()

		await commandHandler('/skill planner daily plan', {
			startNewSession: jest.fn(),
			write,
		})

		expect(write).toHaveBeenCalledWith('skill=planner daily plan')
	})
})
