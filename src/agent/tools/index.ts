import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { skills } from '../skills'
import { currentTimeTool } from './current_time_tool'
import { execSchema, execTool } from './exec_tool'
import { loadSkillTool } from './load_skill_tool'
import { memoryCreate } from './memory_create_tool'
import { memoryDelete } from './memory_delete_tool'
import { memoryRetrieve } from './memory_retrieve_tool'
import { profileUpdate } from './profile_update_tool'
import { readFileTool } from './read_file_tool'
import { runJsTool } from './run_js_tool'
import { runPyTool } from './run_py_tool'
import {
	type PermissionedTool,
	withPermissionLevel,
} from '../permission'
import { webFetchTool } from './web_fetch_tool'
import { webSearchTool } from './web_search_tool'
import { writeFileTool } from './write_file_tool'

const readFile = tool(
	({ path }: { path: string }) => readFileTool(path),
	{
		name: 'read_file',
		// 文件内容会作为工具结果返回给模型，具体安全边界由 readFileTool 强制执行。
		description:
			'Read a UTF-8 text file from any location accessible to the current process.',
		schema: z.object({
			path: z
				.string()
				.describe('An absolute file path or a path relative to the current directory.'),
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
			'Create a new UTF-8 file or overwrite an existing file at any location accessible to the current process.',
		schema: z.object({
			path: z
				.string()
				.describe('An absolute file path or a path relative to the current directory.'),
			content: z.string().describe('The complete UTF-8 text content to write.'),
		}),
	},
)

const exec = tool(
	(input) => execTool(input),
	{
		name: 'exec',
		description:
			'Run a complete shell command in the current working directory and return its standard output. Shell syntax, pipelines, redirects, and commands that modify files or system state are supported.',
		schema: execSchema,
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
			'Get the current date, time, and time zone from the local system. For live weather, news, price, or sports requests using current, now, today, tomorrow, or the day after tomorrow, call this in an earlier tool round and wait for its ToolMessage before calling web_search; never batch web_search with this call.',
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
			withPermissionLevel(
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
				'read',
			),
		]
	: []

// Agent 统一从此注册表加载工具；新增工具时在这里声明元信息并加入数组。
export const tools = [
	withPermissionLevel(readFile, 'read', { filePathArg: 'path' }),
	withPermissionLevel(writeFile, 'write', { filePathArg: 'path' }),
	withPermissionLevel(exec, 'exec'),
	withPermissionLevel(runJs, 'exec'),
	withPermissionLevel(runPy, 'exec'),
	withPermissionLevel(currentTime, 'read'),
	webSearchTool,
	withPermissionLevel(webFetch, 'network'),
	profileUpdate,
	memoryCreate,
	memoryRetrieve,
	memoryDelete,
	...skillTools,
] satisfies PermissionedTool[]
