import { BaseChatModel, BindToolsInput } from '@langchain/core/language_models/chat_models'
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
} from '@langchain/core/messages'
import { StructuredToolInterface } from '@langchain/core/tools'
import {
	END,
	MessagesValue,
	START,
	StateGraph,
	StateSchema,
} from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { z } from 'zod'
import {
	applyContextPatch,
	createMessagesReset,
	formatMessagesForSummary,
	type ContextPatch,
} from './context_patch'
import { createCheckpointer } from '../storage/checkpointer'

export type ContextApplyMode = 'once' | 'persist'

export interface ContextControl {
	mode: ContextApplyMode
	patch: ContextPatch
}

export const ChatState = new StateSchema({
	messages: MessagesValue,
})

const ChatContext = z.object({
	contextControl: z
		.object({
			mode: z.enum(['once', 'persist']),
			patch: z.custom<ContextPatch>(),
		})
		.optional(),
})

export interface CreateChatGraphOptions {
	model: BaseChatModel
	tools: StructuredToolInterface[]
	systemPrompt: string
	checkpointer: ReturnType<typeof createCheckpointer>
}

export function createChatGraph({
	model,
	tools,
	systemPrompt,
	checkpointer,
}: CreateChatGraphOptions) {
	if (!model.bindTools) {
		throw new Error('The configured chat model does not support tool binding.')
	}

	const modelWithTools = model.bindTools(tools as BindToolsInput[])

	return new StateGraph(ChatState, ChatContext)
		.addNode('apply_context', (state, runtime) => {
			const control = runtime.context?.contextControl
			if (!control || control.mode !== 'persist') return {}

			return {
				messages: createMessagesReset(
					applyContextPatch(state.messages, control.patch),
				),
			}
		})
		.addNode('model_request', async (state, runtime) => {
			const control = runtime.context?.contextControl
			const messages =
				control?.mode === 'once'
					? applyContextPatch(state.messages, control.patch)
					: state.messages
			const response = await modelWithTools.invoke(
				[new SystemMessage(systemPrompt), ...messages],
				{ signal: runtime.signal },
			)

			return { messages: [response as BaseMessage] }
		})
		.addNode('tools', new ToolNode(tools))
		.addEdge(START, 'apply_context')
		.addEdge('apply_context', 'model_request')
		.addConditionalEdges('model_request', toolsCondition, ['tools', END])
		.addEdge('tools', 'model_request')
		.compile({ checkpointer })
}

function stringifySummaryContent(content: AIMessage['content']): string {
	if (typeof content === 'string') return content.trim()
	if (!Array.isArray(content)) return ''

	return content
		.map((part) => {
			if (typeof part === 'string') return part
			if ('text' in part && typeof part.text === 'string') return part.text
			return ''
		})
		.join('')
		.trim()
}

export async function summarizeContextMessages(
	model: BaseChatModel,
	messages: BaseMessage[],
): Promise<string> {
	if (messages.length === 0) throw new Error('没有可摘要的消息。')

	const response = await model.invoke([
		new SystemMessage(
			'Create a concise plain-text summary of the supplied conversation. Preserve concrete facts, user requirements, decisions, unresolved questions, and important tool results. Do not add commentary or markdown headings.',
		),
		new HumanMessage(formatMessagesForSummary(messages)),
	])
	const summary = stringifySummaryContent(response.content)
	if (!summary) throw new Error('模型返回了空摘要。')

	return summary
}
