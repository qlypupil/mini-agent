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

	it('uses the interactive Context action selected for a bare /context command', async () => {
		const chooseContextAction = jest.fn().mockResolvedValue('summarize 1-4')
		const manageContext = jest.fn().mockResolvedValue('Context 已暂存')
		const write = jest.fn()

		await handleInteractiveCommand('/context', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			chooseContextAction,
			manageContext,
			write,
		})

		expect(chooseContextAction).toHaveBeenCalledTimes(1)
		expect(manageContext).toHaveBeenCalledWith('summarize 1-4')
		expect(write).toHaveBeenCalledWith('Context 已暂存')
	})

	it('cancels a bare /context menu without running a Context operation', async () => {
		const manageContext = jest.fn()
		const write = jest.fn()

		await handleInteractiveCommand('/context', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			chooseContextAction: jest.fn().mockResolvedValue(undefined),
			manageContext,
			write,
		})

		expect(manageContext).not.toHaveBeenCalled()
		expect(write).toHaveBeenCalledWith('已取消 Context 操作。')
	})

	it('falls back to Context help when no interactive menu is available', async () => {
		const manageContext = jest.fn().mockResolvedValue('Context 命令帮助')
		const write = jest.fn()

		await handleInteractiveCommand('/context', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			manageContext,
			write,
		})

		expect(manageContext).toHaveBeenCalledWith('')
		expect(write).toHaveBeenCalledWith('Context 命令帮助')
	})

	it('shows and switches the active model locally', async () => {
		const getCurrentModel = jest.fn().mockReturnValue('kimi (kimi-k2.6)')
		const switchModel = jest
			.fn<string, [string]>()
			.mockReturnValue('deepseek (deepseek-v4-flash)')
		const write = jest.fn()
		const context = {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			getCurrentModel,
			switchModel,
			write,
		}

		await handleInteractiveCommand('/model', context)
		await handleInteractiveCommand('/model deepseek', context)

		expect(getCurrentModel).toHaveBeenCalledTimes(1)
		expect(switchModel).toHaveBeenCalledWith('deepseek')
		expect(write).toHaveBeenNthCalledWith(
			1,
			'当前模型: kimi (kimi-k2.6)\n可选模型: kimi, deepseek\n切换用法: /model <kimi|deepseek>',
		)
		expect(write).toHaveBeenNthCalledWith(
			2,
			'已切换模型: deepseek (deepseek-v4-flash)',
		)
	})

	it('switches to the model selected from a bare /model menu', async () => {
		const switchModel = jest
			.fn<string, [string]>()
			.mockReturnValue('deepseek (deepseek-v4-flash)')
		const write = jest.fn()

		await handleInteractiveCommand('/model', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			getCurrentModel: jest.fn(),
			chooseModel: jest.fn().mockResolvedValue('deepseek'),
			switchModel,
			write,
		})

		expect(switchModel).toHaveBeenCalledWith('deepseek')
		expect(write).toHaveBeenCalledWith(
			'已切换模型: deepseek (deepseek-v4-flash)',
		)
	})

	it('cancels a bare /model menu without changing the active model', async () => {
		const switchModel = jest.fn()
		const write = jest.fn()

		await handleInteractiveCommand('/model', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			getCurrentModel: jest.fn(),
			chooseModel: jest.fn().mockResolvedValue(undefined),
			switchModel,
			write,
		})

		expect(switchModel).not.toHaveBeenCalled()
		expect(write).toHaveBeenCalledWith('已取消模型切换。')
	})

	it('keeps the current model when switching fails', async () => {
		const switchModel = jest.fn(() => {
			throw new Error('DEEPSEEK_API_KEY is not set')
		})
		const write = jest.fn()

		await handleInteractiveCommand('/model deepseek', {
			startNewSession: jest.fn(),
			listSessions: jest.fn(),
			rewindSession: jest.fn(),
			getCurrentModel: jest.fn(),
			switchModel,
			write,
		})

		expect(write).toHaveBeenCalledWith(
			'模型切换失败: DEEPSEEK_API_KEY is not set',
		)
	})
})
