import './env'
import { createAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'
import { meta } from 'zod/v4/core'
import { createCheckpointer } from './checkpointer'
import { skills } from './skills'
import { buildSkillsInstruction } from './skills/prompt'
import { tools } from './tools'

// Moonshot 兼容 OpenAI Chat Completions API，因此复用 ChatOpenAI 客户端。
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY
// 允许部署环境替换兼容网关，同时保持未配置时的原有 Moonshot 地址。
const MOONSHOT_BASE_URL =
	process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1'

if (!MOONSHOT_API_KEY) {
	throw new Error('MOONSHOT_API_KEY is not set')
}

const model = new ChatOpenAI({
	model: 'kimi-k2.6',
	apiKey: MOONSHOT_API_KEY,
	configuration: {
		baseURL: MOONSHOT_BASE_URL,
	},
	streaming: true,
})

// SQLite checkpointer 按 threadId 将会话状态保存到当前目录的 .data/checkpointer.db。
const checkpointer = createCheckpointer()

function buildSystemPrompt(): string {
	const realtimeInstructions =
		'You are a helpful assistant. For questions about the current date or time, you must use current_time and answer from its result. For other current, recent, or date-sensitive information such as news, weather, prices, or sports, you must use web_search before answering. Do not answer real-time questions from memory. When web_search returns results, answer from those results and do not claim the search failed. Only state that live information could not be retrieved when the tool result explicitly reports an error.'

	const skillsInstruction = buildSkillsInstruction(skills)
	return skillsInstruction
		? `${realtimeInstructions}\n\n${skillsInstruction}`
		: realtimeInstructions
}

// Agent 负责根据模型输出决定是否调用 tools，并继续生成最终回答。
const agent = createAgent({
	model,
	tools,
	systemPrompt: buildSystemPrompt(),
	checkpointer,
})

type ToolEvent = {
	name: string
	status: 'started' | 'completed' | 'failed'
	error?: string
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
 * @returns {Promise<string>}  完整的 AI 回复文本
 */
export async function runAgentStream(
	userMessage: string,
	onToken: (token: string) => void,
	threadId: string = 'default-session',
	signal?: AbortSignal,
	onToolEvent?: (event: ToolEvent) => void,
): Promise<string> {
	const config = {
		configurable: {
			thread_id: threadId,
		},
	}

	const stream = await agent.stream(
		{ messages: [{ role: 'user', content: userMessage }] },
		{ ...config, streamMode: 'messages', signal },
	)

	let fullResponse = ''
	const reportedToolCalls = new Set<string>()

	for await (const chunk of stream as any) {
		// streamMode: 'messages' 的每个事件由消息对象和其运行元数据组成。
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

		// 仅向调用方转发模型节点生成的文本，跳过工具和其他图节点事件。
		if (metadata?.langgraph_node !== 'model_request') {
			continue
		}

		// AIMessageChunk 的 content 在 message.content 属性上，不在 kwargs.content
		const content: string =
			(message as any).content ?? (message as any).kwargs?.content ?? ''

		const toolCallChunks = (message as any).tool_call_chunks ?? []
		const toolCalls = (message as any).tool_calls ?? []

		for (const toolCall of toolCalls) {
			const identifier = toolCall.id ?? toolCall.name
			if (toolCall.name && !reportedToolCalls.has(identifier)) {
				reportedToolCalls.add(identifier)
				onToolEvent?.({ name: toolCall.name, status: 'started' })
			}
		}

		// 工具调用参数会在流中分片到达，不能作为用户可见的回复文本输出。
		if (!content || toolCallChunks.length > 0) {
			continue
		}

		onToken(content)

		fullResponse += content
	}

	return fullResponse
}
