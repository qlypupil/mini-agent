import './env'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { BaseMessage } from '@langchain/core/messages'
import { Command, isInterrupted } from '@langchain/langgraph'
import {
	createChatGraph,
	type ContextControl,
	type ToolApprovalDecision,
	type ToolApprovalInterrupt,
	type ToolApprovalRequest,
	type ToolApprovalResume,
} from './runtime/graph'
import {
	compressContextMessages,
	summarizeContextMessages,
	type ContextCompressionResult,
} from './runtime/context'
import { createCheckpointer } from './storage/checkpointer'
import { ContextCompressionStore } from './storage/context_compression'
import {
	getLatestInputTokens,
	getModelContextLimit,
	shouldWarnContextUsage,
	type ContextUsage,
} from './runtime/context_usage'
import {
	createChatModel,
	formatModelSelection,
	getDefaultModelProvider,
	getModelMetadata,
	type ModelProvider,
} from './runtime/models'
import {
	applyContextPatch,
	createMessagesReset,
	type ContextPatch,
} from './runtime/context_patch'
import { initializeDatabase } from './storage/db'
import { buildSystemPrompt } from './prompt'
import { tools } from './tools'

const modelCache = new Map<ModelProvider, BaseChatModel>()

function getChatModel(provider: ModelProvider): BaseChatModel {
	const cachedModel = modelCache.get(provider)
	if (cachedModel) return cachedModel

	const model = createChatModel(provider)
	modelCache.set(provider, model)
	return model
}

export function ensureModelConfigured(provider: ModelProvider): void {
	getChatModel(provider)
}

export function describeModel(provider: ModelProvider): string {
	return formatModelSelection(provider)
}

initializeDatabase()

// SQLite checkpointer 按 threadId 将会话状态保存到当前目录的 .data/checkpointer.db。
const checkpointer = createCheckpointer()
const contextCompressionStore = new ContextCompressionStore()

// 自定义 StateGraph 在模型调用前显式选择 Context，并保留标准工具调用循环。
const agent = createChatGraph({
	tools,
	systemPrompt: buildSystemPrompt(),
	checkpointer,
})

function createThreadConfig(threadId: string) {
	return {
		configurable: {
			thread_id: threadId,
		},
	}
}

export async function getChatMessages(threadId: string): Promise<BaseMessage[]> {
	const snapshot = await agent.getState(createThreadConfig(threadId))
	return snapshot.values.messages ?? []
}

export async function persistContextPatch(
	threadId: string,
	patch: ContextPatch,
): Promise<void> {
	const messages = await getChatMessages(threadId)
	await agent.updateState(createThreadConfig(threadId), {
		messages: createMessagesReset(applyContextPatch(messages, patch)),
	})
	await contextCompressionStore.clear(threadId)
}

export async function seedChatSession(
	threadId: string,
	messages: BaseMessage[],
): Promise<void> {
	await contextCompressionStore.clear(threadId)
	await agent.updateState(createThreadConfig(threadId), {
		messages: createMessagesReset(messages),
	})
}

export async function summarizeMessages(
	messages: BaseMessage[],
	modelProvider: ModelProvider = getDefaultModelProvider(),
): Promise<string> {
	return summarizeContextMessages(getChatModel(modelProvider), messages)
}

export async function compressContext(
	threadId: string,
	modelProvider: ModelProvider = getDefaultModelProvider(),
): Promise<ContextCompressionResult> {
	const [messages, previous] = await Promise.all([
		getChatMessages(threadId),
		contextCompressionStore.get(threadId),
	])
	const result = await compressContextMessages(
		getChatModel(modelProvider),
		messages,
		previous,
	)
	if (result.compressed && result.compression) {
		await contextCompressionStore.set(threadId, result.compression)
	}
	return result
}

// 保留原 API 名称，避免已有调用方因命名调整失效。
export const compressChatContext = compressContext

export type AutomaticContextCompressionResult =
	| { status: 'not-needed' }
	| { status: 'completed'; compression: ContextCompressionResult }
	| { status: 'failed'; error: string }

