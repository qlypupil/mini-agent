import { createAgent } from 'langchain'
import { tool } from '@langchain/core/tools'
import { MemorySaver } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'
import * as dotenv from 'dotenv'
import { meta } from 'zod/v4/core'

dotenv.config()

// 示例工具：用于演示 Agent 的工具调用链路，尚未接入真实搜索服务。
const search = tool(
	async ({ query }: { query: string }) => {
		console.log(`\n[Tool] search called: "${query}"`)

		if (
			query.toLowerCase().includes('sf') ||
			query.toLowerCase().includes('san francisco')
		) {
			return "It's 60 degrees and foggy."
		}
		return "It's 90 degrees and sunny."
	},
	{
		name: 'search',
		description: 'Search the web for information',
		schema: z.object({
			query: z.string().describe('The query to use in your search.'),
		}),
	},
)

// Moonshot 兼容 OpenAI Chat Completions API，因此复用 ChatOpenAI 客户端。
const MOONSHOT_API_KEY = process.env.MOONSHOT_API_KEY
const MOONSHOT_BASE_URL =
	process.env.MOONSHOT_BASE_URL ?? 'https://api.moonshot.cn/v1'

if (!MOONSHOT_API_KEY) {
	throw new Error('MOONSHOT_API_KEY is not set')
}

const model = new ChatOpenAI({
	model: 'moonshot-v1-8k',
	apiKey: MOONSHOT_API_KEY,
	configuration: {
		baseURL: MOONSHOT_BASE_URL,
	},
	streaming: true,
})

// MemorySaver 按 threadId 保存当前 Node.js 进程内的对话状态。
const checkpointer = new MemorySaver()

// Agent 负责根据模型输出决定是否调用 tools，并继续生成最终回答。
const agent = createAgent({
	model,
	tools: [search],
	systemPrompt: 'You are a helpful assistant.',
	checkpointer,
})

/**
 * 以流式方式运行 agent，将 token 逐个回调给调用方
 *
 * MemorySaver 会在当前进程内按 threadId 保存并续接会话历史。
 * 进程重启后，内存中的历史会被清空。
 *
 * @param {string} userMessage - 当前用户输入
 * @param {Function} onToken   - 每个 token 到来时的回调 (token: string) => void
 * @param {string} threadId    - 会话 ID，相同 ID 会续接当前进程内的历史记录
 * @returns {Promise<string>}  完整的 AI 回复文本
 */
export async function runAgentStream(
	userMessage: string,
	onToken: (token: string) => void,
	threadId: string = 'default-session',
): Promise<string> {
	const config = {
		configurable: {
			thread_id: threadId,
		},
	}

	const stream = await agent.stream(
		{ messages: [{ role: 'user', content: userMessage }] },
		{ ...config, streamMode: 'messages' },
	)

	let fullResponse = ''

	for await (const chunk of stream as any) {
		// streamMode: 'messages' 的每个事件由消息对象和其运行元数据组成。
		const message = chunk[0]
		const metadata = chunk[1]

		// 仅向调用方转发模型节点生成的文本，跳过工具和其他图节点事件。
		if (metadata?.langgraph_node !== 'model_request') {
			continue
		}

		// AIMessageChunk 的 content 在 message.content 属性上，不在 kwargs.content
		const content: string =
			(message as any).content ?? (message as any).kwargs?.content ?? ''

		const toolCallChunks = (message as any).tool_call_chunks ?? []

		// 工具调用参数会在流中分片到达，不能作为用户可见的回复文本输出。
		if (!content || toolCallChunks.length > 0) {
			continue
		}

		onToken(content)

		fullResponse += content
	}

	return fullResponse
}
