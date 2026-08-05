import { BaseChatModel, BindToolsInput } from '@langchain/core/language_models/chat_models'
import {
	AIMessage,
	BaseMessage,
	SystemMessage,
	ToolMessage,
} from '@langchain/core/messages'
import {
	END,
	MessagesValue,
	START,
	StateGraph,
	StateSchema,
	interrupt,
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
	simplifyHistoricalToolMessages,
	trimModelContextMessages,
	type ContextCompression,
} from './context'
import { maybePersistToolMessages } from './tool_output'
import { createCheckpointer } from '../storage/checkpointer'
import {
	type PermissionedTool,
	type ToolAuthorization,
	type ToolPermissionLevel,
} from '../permission'
import { authorizeExec } from '../permission/exec'
import { authorizeNetwork } from '../permission/network'
import { authorizeRead } from '../permission/read'
import { createProjectPathBoundary } from '../permission/util'
import { authorizeWrite } from '../permission/write'

export type ContextApplyMode = 'once' | 'persist'

export interface ContextControl {
	mode: ContextApplyMode
	patch: ContextPatch
}

export interface ToolApprovalRequest {
	id: string
	name: string
	args: Record<string, unknown>
	permissionLevel: ToolPermissionLevel
}

export type ToolApprovalDecision =
	| { type: 'approve' }
	| { type: 'reject' }

export interface ToolApprovalInterrupt {
	type: 'tool_approval'
	requests: ToolApprovalRequest[]
}

export interface ToolApprovalResume {
	decisions: ToolApprovalDecision[]
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
	tools: PermissionedTool[]
	systemPrompt: string
	checkpointer: ReturnType<typeof createCheckpointer>
	projectRoot?: string
}

function getLatestAIMessage(messages: BaseMessage[]): AIMessage | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (AIMessage.isInstance(messages[index])) {
			return messages[index] as AIMessage
		}
	}
	return undefined
}

function getDeniedToolMessage(reason: ToolAuthorization['reason']): string {
	switch (reason) {
		case 'directory_change':
			return 'The shell command attempts to change the working directory and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it with another tool.'
		case 'python_execution':
			return 'Python execution through the exec tool is blocked by the local execution policy. The tool was not executed. If Python is appropriate, use the run_py tool instead; do not retry or bypass the restriction through exec.'
		case 'javascript_execution':
			return 'JavaScript or TypeScript execution through the exec tool is blocked by the local execution policy. The tool was not executed. If JavaScript or TypeScript is appropriate, use the run_js tool instead; do not retry or bypass the restriction through exec.'
		case 'other_language_execution':
			return 'Non-shell language execution through the exec tool is blocked by the local execution policy. The tool was not executed. Explain that exec is limited to shell commands and shell scripts, and do not retry or bypass the restriction.'
		case 'privilege_escalation':
			return 'The shell command attempts to use elevated privileges and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'file_deletion':
			return 'The shell command attempts to delete files or directories and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'file_modification':
			return 'The shell command attempts to modify files or directories and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'permission_change':
			return 'The shell command attempts to change file or directory permissions and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'process_service_control':
			return 'The shell command attempts to control processes or services and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'user_account_change':
			return 'The shell command attempts to modify user or group accounts and was blocked by the local execution policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it through exec.'
		case 'sensitive_information_access':
			return 'The shell command attempts to access sensitive local information and was blocked by the local execution policy. The tool was not executed. Explain the restriction without exposing sensitive path details, and do not retry or bypass it through exec.'
		case 'network_remote_control':
			return 'The shell command attempts network access or remote control and was blocked by the local execution policy. The tool was not executed. For public web retrieval, use web_search or web_fetch when appropriate; do not retry or bypass the restriction through exec.'
		case 'invalid_path':
			return 'The requested file path could not be safely resolved. The tool was not executed. Explain the restriction to the user and do not retry or bypass it with another tool.'
		default:
			return 'The requested file path is protected by the local filesystem safety policy. The tool was not executed. Explain the restriction to the user and do not retry or bypass it with another tool.'
	}
}

function validateApprovalResume(
	value: unknown,
	expectedCount: number,
): ToolApprovalDecision[] {
	if (typeof value !== 'object' || value === null || !('decisions' in value)) {
		throw new Error('Invalid tool approval response: decisions must be an array.')
	}

	const decisions = (value as { decisions?: unknown }).decisions
	if (!Array.isArray(decisions)) {
		throw new Error('Invalid tool approval response: decisions must be an array.')
	}
	if (decisions.length !== expectedCount) {
		throw new Error(
			`Invalid tool approval response: expected ${expectedCount} decisions, received ${decisions.length}.`,
		)
	}

	return decisions.map((decision, index) => {
		if (
			typeof decision !== 'object' ||
			decision === null ||
			!('type' in decision) ||
			(decision.type !== 'approve' && decision.type !== 'reject')
		) {
			throw new Error(
				`Invalid tool approval response at index ${index}: expected approve or reject.`,
			)
		}
		return { type: decision.type }
	})
}

