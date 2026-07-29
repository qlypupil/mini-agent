import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { createChatGraph, summarizeContextMessages } from './graph'
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

	it('returns tool results to the model through the tools node', async () => {
		const echo = tool(({ text }: { text: string }) => `echo:${text}`, {
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
				context: { contextControl: undefined },
			},
		)

		expect(model.callCount).toBe(2)
		expect(model.calls[1].messages.some((message) => message.getType() === 'tool')).toBe(true)
		expect(result.messages.at(-1)?.content).toBe('final')
		checkpointer.db.close()
	})

	it('keeps model and tool node names in message stream metadata', async () => {
		const model = fakeModel().respond(new AIMessage('streamed'))
		const { graph, checkpointer } = createTestGraph(model)
		const stream = await graph.stream(
			{ messages: [new HumanMessage('hello')] },
			{
				configurable: { thread_id: 'stream-thread' },
				context: { contextControl: undefined },
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
