import '../env'
import { TavilySearch } from '@langchain/tavily'

// 直接注册 Tavily 原生工具，保持与 Moonshot 工具调用链的兼容性。
export const tavilySearchOptions = {
	name: 'web_search',
	description:
		'Search the web with Tavily and return up to three general results.',
	maxResults: 3,
	topic: 'general',
	includeAnswer: true,
	tavilyApiKey: process.env.TAVILY_API_KEY,
} as const

export const webSearchTool = new TavilySearch(tavilySearchOptions)
