import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	ToolMessage,
} from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { createChatGraph } from './graph'
import * as toolOutput from './tool_output'
import { createCheckpointer } from '../storage/checkpointer'

function createTestGraph(model = fakeModel(), testTools: Parameters<typeof createChatGraph>[0]['tools'] = []) {
	const databasePath = join(
		mkdtempSync(join(tmpdir(), 'termclaw-chat-graph-')),
		'checkpointer.db',
	)
	const checkpointer = createCheckpointer(databasePath)
	const graph = createChatGraph({
		model,
		tools: testTools,
		systemPrompt: 'system prompt',
		checkpointer,
	})

	return { graph, checkpointer }
}

describe('custom chat graph', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('uses the model supplied in runtime context for the current request', async () => {
		const defaultModel = fakeModel().respond(new AIMessage('default'))
		const runtimeModel = fakeModel().respond(new AIMessage('runtime'))
		const { graph, checkpointer } = createTestGraph(defaultModel)

		const result = await graph.invoke(
			{ messages: [new HumanMessage('hello')] },
			{
				configurable: { thread_id: 'runtime-model-thread' },
				context: {
					model: runtimeModel,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(defaultModel.callCount).toBe(0)
		expect(runtimeModel.callCount).toBe(1)
		expect(result.messages.at(-1)?.content).toBe('runtime')
		checkpointer.db.close()
	})

	it('uses a one-shot Context patch without replacing persisted history', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'once-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'old-message', content: '原文' })],
		})

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: '继续' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: {
						mode: 'once' as const,
						patch: {
							operations: [
								{
									type: 'replace' as const,
									messageId: 'old-message',
									content: 'English text',
								},
							],
						},
					},
					contextCompression: {
						summary: 'stale automatic summary',
						compressedMessageIds: ['old-message'],
						compressionCount: 1,
						updatedAt: '2026-07-29T00:00:00.000Z',
					},
				},
			},
		)

		expect(model.calls[0].messages.map((message) => message.content)).toEqual([
			'system prompt',
			'English text',
			'继续',
		])
		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			'原文',
			'继续',
			'done',
		])
		checkpointer.db.close()
	})

	it('persists a Context patch before the model request', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'persist-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'old-message', content: '原文' })],
		})

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: '继续' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: {
						mode: 'persist' as const,
						patch: {
							operations: [
								{
									type: 'replace' as const,
									messageId: 'old-message',
									content: 'English text',
								},
							],
						},
					},
					contextCompression: undefined,
				},
			},
		)

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			'English text',
			'继续',
			'done',
		])
		checkpointer.db.close()
	})

	it('uses automatic compression without replacing checkpointed history', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'compression-thread' } }
		const history = Array.from({ length: 8 }, (_, index) =>
			index % 2 === 0
				? new HumanMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` })
				: new AIMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` }),
		)
		await graph.updateState(config, { messages: history })

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: 'continue' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: {
						summary: 'compressed history',
						compressedMessageIds: ['message-1', 'message-2'],
						compressionCount: 1,
						updatedAt: '2026-07-29T00:00:00.000Z',
					},
				},
			},
		)

		const modelContents = model.calls[0].messages.map((message) => message.content)
		expect(modelContents).toContain(
			'Conversation summary (automatically compressed):\ncompressed history',
		)
		expect(modelContents).not.toContain('content-1')
		expect(modelContents).not.toContain('content-2')
		expect(modelContents).toContain('content-3')
		expect(modelContents).toContain('continue')

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			...history.map((message) => message.content),
			'continue',
			'done',
		])
		checkpointer.db.close()
	})

	it('simplifies historical tool results only for the model request', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'tool-history-thread' } }
		const history: BaseMessage[] = [new HumanMessage('start')]

		for (let index = 1; index <= 4; index += 1) {
			history.push(
				new AIMessage({
					id: `tool-call-${index}`,
					content: '',
					tool_calls: [
						{
							id: `call-${index}`,
							name: `tool_${index}`,
							args: {},
							type: 'tool_call',
						},
					],
				}),
				new ToolMessage({
					id: `tool-result-${index}`,
					content: `original-result-${index}`,
					tool_call_id: `call-${index}`,
					name: `tool_${index}`,
				}),
				new AIMessage({
					id: `tool-answer-${index}`,
					content: `answer-${index}`,
				}),
			)
		}
		await graph.updateState(config, { messages: history })

		await graph.invoke(
			{ messages: [new HumanMessage('continue')] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const projectedToolResult = model.calls[0].messages.find(
			(message) => message.id === 'tool-result-1',
		)
		expect(projectedToolResult?.content).toBe('[Previous: used tool_1]')

		const snapshot = await graph.getState(config)
		const persistedToolResult = snapshot.values.messages.find(
			(message: BaseMessage) => message.id === 'tool-result-1',
		)
		expect(persistedToolResult?.content).toBe('original-result-1')
		checkpointer.db.close()
	})

	it('returns tool results to the model through the tools node', async () => {
		const callOrder: string[] = []
		const log = jest.spyOn(console, 'log').mockImplementation((message) => {
			callOrder.push(String(message))
		})
		const echo = tool(({ text }: { text: string }) => {
			callOrder.push('executed')
			return `echo:${text}`
		}, {
			name: 'echo',
			description: 'Echo text.',
			schema: z.object({ text: z.string() }),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-1', name: 'echo', args: { text: 'hello' } },
			])
			.respond(new AIMessage('final'))
		const { graph, checkpointer } = createTestGraph(model, [echo])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('use the tool')] },
			{
					configurable: { thread_id: 'tool-thread' },
					context: {
						model: undefined,
						contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(model.callCount).toBe(2)
		expect(model.calls[1].messages.some((message) => message.getType() === 'tool')).toBe(true)
		expect(result.messages.at(-1)?.content).toBe('final')
		expect(log).toHaveBeenCalledWith('[Tool] echo')
		expect(callOrder).toEqual(['[Tool] echo', 'executed'])
		checkpointer.db.close()
	})

	it('returns thrown tool errors to the model with an error status', async () => {
		const failingTool = tool(async () => {
			throw new Error('tool failed')
		}, {
			name: 'failing_tool',
			description: 'Always fails.',
			schema: z.object({}),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-1', name: 'failing_tool', args: {} },
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(model, [failingTool])

		await graph.invoke(
			{ messages: [new HumanMessage('use the tool')] },
			{
				configurable: { thread_id: 'failed-tool-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(toolMessage).toMatchObject({
			status: 'error',
			content: expect.stringContaining('tool failed'),
		})
		checkpointer.db.close()
	})

	it('returns processed tool output to the model', async () => {
		const processedContent = '<persisted-output>preview</persisted-output>'
		const persist = jest
			.spyOn(toolOutput, 'maybePersistToolMessages')
			.mockImplementation(async (messages) =>
				messages.map((message) =>
					ToolMessage.isInstance(message)
						? new ToolMessage({
							...message,
							content: processedContent,
						})
						: message,
				),
			)
		const largeOutput = tool(() => 'a'.repeat(50_001), {
			name: 'large_output',
			description: 'Returns a large output.',
			schema: z.object({}),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-large', name: 'large_output', args: {} },
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(model, [largeOutput])

		await graph.invoke(
			{ messages: [new HumanMessage('use the tool')] },
			{
				configurable: { thread_id: 'large-tool-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(persist).toHaveBeenCalledTimes(1)
		expect(toolMessage?.content).toBe(processedContent)
		checkpointer.db.close()
	})

	it('keeps model and tool node names in message stream metadata', async () => {
		const model = fakeModel().respond(new AIMessage('streamed'))
		const { graph, checkpointer } = createTestGraph(model)
		const stream = await graph.stream(
			{ messages: [new HumanMessage('hello')] },
			{
				configurable: { thread_id: 'stream-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
				streamMode: 'messages',
			},
		)
		const nodeNames: string[] = []

		for await (const chunk of stream as any) {
			nodeNames.push(chunk[1]?.langgraph_node)
		}

		expect(nodeNames).toContain('model_request')
		checkpointer.db.close()
	})
})
