import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { readFileTool } from './read_file_tool'
import { search } from './search'
import { writeFileTool } from './write_file_tool'

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

const readFile = tool(
	({ path }: { path: string }) => readFileTool(path),
	{
		name: 'read_file',
		// 文件内容会作为工具结果返回给模型，具体安全边界由 readFileTool 强制执行。
		description:
			'Read a UTF-8 text file from the current directory or its subdirectories.',
		schema: z.object({
			path: z
				.string()
				.describe('A relative path to a file in the current directory.'),
		}),
	},
)

const writeFile = tool(
	({ path, content }: { path: string; content: string }) =>
		writeFileTool(path, content),
	{
		name: 'write_file',
		// 内容由模型生成，路径与敏感文件限制必须由 writeFileTool 强制执行。
		description:
			'Create a new UTF-8 file or overwrite an existing file in the current directory or its subdirectories.',
		schema: z.object({
			path: z
				.string()
				.describe('A relative path to a file in the current directory.'),
			content: z.string().describe('The complete UTF-8 text content to write.'),
		}),
	},
)

// Agent 统一从此注册表加载工具；新增工具时在这里声明元信息并加入数组。
export const tools = [searchTool, readFile, writeFile]
