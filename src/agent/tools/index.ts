import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { skills } from '../skills'
import { currentTimeTool } from './current_time_tool'
import { execTool } from './exec_tool'
import { loadSkillTool } from './load_skill_tool'
import { memoryCreate } from './memory_create_tool'
import { memoryDelete } from './memory_delete_tool'
import { memoryRetrieve } from './memory_retrieve_tool'
import { profileUpdate } from './profile_update_tool'
import { readFileTool } from './read_file_tool'
import { runJsTool } from './run_js_tool'
import { runPyTool } from './run_py_tool'
import { webFetchTool } from './web_fetch_tool'
import { webSearchTool } from './web_search_tool'
import { writeFileTool } from './write_file_tool'

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

const runPy = tool(
	({ code }: { code: string }) => runPyTool(code),
	{
		name: 'run_py',
		// 使用本机 python3 执行；未安装时返回明确错误，供模型告知用户。
		description:
			'Run Python code with the local python3 interpreter. Returns stdout/stderr or an error if Python 3 is unavailable. Does not inherit project environment variables. Single runs are limited to 5 seconds, 20 KB of source, and 64 KB of output.',
		schema: z.object({
			code: z.string().max(20 * 1024).describe('Python source code to execute.'),
		}),
	},
)

const currentTime = tool(
	() => currentTimeTool(),
	{
		name: 'current_time',
		description:
			'Get the current date, time, and time zone from the local system. Use this for questions about today or the current time.',
		schema: z.object({}),
	},
)

const webFetch = tool(
	({ url }: { url: string }) => webFetchTool(url),
	{
		name: 'web_fetch',
		// webFetchTool 会校验公网地址、重定向、超时和响应体大小。
		description:
			'Fetch a public HTTP or HTTPS URL and return its text content. Local network URLs and binary downloads are not supported.',
		schema: z.object({
			url: z.string().url().describe('The public HTTP or HTTPS URL to fetch.'),
		}),
	},
)

const skillNames = skills.map((skill) => skill.name)
const skillTools = skillNames.length
	? [
			tool(
				({ name }: { name: string }) => loadSkillTool(name),
				{
					name: 'load_skill',
					description: 'Load the complete SKILL.md instructions for one available skill.',
					schema: z.object({
						name: z
							.enum(skillNames as [string, ...string[]])
							.describe('The exact name of the skill to load.'),
					}),
				},
			),
		]
	: []

// Agent 统一从此注册表加载工具；新增工具时在这里声明元信息并加入数组。
export const tools = [
	readFile,
	writeFile,
	exec,
	runJs,
	runPy,
	currentTime,
	webSearchTool,
	webFetch,
	profileUpdate,
	memoryCreate,
	memoryRetrieve,
	memoryDelete,
	...skillTools,
]
