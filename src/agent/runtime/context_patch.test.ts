import {
	AIMessage,
	HumanMessage,
	ToolMessage,
} from '@langchain/core/messages'
import {
	applyContextPatch,
	formatContextMessages,
	parseMessageSelector,
} from './context_patch'

describe('context control', () => {
	const messages = () => [
		new HumanMessage({ id: 'human-1', content: '你好' }),
		new AIMessage({ id: 'ai-1', content: '你好，有什么可以帮你？' }),
		new HumanMessage({ id: 'human-2', content: '请给我一个计划' }),
		new AIMessage({ id: 'ai-2', content: '这是计划。' }),
	]

	it('replaces a message in place by ID', () => {
		const result = applyContextPatch(messages(), {
			operations: [
				{
					type: 'replace',
					messageId: 'human-1',
					content: 'Hello',
				},
			],
		})

		expect(result).toHaveLength(4)
		expect(result[0]).toBeInstanceOf(HumanMessage)
		expect(result[0].id).toBe('human-1')
		expect(result[0].content).toBe('Hello')
	})

	it('replaces a continuous range with one summary message', () => {
		const result = applyContextPatch(messages(), {
			operations: [
				{
					type: 'replaceRange',
					messageIds: ['human-1', 'ai-1'],
					summary: 'The user greeted the assistant.',
				},
			],
		})

		expect(result.map((message) => message.content)).toEqual([
			'Conversation summary:\nThe user greeted the assistant.',
			'请给我一个计划',
			'这是计划。',
		])
	})

	it('removes a selected range and parses one-based selectors', () => {
		const source = messages()
		const messageIds = parseMessageSelector('2-3', source)
		const result = applyContextPatch(source, {
			operations: [{ type: 'remove', messageIds }],
		})

		expect(messageIds).toEqual(['ai-1', 'human-2'])
		expect(result.map((message) => message.id)).toEqual(['human-1', 'ai-2'])
		expect(() => parseMessageSelector('0', source)).toThrow(
			'消息范围必须在 1-4 之间。',
		)
	})

	it('rejects edits that split an AI tool call from its tool result', () => {
		const source = [
			new HumanMessage({ id: 'human-1', content: 'search' }),
			new AIMessage({
				id: 'ai-tool',
				content: '',
				tool_calls: [
					{ id: 'call-1', name: 'search', args: {}, type: 'tool_call' },
				],
			}),
			new ToolMessage({
				id: 'tool-1',
				content: 'result',
				tool_call_id: 'call-1',
			}),
		]

		expect(() =>
			applyContextPatch(source, {
				operations: [{ type: 'remove', messageIds: ['ai-tool'] }],
			}),
		).toThrow('工具调用消息必须与对应的工具结果一起编辑。')

		expect(
			applyContextPatch(source, {
				operations: [
					{ type: 'remove', messageIds: ['ai-tool', 'tool-1'] },
				],
			}),
		).toHaveLength(1)
	})

	it('formats stable message IDs and previews for the CLI', () => {
		const table = formatContextMessages(messages())

		expect(table).toContain('message_id')
		expect(table).toContain('human-1')
		expect(table).toContain('请给我一个计划')
	})
})
