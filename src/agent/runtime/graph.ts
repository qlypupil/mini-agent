import { BaseChatModel, BindToolsInput } from '@langchain/core/language_models/chat_models'
import {
	BaseMessage,
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
	type ContextPatch,
} from './context_patch'
import {
	applyContextCompression,
	type ContextCompression,
} from './context'
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
	model: z.custom<BaseChatModel>().optional(),
	contextControl: z
		.object({
			mode: z.enum(['once', 'persist']),
			patch: z.custom<ContextPatch>(),
		})
		.optional(),
	contextCompression: z.custom<ContextCompression>().optional(),
})

export interface CreateChatGraphOptions {
	model?: BaseChatModel
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
			const requestModel = runtime.context?.model ?? model
			if (!requestModel) {
				throw new Error('No chat model was configured for this request.')
			}
			if (!requestModel.bindTools) {
				throw new Error('The configured chat model does not support tool binding.')
			}
			const modelWithTools = requestModel.bindTools(tools as BindToolsInput[])
			const control = runtime.context?.contextControl
			const compression = runtime.context?.contextCompression
			const messages = control?.mode === 'once'
				? applyContextPatch(state.messages, control.patch)
				: compression
					? applyContextCompression(state.messages, compression)
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