export function createChatGraph({
	model,
	tools,
	systemPrompt,
	checkpointer,
	projectRoot,
}: CreateChatGraphOptions) {
	const toolExecutor = new ToolNode(tools)
	const toolsByName = new Map(tools.map((registeredTool) => [registeredTool.name, registeredTool]))
	const projectBoundary = createProjectPathBoundary(projectRoot)

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
			const contextMessages = control?.mode === 'once'
				? applyContextPatch(state.messages, control.patch)
				: compression
					? applyContextCompression(state.messages, compression)
					: state.messages
			const trimmedMessages = trimModelContextMessages(contextMessages)
			const messages = simplifyHistoricalToolMessages(trimmedMessages)
			const response = await modelWithTools.invoke(
				[new SystemMessage(systemPrompt), ...messages],
				{ signal: runtime.signal },
			)

			return { messages: [response as BaseMessage] }
		})
		.addNode('authorize_tools', (state) => {
			const lastMessage = getLatestAIMessage(state.messages)
			const toolCalls = lastMessage?.tool_calls ?? []
			if (toolCalls.length === 0) return {}

			const authorizations = toolCalls.map((toolCall) => {
				const registeredTool = toolsByName.get(toolCall.name)
				if (!registeredTool) {
					throw new Error(`Tool "${toolCall.name}" is not registered.`)
				}
				if (!toolCall.id) {
					throw new Error(`Tool call for "${toolCall.name}" is missing an ID.`)
				}

				const authorization: ToolAuthorization =
					registeredTool.permission_level === 'read'
						? authorizeRead(registeredTool, toolCall.args, projectBoundary)
						: registeredTool.permission_level === 'write'
							? authorizeWrite(registeredTool, toolCall.args, projectBoundary)
							: registeredTool.permission_level === 'exec'
								? authorizeExec(toolCall.args)
								: registeredTool.permission_level === 'network'
									? authorizeNetwork(toolCall.args)
									: { action: 'allow' }

				return {
					toolCall,
					registeredTool,
					authorization,
				}
			})
			const blockedMessages = authorizations.flatMap(
				({ toolCall, authorization }) => {
					if (authorization.action !== 'deny') return []

					return [
						new ToolMessage({
							name: toolCall.name,
							tool_call_id: toolCall.id!,
							status: 'error',
							content: getDeniedToolMessage(authorization.reason),
						}),
					]
				},
			)
			const pendingAuthorizations = authorizations.filter(
				({ authorization }) => authorization.action === 'ask',
			)
			if (pendingAuthorizations.length === 0) {
				return { messages: blockedMessages }
			}

			const requests = pendingAuthorizations.map(
				({ toolCall, registeredTool }): ToolApprovalRequest => ({
					id: toolCall.id!,
					name: toolCall.name,
					args: toolCall.args,
					permissionLevel: registeredTool.permission_level,
				}),
			)
			const resume = interrupt<ToolApprovalInterrupt, ToolApprovalResume>({
				type: 'tool_approval',
				requests,
			})
			const decisions = validateApprovalResume(
				resume,
				pendingAuthorizations.length,
			)
			const rejectedMessages = pendingAuthorizations.flatMap(({ toolCall }, index) => {
				if (decisions[index].type === 'approve') return []

				return [
					new ToolMessage({
						name: toolCall.name,
						tool_call_id: toolCall.id!,
						status: 'error',
						content: `User rejected the tool call for "${toolCall.name}". The tool was not executed. Do not retry this tool call or bypass the rejection with another tool unless the user explicitly asks again.`,
					}),
				]
			})

			return { messages: [...blockedMessages, ...rejectedMessages] }
		})
		.addNode('tools', async function toolNode(state, runtime) {
			const lastMessage = getLatestAIMessage(state.messages)
			const completedToolCallIds = new Set(
				state.messages
					.filter((message) => ToolMessage.isInstance(message))
					.map((message) => (message as ToolMessage).tool_call_id),
			)
			for (const toolCall of lastMessage?.tool_calls ?? []) {
				if (toolCall.id && completedToolCallIds.has(toolCall.id)) continue
				console.log(`[Tool] ${toolCall.name}`)
			}

			const result = await toolExecutor.invoke(state, runtime)
			if (
				typeof result !== 'object' ||
				result === null ||
				!('messages' in result) ||
				!Array.isArray(result.messages)
			) {
				return result
			}

			return {
				...result,
				messages: await maybePersistToolMessages(result.messages),
			}
		})
		.addEdge(START, 'apply_context')
		.addEdge('apply_context', 'model_request')
		.addConditionalEdges(
			'model_request',
			(state) => toolsCondition(state) === 'tools' ? 'authorize_tools' : END,
			['authorize_tools', END],
		)
		.addEdge('authorize_tools', 'tools')
		.addEdge('tools', 'model_request')
		.compile({ checkpointer })
}
