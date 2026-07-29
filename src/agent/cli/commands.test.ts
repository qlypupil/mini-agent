import {
	createInteractiveCommandHandler,
	handleInteractiveCommand,
	parseInteractiveCommand,
} from './commands'

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
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			write,
		})

		expect(handled).toBe(true)
		expect(startNewSession).toHaveBeenCalledTimes(1)
		expect(write).toHaveBeenCalledWith('已开启新会话。')
	})

	it('keeps regular chat input available for the Agent', async () => {
		const handled = await handleInteractiveCommand('who are you', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			write: jest.fn(),
		})

		expect(handled).toBe(false)
	})

	it('reports malformed and unknown commands locally', async () => {
		const write = jest.fn()
		const context = {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			write,
		}

		await handleInteractiveCommand('/new unexpected', context)
		await handleInteractiveCommand('/unknown', context)

		expect(context.startNewSession).not.toHaveBeenCalled()
		expect(write).toHaveBeenNthCalledWith(1, '用法: /new')
		expect(write).toHaveBeenNthCalledWith(2, '未知命令: /unknown')
	})

	it('lists sessions locally without forwarding the command to the Agent', async () => {
		const listSessions = jest.fn().mockResolvedValue('会话列表')
		const write = jest.fn()

		const handled = await handleInteractiveCommand('/sessions', {
			startNewSession: jest.fn(),
			listSessions,
			rewindSession: jest.fn(),
			write,
		})

		expect(handled).toBe(true)
		expect(listSessions).toHaveBeenCalledTimes(1)
		expect(write).toHaveBeenCalledWith('会话列表')
	})

	it('restores an existing session and rejects an unknown thread locally', async () => {
		const rewindSession = jest
			.fn<Promise<boolean>, [string]>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false)
		const write = jest.fn()
		const context = {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession,
			write,
		}

		await handleInteractiveCommand('/rewind existing-thread', context)
		await handleInteractiveCommand('/rewind missing-thread', context)

		expect(rewindSession).toHaveBeenNthCalledWith(1, 'existing-thread')
		expect(rewindSession).toHaveBeenNthCalledWith(2, 'missing-thread')
		expect(write).toHaveBeenNthCalledWith(1, '已恢复会话: existing-thread')
		expect(write).toHaveBeenNthCalledWith(2, '未找到会话: missing-thread')
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
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			write,
		})

		expect(write).toHaveBeenCalledWith('skill=planner daily plan')
	})

	it('handles /context locally and preserves its raw arguments', async () => {
		const manageContext = jest.fn().mockResolvedValue('Context 已更新')
		const write = jest.fn()

		const handled = await handleInteractiveCommand(
			'/context replace 2 translated English text',
			{
				startNewSession: jest.fn(),
				listSessions: jest.fn(),
				rewindSession: jest.fn(),
				manageContext,
				write,
			},
		)

		expect(handled).toBe(true)
		expect(manageContext).toHaveBeenCalledWith(
			'replace 2 translated English text',
		)
		expect(write).toHaveBeenCalledWith('Context 已更新')
	})
})
