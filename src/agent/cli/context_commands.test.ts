import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ContextSessionManager } from './context_commands'

function createHarness() {
	let threadId = 'thread-1'
	const messages = [
		new HumanMessage({ id: 'human-1', content: '你好' }),
		new AIMessage({ id: 'ai-1', content: '你好' }),
		new HumanMessage({ id: 'human-2', content: '制定计划' }),
		new AIMessage({ id: 'ai-2', content: '计划内容' }),
	]
	const persistPatch = jest.fn<Promise<void>, [string, any]>().mockResolvedValue()
	const seedSession = jest.fn<Promise<void>, [string, BaseMessage[]]>().mockResolvedValue()
	const manager = new ContextSessionManager({
		getThreadId: () => threadId,
		setThreadId: (nextThreadId) => {
			threadId = nextThreadId
		},
		getMessages: jest.fn().mockResolvedValue(messages),
		persistPatch,
		seedSession,
		summarize: jest.fn().mockResolvedValue('摘要内容'),
		readSummaryFile: jest.fn().mockResolvedValue('文件摘要'),
		createThreadId: () => 'fork-thread',
	})

	return { manager, persistPatch, seedSession, getThreadId: () => threadId }
}

describe('ContextSessionManager', () => {
	it('stages, previews, and consumes a one-shot replacement', async () => {
		const { manager } = createHarness()

		await expect(manager.handle('replace 1 Hello')).resolves.toContain('已暂存')
		await expect(manager.handle('preview')).resolves.toContain('Hello')
		await expect(manager.handle('apply once')).resolves.toContain('下一轮请求')

		const control = manager.takeNextContextControl('thread-1')
		expect(control).toEqual({
			mode: 'once',
			patch: {
				operations: [
					{ type: 'replace', messageId: 'human-1', content: 'Hello' },
				],
			},
		})
		expect(manager.takeNextContextControl('thread-1')).toBeUndefined()
	})

	it('applies a persistent summary without waiting for another chat request', async () => {
		const { manager, persistPatch } = createHarness()

		await manager.handle('summarize 1-2')
		await expect(manager.handle('apply persist')).resolves.toBe(
			'Context 修改已永久写入当前会话。',
		)

		expect(persistPatch).toHaveBeenCalledWith('thread-1', {
			operations: [
				{
					type: 'replaceRange',
					messageIds: ['human-1', 'ai-1'],
					summary: '摘要内容',
				},
			],
		})
	})

	it('forks the edited history into a new thread', async () => {
		const { manager, seedSession, getThreadId } = createHarness()

		await manager.handle('remove 1-2')
		await expect(manager.handle('apply fork')).resolves.toContain('fork-thread')

		expect(seedSession).toHaveBeenCalledWith(
			'fork-thread',
			expect.arrayContaining([
				expect.objectContaining({ id: 'human-2' }),
				expect.objectContaining({ id: 'ai-2' }),
			]),
		)
		expect(getThreadId()).toBe('fork-thread')
	})

	it('loads a plain-text summary and reports malformed commands', async () => {
		const { manager } = createHarness()

		await expect(
			manager.handle('load-summary 1-2 summaries/context.txt'),
		).resolves.toContain('已暂存')
		await expect(manager.handle('replace')).rejects.toThrow('Context 命令:')
	})
})
