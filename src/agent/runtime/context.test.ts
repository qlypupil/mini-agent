import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	ToolMessage,
} from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import {
	applyContextCompression,
	compressContextMessages,
	MAX_MODEL_CONTEXT_MESSAGES,
	simplifyHistoricalToolMessages,
	summarizeContextMessages,
	trimModelContextMessages,
	type ContextCompression,
} from './context'

function createMessages(count: number): BaseMessage[] {
	return Array.from({ length: count }, (_, index) => {
		const fields = { id: `message-${index + 1}`, content: `content-${index + 1}` }
		return index % 2 === 0 ? new HumanMessage(fields) : new AIMessage(fields)
	})
}

function createToolMessages(
	index: number,
	toolName = `tool_${index}`,
	includeToolMessageName = true,
): [AIMessage, ToolMessage] {
	const toolCallId = `call-${index}`

	return [
		new AIMessage({
			id: `tool-call-${index}`,
			content: '',
			tool_calls: [
				{ id: toolCallId, name: toolName, args: {}, type: 'tool_call' },
			],
		}),
		new ToolMessage({
			id: `tool-result-${index}`,
			content: `result-${index}`,
			tool_call_id: toolCallId,
			name: includeToolMessageName ? toolName : undefined,
		}),
	]
}

describe('simplifyHistoricalToolMessages', () => {
	it('simplifies only ToolMessages older than the latest three', () => {
		const history = Array.from({ length: 5 }, (_, index) =>
			createToolMessages(index + 1),
		).flat()
		const currentMessage = new HumanMessage('continue')
		const messages = [new HumanMessage('start'), ...history, currentMessage]
		const projected = simplifyHistoricalToolMessages(messages)

		expect(projected).toHaveLength(messages.length)
		expect(projected.filter((message) => !ToolMessage.isInstance(message))).toEqual(
			messages.filter((message) => !ToolMessage.isInstance(message)),
		)
		expect(projected.find((message) => message.id === 'tool-result-1')?.content)
			.toBe('[Previous: used tool_1]')
		expect(projected.find((message) => message.id === 'tool-result-2')?.content)
			.toBe('[Previous: used tool_2]')
		for (const index of [3, 4, 5]) {
			expect(projected.find((message) => message.id === `tool-result-${index}`))
				.toBe(messages.find((message) => message.id === `tool-result-${index}`))
		}
	})

	it('always keeps read_file results and resolves missing names from tool calls', () => {
		const metadata = { source: 'test' }
		const readFileMessages = createToolMessages(1, 'read_file')
		const fallbackMessages = createToolMessages(2, 'web_search', false)
		fallbackMessages[1] = new ToolMessage({
			...fallbackMessages[1],
			metadata,
			status: 'error',
		})
		const recentHistory = [3, 4, 5].flatMap((index) => createToolMessages(index))
		const messages = [
			new HumanMessage('start'),
			...readFileMessages,
			...fallbackMessages,
			...recentHistory,
			new HumanMessage('continue'),
		]
		const projected = simplifyHistoricalToolMessages(messages)
		const readFileResult = projected.find(
			(message) => message.id === 'tool-result-1',
		)
		const fallbackResult = projected.find(
			(message) => message.id === 'tool-result-2',
		) as ToolMessage

		expect(readFileResult).toBe(readFileMessages[1])
		expect(fallbackResult).not.toBe(fallbackMessages[1])
		expect(fallbackResult).toMatchObject({
			content: '[Previous: used web_search]',
			tool_call_id: 'call-2',
			status: 'error',
			id: 'tool-result-2',
			metadata,
		})
	})

	it('keeps unknown and current-turn ToolMessages unchanged', () => {
		const historical = [1, 2, 3, 4].flatMap((index) =>
			createToolMessages(index),
		)
		const unknown = new ToolMessage({
			id: 'unknown-result',
			content: 'unknown result',
			tool_call_id: 'unknown-call',
		})
		const currentToolMessages = [5, 6, 7, 8].flatMap((index) =>
			createToolMessages(index),
		)
		const messages = [
			new HumanMessage('start'),
			unknown,
			...historical,
			new HumanMessage('current request'),
			...currentToolMessages,
		]
		const projected = simplifyHistoricalToolMessages(messages)

		expect(projected.find((message) => message.id === 'unknown-result')).toBe(unknown)
		for (const index of [5, 6, 7, 8]) {
			expect(projected.find((message) => message.id === `tool-result-${index}`))
				.toBe(messages.find((message) => message.id === `tool-result-${index}`))
		}
	})
})

describe('trimModelContextMessages', () => {
	it('keeps at most the latest 300 messages', () => {
		const messages = createMessages(MAX_MODEL_CONTEXT_MESSAGES + 1)
		const projected = trimModelContextMessages(messages)

		expect(projected).toHaveLength(MAX_MODEL_CONTEXT_MESSAGES)
		expect(projected[0]).toBe(messages[1])
		expect(projected.at(-1)).toBe(messages.at(-1))
		expect(messages).toHaveLength(MAX_MODEL_CONTEXT_MESSAGES + 1)
	})

	it('pins the automatic summary while retaining the newest messages', () => {
		const messages = createMessages(MAX_MODEL_CONTEXT_MESSAGES + 2)
		const compressed = applyContextCompression(messages, {
			summary: 'compressed beginning',
			compressedMessageIds: ['message-1', 'message-2'],
			compressionCount: 1,
			updatedAt: '2026-07-30T00:00:00.000Z',
		})
		const projected = trimModelContextMessages(compressed)

		expect(projected).toHaveLength(MAX_MODEL_CONTEXT_MESSAGES)
		expect(projected[0].content).toContain('compressed beginning')
		expect(projected[1]).toBe(messages[3])
		expect(projected.at(-1)).toBe(messages.at(-1))
	})

	it('drops a complete tool group when the boundary would split it', () => {
		const toolMessages = createToolMessages(1, 'web_search')
		const recentMessages = createMessages(MAX_MODEL_CONTEXT_MESSAGES - 1)
		const messages = [
			new HumanMessage('old request'),
			...toolMessages,
			...recentMessages,
		]
		const projected = trimModelContextMessages(messages)

		expect(projected).toHaveLength(MAX_MODEL_CONTEXT_MESSAGES - 1)
		expect(projected).not.toContain(toolMessages[0])
		expect(projected).not.toContain(toolMessages[1])
		expect(projected).toEqual(recentMessages)
	})
})

