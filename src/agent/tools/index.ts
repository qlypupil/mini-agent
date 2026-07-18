import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { execTool } from './exec_tool'
import { readFileTool } from './read_file_tool'
import { runJsTool } from './run_js_tool'
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

const exec = tool(
	(input) => execTool(input),
	{
		name: 'exec',
		// schema 只暴露结构化的只读操作，execTool 仍会在运行时二次校验。
		description:
			'Run a safe read-only command in the current directory. Shell syntax and write operations are not supported.',
		schema: z.object({
			command: z
				.enum(['ls', 'find', 'rg', 'pwd', 'git_status', 'git_diff', 'git_log'])
				.describe('The safe read-only command to run.'),
			path: z
				.string()
				.optional()
				.describe('Optional relative path for ls, find, or rg.'),
			query: z.string().optional().describe('Required search text when command is rg.'),
			maxDepth: z
				.number()
				.int()
				.min(0)
				.max(5)
				.optional()
				.describe('Optional maximum depth when command is find.'),
		}),
	},
)

const runJs = tool(
	({ code }: { code: string }) => runJsTool(code),
	{
		name: 'run_js',
		// 代码在 Node 权限模型子进程中执行，仍由 runJsTool 强制超时和输出限制。
		description:
			'Run JavaScript in a restricted Node.js process without file system, network, or child process permissions.',
		schema: z.object({
			code: z.string().max(20 * 1024).describe('JavaScript source code to execute.'),
		}),
	},
)

// Agent 统一从此注册表加载工具；新增工具时在这里声明元信息并加入数组。
export const tools = [searchTool, readFile, writeFile, exec, runJs]
