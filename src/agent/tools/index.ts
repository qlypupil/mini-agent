import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { search } from './search'

const searchTool = tool(
	({ query }: { query: string }) => search(query),
	{
		name: 'search',
		description: 'Search the web for information',
		schema: z.object({
			query: z.string().describe('The query to use in your search.'),
		}),
	},
)

// Agent 统一从此注册表加载工具；新增工具时在这里声明元信息并加入数组。
export const tools = [searchTool]