describe('summarizeContextMessages', () => {
	it('summarizes selected messages without using a checkpointer', async () => {
		const model = fakeModel().respond(new AIMessage(' concise summary '))

		await expect(
			summarizeContextMessages(model, [
				new HumanMessage('first request'),
				new AIMessage('first answer'),
			]),
		).resolves.toBe('concise summary')

		expect(model.calls[0].messages).toHaveLength(2)
		expect(model.calls[0].messages[1].content).toContain('first request')
		expect(model.calls[0].messages[1].content).toContain('first answer')
	})

	it('rejects an empty model summary', async () => {
		const model = fakeModel().respond(new AIMessage(''))

		await expect(
			summarizeContextMessages(model, [new HumanMessage('message')]),
		).rejects.toThrow('模型返回了空摘要。')
	})
})

describe('automatic Context compression', () => {
	it('compresses old messages and keeps the latest six messages', async () => {
		const model = fakeModel().respond(new AIMessage('compressed summary'))
		const result = await compressContextMessages(model, createMessages(8))

		expect(result).toMatchObject({
			compressed: true,
			newlyCompressedMessageCount: 2,
			retainedMessageCount: 6,
			compressionCount: 1,
		})
		expect(result.compression?.compressedMessageIds).toEqual([
			'message-1',
			'message-2',
		])
	})

	it('merges only newly eligible messages into the previous summary', async () => {
		const model = fakeModel().respond(new AIMessage('updated summary'))
		const previous: ContextCompression = {
			summary: 'previous facts',
			compressedMessageIds: ['message-1', 'message-2'],
			compressionCount: 1,
			updatedAt: '2026-07-29T00:00:00.000Z',
		}
		const result = await compressContextMessages(model, createMessages(10), previous)
		const prompt = String(model.calls[0].messages[1].content)

		expect(prompt).toContain('previous facts')
		expect(prompt).toContain('content-3')
		expect(prompt).toContain('content-4')
		expect(prompt).not.toContain('content-1')
		expect(prompt).not.toContain('content-2')
		expect(result.compression?.compressedMessageIds).toEqual([
			'message-1',
			'message-2',
			'message-3',
			'message-4',
		])
		expect(result.compressionCount).toBe(2)
	})

	it('keeps a complete tool call group when the six-message boundary splits it', async () => {
		const model = fakeModel().respond(new AIMessage('tool-aware summary'))
		const messages: BaseMessage[] = [
			new HumanMessage({ id: 'old-human', content: 'old' }),
			new AIMessage({
				id: 'tool-call',
				content: '',
				tool_calls: [
					{ id: 'call-1', name: 'search', args: {}, type: 'tool_call' },
				],
			}),
			new ToolMessage({
				id: 'tool-result',
				content: 'result',
				tool_call_id: 'call-1',
			}),
			new AIMessage({ id: 'tool-answer', content: 'answer' }),
			...createMessages(4).map((message, index) => {
				message.id = `recent-${index + 1}`
				return message
			}),
		]
		const result = await compressContextMessages(model, messages)

		expect(result.newlyCompressedMessageCount).toBe(1)
		expect(result.retainedMessageCount).toBe(7)
		expect(result.compression?.compressedMessageIds).toEqual(['old-human'])
	})

	it('replaces marked messages only in the model-facing Context', () => {
		const messages = createMessages(8)
		const projected = applyContextCompression(messages, {
			summary: 'first two messages',
			compressedMessageIds: ['message-1', 'message-2'],
			compressionCount: 1,
			updatedAt: '2026-07-29T00:00:00.000Z',
		})

		expect(projected).toHaveLength(7)
		expect(projected[0].content).toContain('first two messages')
		expect(projected.slice(1)).toEqual(messages.slice(2))
		expect(messages).toHaveLength(8)
	})

	it('ignores a stale compression record instead of applying a partial summary', () => {
		const messages = createMessages(8)
		const projected = applyContextCompression(messages, {
			summary: 'stale summary',
			compressedMessageIds: ['message-1', 'missing-message'],
			compressionCount: 1,
			updatedAt: '2026-07-29T00:00:00.000Z',
		})

		expect(projected).toBe(messages)
	})

	it('skips compression when all messages are in the retained window', async () => {
		const model = fakeModel()
		const result = await compressContextMessages(model, createMessages(6))

		expect(result).toEqual({
			compression: undefined,
			compressed: false,
			newlyCompressedMessageCount: 0,
			retainedMessageCount: 6,
			compressionCount: 0,
		})
		expect(model.callCount).toBe(0)
	})
})