export async function compressChatContextIfNeeded(
	threadId: string,
	contextUsage: ContextUsage,
	modelProvider: ModelProvider = getDefaultModelProvider(),
	options: {
		onStart?: () => void
		compress?: typeof compressContext
	} = {},
): Promise<AutomaticContextCompressionResult> {
	if (!shouldWarnContextUsage(contextUsage)) {
		return { status: 'not-needed' }
	}

	options.onStart?.()
	try {
		return {
			status: 'completed',
			compression: await (options.compress ?? compressContext)(
				threadId,
				modelProvider,
			),
		}
	} catch (error) {
		return {
			status: 'failed',
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export type ToolEvent = {
	name: string
	status: 'started' | 'completed' | 'failed' | 'rejected'
	error?: string
}

export type ToolApprovalHandler = (
	request: ToolApprovalRequest,
) => boolean | Promise<boolean>

export async function collectToolApprovalDecisions(
	requests: ToolApprovalRequest[],
	onToolApproval?: ToolApprovalHandler,
	onToolEvent?: (event: ToolEvent) => void,
	signal?: AbortSignal,
): Promise<ToolApprovalDecision[]> {
	const decisions: ToolApprovalDecision[] = []
	for (const request of requests) {
		signal?.throwIfAborted()
		const approved = onToolApproval
			? await onToolApproval(request)
			: false
		decisions.push({ type: approved ? 'approve' : 'reject' })
		onToolEvent?.({
			name: request.name,
			status: approved ? 'started' : 'rejected',
		})
	}
	return decisions
}

export interface AgentRunResult {
	response: string
	contextUsage: ContextUsage
}

/**
 * 以流式方式运行 agent，将 token 逐个回调给调用方
 *
 * SQLite checkpointer 会按 threadId 保存并续接跨进程会话历史。
 *
 * @param {string} userMessage - 当前用户输入
 * @param {Function} onToken   - 每个 token 到来时的回调 (token: string) => void
 * @param {string} threadId    - 会话 ID，相同 ID 会续接当前进程内的历史记录
 * @param {AbortSignal} signal - 用于取消当前 Agent 请求的信号
 * @param {ContextControl} contextControl - 可选的单轮或持久 Context 修改
 * @param {ModelProvider} modelProvider - 本轮请求使用的模型提供商
 * @param {ToolApprovalHandler} onToolApproval - Tool 执行前的用户确认回调，缺失时默认拒绝
 * @returns {Promise<AgentRunResult>} 完整的 AI 回复文本与最终模型请求的 context 用量
 */
export async function runAgentStream(
	userMessage: string,
	onToken: (token: string) => void,
	threadId: string = 'default-session',
	signal?: AbortSignal,
	onToolEvent?: (event: ToolEvent) => void,
	contextControl?: ContextControl,
	modelProvider: ModelProvider = getDefaultModelProvider(),
	onToolApproval?: ToolApprovalHandler,
): Promise<AgentRunResult> {
	const config = createThreadConfig(threadId)
	const model = getChatModel(modelProvider)
	const modelMetadata = getModelMetadata(modelProvider)
	const contextCompression = contextControl
		? undefined
		: await contextCompressionStore.get(threadId).catch(() => undefined)
	let fullResponse = ''
	const usageMetadata: unknown[] = []
	let streamInput: any = {
		messages: [{ role: 'user', content: userMessage }],
	}

	while (true) {
		const stream = await agent.stream(streamInput, {
			...config,
			streamMode: ['messages', 'updates'],
			signal,
			context: { model, contextControl, contextCompression },
		})
		let approvalRequests: ToolApprovalRequest[] | undefined

		for await (const event of stream as any) {
			const mode = event[0]
			const chunk = event[1]

			if (mode === 'updates') {
				if (!isInterrupted<ToolApprovalInterrupt>(chunk)) continue

				for (const pendingInterrupt of chunk.__interrupt__) {
					const value = pendingInterrupt.value
					if (
						!value ||
						value.type !== 'tool_approval' ||
						!Array.isArray(value.requests)
					) {
						throw new Error('Received an unsupported LangGraph interrupt.')
					}
					if (approvalRequests) {
						throw new Error('Received multiple tool approval interrupts in one graph step.')
					}
					approvalRequests = value.requests
				}
				continue
			}

			if (mode !== 'messages') continue
			// messages 模式的事件由消息对象和运行元数据组成。
			const message = chunk[0]
			const metadata = chunk[1]

			if (metadata?.langgraph_node === 'tools') {
				const toolName = (message as any).name ?? 'unknown tool'
				const content = String((message as any).content ?? '')
				let toolError: string | undefined
				try {
					const result = JSON.parse(content)
					if (typeof result.error === 'string') {
						toolError = result.error
					}
				} catch {
					// 非 JSON 工具结果仍可正常显示为完成状态。
				}
				const isFailure = (message as any).status === 'error' || Boolean(toolError)
				onToolEvent?.({
					name: toolName,
					status: isFailure ? 'failed' : 'completed',
					error: isFailure ? toolError ?? content : undefined,
				})
				continue
			}

			// 仅向调用方转发模型节点生成的文本，跳过授权和其他图节点事件。
			if (metadata?.langgraph_node !== 'model_request') continue

			if ((message as any).usage_metadata !== undefined) {
				usageMetadata.push((message as any).usage_metadata)
			}

			// AIMessageChunk 的 content 在 message.content 属性上，不在 kwargs.content。
			const content: string =
				(message as any).content ?? (message as any).kwargs?.content ?? ''
			const toolCallChunks = (message as any).tool_call_chunks ?? []

			// 工具调用参数会在流中分片到达，不能作为用户可见的回复文本输出。
			if (!content || toolCallChunks.length > 0) continue

			onToken(content)
			fullResponse += content
		}

		if (!approvalRequests) break

		const decisions = await collectToolApprovalDecisions(
			approvalRequests,
			onToolApproval,
			onToolEvent,
			signal,
		)

		streamInput = new Command<ToolApprovalResume>({
			resume: { decisions },
		})
	}

	return {
		response: fullResponse,
		contextUsage: {
			model: modelMetadata.model,
			inputTokens: getLatestInputTokens(usageMetadata),
			contextLimit: getModelContextLimit(modelMetadata.model),
		},
	}
}
