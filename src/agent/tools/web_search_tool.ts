import '../env'
import { TavilySearch } from '@langchain/tavily'
import { withPermissionLevel } from './tool_permission'

// 直接注册 Tavily 原生工具，保持与 Moonshot 工具调用链的兼容性。
export const tavilySearchOptions = {
	name: 'web_search',
	description:
		'Search the web with Tavily and return up to three general results. For a query using current, now, today, tomorrow, or the day after tomorrow, call only after a successful current_time ToolMessage from an earlier tool round, and include the resolved YYYY-MM-DD date in the query; never batch this call with current_time.',
	maxResults: 3,
	topic: 'general',
	includeAnswer: true,
	tavilyApiKey: process.env.TAVILY_API_KEY,
} as const

export const webSearchTool = withPermissionLevel(
	new TavilySearch(tavilySearchOptions),
	'network',
)
