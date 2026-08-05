import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	ToolMessage,
} from '@langchain/core/messages'
import { fakeModel } from '@langchain/core/testing'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { Command, isInterrupted } from '@langchain/langgraph'
import { z } from 'zod'
import {
	createChatGraph,
	type ToolApprovalDecision,
	type ToolApprovalInterrupt,
	type ToolApprovalRequest,
	type ToolApprovalResume,
} from './graph'
import * as toolOutput from './tool_output'
import { createCheckpointer } from '../storage/checkpointer'
import { initializeDatabase } from '../storage/db'
import { createMemory } from '../storage/memory'
import { createMemoryCreateTool } from '../tools/memory_create_tool'
import { createMemoryDeleteTool } from '../tools/memory_delete_tool'
import { createMemoryRetrieveTool } from '../tools/memory_retrieve_tool'
import { createProfileUpdateTool } from '../tools/profile_update_tool'
import {
	type PermissionedTool,
	withPermissionLevel,
} from '../permission'
import Database from 'better-sqlite3'

function createTestGraph(
	model = fakeModel(),
	testTools: StructuredToolInterface[] = [],
	projectRoot = process.cwd(),
) {
	const databasePath = join(
		mkdtempSync(join(tmpdir(), 'termclaw-chat-graph-')),
		'checkpointer.db',
	)
	const checkpointer = createCheckpointer(databasePath)
	const permissionedTools = testTools.map((testTool) =>
		'permission_level' in testTool
			? testTool as PermissionedTool
			: withPermissionLevel(testTool, 'exec'),
	)
	const graph = createChatGraph({
		model,
		tools: permissionedTools,
		systemPrompt: 'system prompt',
		checkpointer,
		projectRoot,
	})

	return { graph, checkpointer }
}

async function invokeWithToolApprovals(
	graph: any,
	input: unknown,
	config: Record<string, unknown>,
	decide: (
		requests: ToolApprovalRequest[],
		round: number,
	) => ToolApprovalDecision[] = (requests) =>
		requests.map(() => ({ type: 'approve' })),
): Promise<any> {
	let result = await graph.invoke(input, config)
	let round = 0

	while (isInterrupted<ToolApprovalInterrupt>(result)) {
		const value = result.__interrupt__[0]?.value
		if (!value || value.type !== 'tool_approval') {
			throw new Error('Expected a tool approval interrupt.')
		}
		result = await graph.invoke(
			new Command<ToolApprovalResume>({
				resume: { decisions: decide(value.requests, round) },
			}),
			config,
		)
		round += 1
	}

	return result
}

describe('custom chat graph', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('uses the model supplied in runtime context for the current request', async () => {
		const defaultModel = fakeModel().respond(new AIMessage('default'))
		const runtimeModel = fakeModel().respond(new AIMessage('runtime'))
		const { graph, checkpointer } = createTestGraph(defaultModel)

		const result = await graph.invoke(
			{ messages: [new HumanMessage('hello')] },
			{
				configurable: { thread_id: 'runtime-model-thread' },
				context: {
					model: runtimeModel,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(defaultModel.callCount).toBe(0)
		expect(runtimeModel.callCount).toBe(1)
		expect(result.messages.at(-1)?.content).toBe('runtime')
		checkpointer.db.close()
	})

	it('uses a one-shot Context patch without replacing persisted history', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'once-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'old-message', content: '原文' })],
		})

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: '继续' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: {
						mode: 'once' as const,
						patch: {
							operations: [
								{
									type: 'replace' as const,
									messageId: 'old-message',
									content: 'English text',
								},
							],
						},
					},
					contextCompression: {
						summary: 'stale automatic summary',
						compressedMessageIds: ['old-message'],
						compressionCount: 1,
						updatedAt: '2026-07-29T00:00:00.000Z',
					},
				},
			},
		)

		expect(model.calls[0].messages.map((message) => message.content)).toEqual([
			'system prompt',
			'English text',
			'继续',
		])
		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			'原文',
			'继续',
			'done',
		])
		checkpointer.db.close()
	})

	it('persists a Context patch before the model request', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'persist-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'old-message', content: '原文' })],
		})

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: '继续' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: {
						mode: 'persist' as const,
						patch: {
							operations: [
								{
									type: 'replace' as const,
									messageId: 'old-message',
									content: 'English text',
								},
							],
						},
					},
					contextCompression: undefined,
				},
			},
		)

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			'English text',
			'继续',
			'done',
		])
		checkpointer.db.close()
	})

	it('uses automatic compression without replacing checkpointed history', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'compression-thread' } }
		const history = Array.from({ length: 8 }, (_, index) =>
			index % 2 === 0
				? new HumanMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` })
				: new AIMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` }),
		)
		await graph.updateState(config, { messages: history })

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: 'continue' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: {
						summary: 'compressed history',
						compressedMessageIds: ['message-1', 'message-2'],
						compressionCount: 1,
						updatedAt: '2026-07-29T00:00:00.000Z',
					},
				},
			},
		)

		const modelContents = model.calls[0].messages.map((message) => message.content)
		expect(modelContents).toContain(
			'Conversation summary (automatically compressed):\ncompressed history',
		)
		expect(modelContents).not.toContain('content-1')
		expect(modelContents).not.toContain('content-2')
		expect(modelContents).toContain('content-3')
		expect(modelContents).toContain('continue')

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages.map((message: BaseMessage) => message.content)).toEqual([
			...history.map((message) => message.content),
			'continue',
			'done',
		])
		checkpointer.db.close()
	})

	it('caps model input at 300 messages without trimming checkpointed history', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'message-cap-thread' } }
		const history = Array.from({ length: 301 }, (_, index) =>
			index % 2 === 0
				? new HumanMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` })
				: new AIMessage({ id: `message-${index + 1}`, content: `content-${index + 1}` }),
		)
		await graph.updateState(config, { messages: history })

		await graph.invoke(
			{ messages: [new HumanMessage({ id: 'current-message', content: 'continue' })] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(model.calls[0].messages).toHaveLength(301)
		expect(model.calls[0].messages[0].content).toBe('system prompt')
		expect(model.calls[0].messages[1].content).toBe('content-3')
		expect(model.calls[0].messages.at(-1)?.content).toBe('continue')

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages).toHaveLength(303)
		expect(snapshot.values.messages[0].content).toBe('content-1')
		checkpointer.db.close()
	})

	it('simplifies historical tool results only for the model request', async () => {
		const model = fakeModel().respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model)
		const config = { configurable: { thread_id: 'tool-history-thread' } }
		const history: BaseMessage[] = [new HumanMessage('start')]

		for (let index = 1; index <= 4; index += 1) {
			history.push(
				new AIMessage({
					id: `tool-call-${index}`,
					content: '',
					tool_calls: [
						{
							id: `call-${index}`,
							name: `tool_${index}`,
							args: {},
							type: 'tool_call',
						},
					],
				}),
				new ToolMessage({
					id: `tool-result-${index}`,
					content: `original-result-${index}`,
					tool_call_id: `call-${index}`,
					name: `tool_${index}`,
				}),
				new AIMessage({
					id: `tool-answer-${index}`,
					content: `answer-${index}`,
				}),
			)
		}
		await graph.updateState(config, { messages: history })

		await graph.invoke(
			{ messages: [new HumanMessage('continue')] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const projectedToolResult = model.calls[0].messages.find(
			(message) => message.id === 'tool-result-1',
		)
		expect(projectedToolResult?.content).toBe('[Previous: used tool_1]')

		const snapshot = await graph.getState(config)
		const persistedToolResult = snapshot.values.messages.find(
			(message: BaseMessage) => message.id === 'tool-result-1',
		)
		expect(persistedToolResult?.content).toBe('original-result-1')
		checkpointer.db.close()
	})

	it('interrupts before execution and exposes trusted tool details', async () => {
		const execute = jest.fn(({ text }: { text: string }) => `echo:${text}`)
		const echo = withPermissionLevel(tool(execute, {
			name: 'echo',
			description: 'Echo text.',
			schema: z.object({ text: z.string() }),
		}), 'exec')
		const model = fakeModel().respondWithTools([
			{ id: 'call-1', name: 'echo', args: { text: 'hello' } },
		])
		const { graph, checkpointer } = createTestGraph(model, [echo])
		const result = await graph.invoke(
			{ messages: [new HumanMessage('use the tool')] },
			{
				configurable: { thread_id: 'approval-interrupt-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(execute).not.toHaveBeenCalled()
		expect(model.callCount).toBe(1)
		expect(isInterrupted<ToolApprovalInterrupt>(result)).toBe(true)
		if (isInterrupted<ToolApprovalInterrupt>(result)) {
			expect(result.__interrupt__[0]?.value).toEqual({
				type: 'tool_approval',
				requests: [
					{
						id: 'call-1',
						name: 'echo',
						args: { text: 'hello' },
						permissionLevel: 'exec',
					},
				],
			})
		}
		checkpointer.db.close()
	})

	it('executes a statically safe exec command without confirmation', async () => {
		const execute = jest.fn(({ command }: { command: string }) => command)
		const exec = withPermissionLevel(tool(execute, {
			name: 'exec',
			description: 'Execute a shell command.',
			schema: z.object({ command: z.string() }),
		}), 'exec')
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'call-safe-exec',
					name: 'exec',
					args: { command: 'pwd && git status --short' },
				},
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model, [exec])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('inspect the project')] },
			{
				configurable: { thread_id: 'safe-exec-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).toHaveBeenCalledTimes(1)
		expect(execute.mock.calls[0]?.[0]).toEqual({
			command: 'pwd && git status --short',
		})
		expect(log).toHaveBeenCalledWith('[Tool] exec')
		expect(result.messages.at(-1)?.content).toBe('done')
		checkpointer.db.close()
	})

	it('blocks an exec command that explicitly changes directories', async () => {
		const execute = jest.fn(() => 'should not run')
		const exec = withPermissionLevel(tool(execute, {
			name: 'exec',
			description: 'Execute a shell command.',
			schema: z.object({ command: z.string() }),
		}), 'exec')
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'call-directory-change',
					name: 'exec',
					args: { command: 'cd /tmp && pwd' },
				},
			])
			.respond(new AIMessage('blocked'))
		const { graph, checkpointer } = createTestGraph(model, [exec])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('change directories')] },
			{
				configurable: { thread_id: 'exec-directory-change-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).not.toHaveBeenCalled()
		expect(log).not.toHaveBeenCalledWith('[Tool] exec')
		expect(model.calls[1].messages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					tool_call_id: 'call-directory-change',
					status: 'error',
					content: expect.stringContaining('change the working directory'),
				}),
			]),
		)
		expect(result.messages.at(-1)?.content).toBe('blocked')
		checkpointer.db.close()
	})

	it('blocks language execution through exec with category-specific guidance', async () => {
		const execute = jest.fn(() => 'should not run')
		const exec = withPermissionLevel(tool(execute, {
			name: 'exec',
			description: 'Execute a shell command.',
			schema: z.object({ command: z.string() }),
		}), 'exec')
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'call-python',
					name: 'exec',
					args: { command: 'python script.py' },
				},
				{
					id: 'call-javascript',
					name: 'exec',
					args: { command: 'node script.js' },
				},
				{
					id: 'call-other-language',
					name: 'exec',
					args: { command: 'go run main.go' },
				},
			])
			.respond(new AIMessage('blocked'))
		const { graph, checkpointer } = createTestGraph(model, [exec])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('run language scripts')] },
			{
				configurable: { thread_id: 'exec-language-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).not.toHaveBeenCalled()
		expect(log).not.toHaveBeenCalledWith('[Tool] exec')
		const toolMessages = model.calls[1].messages.filter(ToolMessage.isInstance)
		expect(toolMessages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					tool_call_id: 'call-python',
					status: 'error',
					content: expect.stringContaining('run_py'),
				}),
				expect.objectContaining({
					tool_call_id: 'call-javascript',
					status: 'error',
					content: expect.stringContaining('run_js'),
				}),
				expect.objectContaining({
					tool_call_id: 'call-other-language',
					status: 'error',
					content: expect.stringContaining('shell commands and shell scripts'),
				}),
			]),
		)
		expect(result.messages.at(-1)?.content).toBe('blocked')
		checkpointer.db.close()
	})

	it('blocks dangerous exec operations with category-specific guidance', async () => {
		const execute = jest.fn(() => 'should not run')
		const exec = withPermissionLevel(tool(execute, {
			name: 'exec',
			description: 'Execute a shell command.',
			schema: z.object({ command: z.string() }),
		}), 'exec')
		const blockedCommands = [
			{
				id: 'call-privilege',
				command: 'sudo ls',
				message: 'elevated privileges',
			},
			{
				id: 'call-delete',
				command: 'rm notes.txt',
				message: 'delete files or directories',
			},
			{
				id: 'call-modify',
				command: 'cp source.txt target.txt',
				message: 'modify files or directories',
			},
			{
				id: 'call-permission',
				command: 'chmod 600 notes.txt',
				message: 'change file or directory permissions',
			},
			{
				id: 'call-process',
				command: 'kill 123',
				message: 'control processes or services',
			},
			{
				id: 'call-user',
				command: 'passwd pupil',
				message: 'modify user or group accounts',
			},
			{
				id: 'call-sensitive',
				command: 'printenv',
				message: 'access sensitive local information',
			},
			{
				id: 'call-network',
				command: 'curl https://example.com',
				message: 'network access or remote control',
			},
		]
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools(blockedCommands.map(({ id, command }) => ({
				id,
				name: 'exec',
				args: { command },
			})))
			.respond(new AIMessage('blocked'))
		const { graph, checkpointer } = createTestGraph(model, [exec])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('run dangerous commands')] },
			{
				configurable: { thread_id: 'exec-dangerous-operation-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).not.toHaveBeenCalled()
		expect(log).not.toHaveBeenCalledWith('[Tool] exec')
		const toolMessages = model.calls[1].messages.filter(ToolMessage.isInstance)
		for (const blockedCommand of blockedCommands) {
			expect(toolMessages).toEqual(expect.arrayContaining([
				expect.objectContaining({
					tool_call_id: blockedCommand.id,
					status: 'error',
					content: expect.stringContaining(blockedCommand.message),
				}),
			]))
		}
		expect(result.messages.at(-1)?.content).toBe('blocked')
		checkpointer.db.close()
	})

	it('executes read or write tools without a file path without confirmation', async () => {
		const execute = jest.fn(() => 'current value')
		const readWithoutPath = withPermissionLevel(tool(execute, {
			name: 'read_without_path',
			description: 'Read a value without a file path.',
			schema: z.object({}),
		}), 'read')
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-read', name: 'read_without_path', args: {} },
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model, [readWithoutPath])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('read it')] },
			{
				configurable: { thread_id: 'read-without-path-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).toHaveBeenCalledTimes(1)
		expect(result.messages.at(-1)?.content).toBe('done')
		checkpointer.db.close()
	})

	it('executes network tools without a URL or with a safe URL without confirmation', async () => {
		const search = jest.fn(() => 'search result')
		const fetch = jest.fn(() => 'fetch result')
		const webSearch = withPermissionLevel(tool(search, {
			name: 'web_search',
			description: 'Search the web.',
			schema: z.object({ query: z.string() }),
		}), 'network')
		const webFetch = withPermissionLevel(tool(fetch, {
			name: 'web_fetch',
			description: 'Fetch a URL.',
			schema: z.object({ url: z.string() }),
		}), 'network')
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-search', name: 'web_search', args: { query: 'news' } },
				{
					id: 'call-safe-fetch',
					name: 'web_fetch',
					args: { url: 'https://docs.github.com/en' },
				},
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model, [webSearch, webFetch])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('search and fetch')] },
			{
				configurable: { thread_id: 'safe-network-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(search).toHaveBeenCalledTimes(1)
		expect(fetch).toHaveBeenCalledTimes(1)
		expect(result.messages.at(-1)?.content).toBe('done')
		checkpointer.db.close()
	})

	it('asks for confirmation before fetching an unlisted domain', async () => {
		const fetch = jest.fn(() => 'fetch result')
		const webFetch = withPermissionLevel(tool(fetch, {
			name: 'web_fetch',
			description: 'Fetch a URL.',
			schema: z.object({ url: z.string() }),
		}), 'network')
		const model = fakeModel().respondWithTools([
			{
				id: 'call-unsafe-fetch',
				name: 'web_fetch',
				args: { url: 'https://example.com' },
			},
		])
		const { graph, checkpointer } = createTestGraph(model, [webFetch])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('fetch it')] },
			{
				configurable: { thread_id: 'unlisted-network-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(fetch).not.toHaveBeenCalled()
		expect(isInterrupted<ToolApprovalInterrupt>(result)).toBe(true)
		if (isInterrupted<ToolApprovalInterrupt>(result)) {
			expect(result.__interrupt__[0]?.value?.requests).toEqual([
				{
					id: 'call-unsafe-fetch',
					name: 'web_fetch',
					args: { url: 'https://example.com' },
					permissionLevel: 'network',
				},
			])
		}
		checkpointer.db.close()
	})

	it('executes tools without a specialized permission check without confirmation', async () => {
		const execute = jest.fn(() => 'database result')
		const log = jest.spyOn(console, 'log').mockImplementation()
		const databaseTool = withPermissionLevel(tool(execute, {
			name: 'database_tool',
			description: 'Access the database.',
			schema: z.object({ value: z.string() }),
		}), 'db')
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'call-database',
					name: 'database_tool',
					args: { value: 'stored value' },
				},
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model, [databaseTool])

		const result = await graph.invoke(
			{ messages: [new HumanMessage('use the database')] },
			{
				configurable: { thread_id: 'default-allow-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(isInterrupted(result)).toBe(false)
		expect(execute).toHaveBeenCalledTimes(1)
		expect(log).toHaveBeenCalledWith('[Tool] database_tool')
		expect(result.messages.at(-1)?.content).toBe('done')
		checkpointer.db.close()
	})

	it('executes ordinary project file calls without confirmation', async () => {
		const projectRoot = mkdtempSync(join(process.cwd(), '.graph-path-project-'))
		const filePath = join(projectRoot, 'notes.txt')
		writeFileSync(filePath, 'notes', 'utf8')
		const execute = jest.fn(() => 'notes')
		const readProjectFile = withPermissionLevel(tool(execute, {
			name: 'read_project_file',
			description: 'Read a project file.',
			schema: z.object({ path: z.string() }),
		}), 'read', { filePathArg: 'path' })
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-project', name: 'read_project_file', args: { path: filePath } },
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(
			model,
			[readProjectFile],
			projectRoot,
		)

		try {
			const result = await graph.invoke(
				{ messages: [new HumanMessage('read it')] },
				{
					configurable: { thread_id: 'project-file-thread' },
					context: {
						model: undefined,
						contextControl: undefined,
						contextCompression: undefined,
					},
				},
			)

			expect(isInterrupted(result)).toBe(false)
			expect(execute).toHaveBeenCalledTimes(1)
		} finally {
			checkpointer.db.close()
			rmSync(projectRoot, { recursive: true, force: true })
		}
	})

	it('executes ordinary external read calls without confirmation', async () => {
		const outsideRoot = mkdtempSync(join(tmpdir(), 'termclaw-graph-read-path-'))
		const filePath = join(outsideRoot, 'notes.txt')
		writeFileSync(filePath, 'notes', 'utf8')
		const execute = jest.fn(() => 'notes')
		const readExternalFile = withPermissionLevel(tool(execute, {
			name: 'read_external_file',
			description: 'Read an external file.',
			schema: z.object({ path: z.string() }),
		}), 'read', { filePathArg: 'path' })
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-external-read', name: 'read_external_file', args: { path: filePath } },
			])
			.respond(new AIMessage('done'))
		const { graph, checkpointer } = createTestGraph(model, [readExternalFile])

		try {
			const result = await graph.invoke(
				{ messages: [new HumanMessage('read it')] },
				{
					configurable: { thread_id: 'external-read-thread' },
					context: {
						model: undefined,
						contextControl: undefined,
						contextCompression: undefined,
					},
				},
			)

			expect(isInterrupted(result)).toBe(false)
			expect(execute).toHaveBeenCalledTimes(1)
		} finally {
			checkpointer.db.close()
			rmSync(outsideRoot, { recursive: true, force: true })
		}
	})

	it('blocks a protected file path without asking for confirmation', async () => {
		const projectRoot = mkdtempSync(join(process.cwd(), '.graph-protected-path-'))
		const execute = jest.fn(() => 'should not run')
		const writeProtectedFile = withPermissionLevel(tool(execute, {
			name: 'write_protected_file',
			description: 'Write a protected file.',
			schema: z.object({ path: z.string() }),
		}), 'write', { filePathArg: 'path' })
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'call-protected',
					name: 'write_protected_file',
					args: { path: join(projectRoot, '.env') },
				},
			])
			.respond(new AIMessage('blocked'))
		const { graph, checkpointer } = createTestGraph(
			model,
			[writeProtectedFile],
			projectRoot,
		)

		try {
			const result = await graph.invoke(
				{ messages: [new HumanMessage('write it')] },
				{
					configurable: { thread_id: 'protected-file-thread' },
					context: {
						model: undefined,
						contextControl: undefined,
						contextCompression: undefined,
					},
				},
			)

			expect(isInterrupted(result)).toBe(false)
			expect(execute).not.toHaveBeenCalled()
			expect(log).not.toHaveBeenCalledWith('[Tool] write_protected_file')
			expect(model.calls[1].messages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						tool_call_id: 'call-protected',
						status: 'error',
						content: expect.stringContaining('protected'),
					}),
				]),
			)
		} finally {
			checkpointer.db.close()
			rmSync(projectRoot, { recursive: true, force: true })
		}
	})

	it('asks only for external safe writes when authorization actions are mixed', async () => {
		const projectRoot = mkdtempSync(join(process.cwd(), '.graph-mixed-paths-'))
		const outsideRoot = mkdtempSync(join(tmpdir(), 'termclaw-graph-mixed-paths-'))
		const executeAllowed = jest.fn(() => 'allowed')
		const executeBlocked = jest.fn(() => 'blocked')
		const executeExternal = jest.fn(() => 'external')
		const allowedTool = withPermissionLevel(tool(executeAllowed, {
			name: 'allowed_read',
			description: 'Read without a file path.',
			schema: z.object({}),
		}), 'read')
		const blockedTool = withPermissionLevel(tool(executeBlocked, {
			name: 'blocked_write',
			description: 'Write a protected file.',
			schema: z.object({ path: z.string() }),
		}), 'write', { filePathArg: 'path' })
		const externalTool = withPermissionLevel(tool(executeExternal, {
			name: 'external_write',
			description: 'Write an external file.',
			schema: z.object({ path: z.string() }),
		}), 'write', { filePathArg: 'path' })
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-allowed', name: 'allowed_read', args: {} },
				{
					id: 'call-blocked',
					name: 'blocked_write',
					args: { path: join(projectRoot, '.env') },
				},
				{
					id: 'call-external',
					name: 'external_write',
					args: { path: join(outsideRoot, 'notes.txt') },
				},
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(
			model,
			[allowedTool, blockedTool, externalTool],
			projectRoot,
		)
		const config = {
			configurable: { thread_id: 'mixed-path-authorization-thread' },
			context: {
				model: undefined,
				contextControl: undefined,
				contextCompression: undefined,
			},
		}

		try {
			const interrupted = await graph.invoke(
				{ messages: [new HumanMessage('use all tools')] },
				config,
			)
			expect(executeAllowed).not.toHaveBeenCalled()
			expect(executeBlocked).not.toHaveBeenCalled()
			expect(executeExternal).not.toHaveBeenCalled()
			expect(isInterrupted<ToolApprovalInterrupt>(interrupted)).toBe(true)
			if (!isInterrupted<ToolApprovalInterrupt>(interrupted)) {
				throw new Error('Expected a tool approval interrupt.')
			}
			expect(interrupted.__interrupt__[0]?.value?.requests).toEqual([
				expect.objectContaining({
					id: 'call-external',
					name: 'external_write',
					permissionLevel: 'write',
				}),
			])

			await graph.invoke(
				new Command<ToolApprovalResume>({
					resume: { decisions: [{ type: 'approve' }] },
				}) as any,
				config,
			)

			expect(executeAllowed).toHaveBeenCalledTimes(1)
			expect(executeBlocked).not.toHaveBeenCalled()
			expect(executeExternal).toHaveBeenCalledTimes(1)
			const toolMessages = model.calls[1].messages.filter((message) =>
				ToolMessage.isInstance(message),
			) as ToolMessage[]
			expect(toolMessages).toHaveLength(3)
			expect(toolMessages).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ tool_call_id: 'call-allowed' }),
					expect.objectContaining({
						tool_call_id: 'call-blocked',
						status: 'error',
					}),
					expect.objectContaining({ tool_call_id: 'call-external' }),
				]),
			)
		} finally {
			checkpointer.db.close()
			rmSync(projectRoot, { recursive: true, force: true })
			rmSync(outsideRoot, { recursive: true, force: true })
		}
	})

	it('returns a rejected tool call to the model without executing it', async () => {
		const execute = jest.fn(() => 'should not run')
		const rejectedTool = tool(execute, {
			name: 'rejected_tool',
			description: 'Must be rejected.',
			schema: z.object({}),
		})
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-rejected', name: 'rejected_tool', args: {} },
			])
			.respond(new AIMessage('The tool was not executed.'))
		const { graph, checkpointer } = createTestGraph(model, [rejectedTool])
		const config = {
			configurable: { thread_id: 'rejected-tool-thread' },
			context: {
				model: undefined,
				contextControl: undefined,
				contextCompression: undefined,
			},
		}

		const result = await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('use the tool')] },
			config,
			(requests) => requests.map(() => ({ type: 'reject' })),
		)

		expect(execute).not.toHaveBeenCalled()
		expect(log).not.toHaveBeenCalledWith('[Tool] rejected_tool')
		expect(model.callCount).toBe(2)
		const rejectedMessage = model.calls[1].messages.find(
			(message) => ToolMessage.isInstance(message),
		)
		expect(rejectedMessage).toMatchObject({
			name: 'rejected_tool',
			tool_call_id: 'call-rejected',
			status: 'error',
			content: expect.stringContaining('was not executed'),
		})
		expect(result.messages.at(-1)?.content).toBe('The tool was not executed.')
		checkpointer.db.close()
	})

	it('executes only approved calls when decisions are mixed', async () => {
		const executeApproved = jest.fn(() => 'approved result')
		const executeRejected = jest.fn(() => 'rejected result')
		const approvedTool = tool(executeApproved, {
			name: 'approved_tool',
			description: 'Approved tool.',
			schema: z.object({}),
		})
		const rejectedTool = tool(executeRejected, {
			name: 'rejected_tool',
			description: 'Rejected tool.',
			schema: z.object({}),
		})
		const log = jest.spyOn(console, 'log').mockImplementation()
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-approved', name: 'approved_tool', args: {} },
				{ id: 'call-rejected', name: 'rejected_tool', args: {} },
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(model, [
			approvedTool,
			rejectedTool,
		])

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('use both tools')] },
			{
				configurable: { thread_id: 'mixed-tool-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
			() => [{ type: 'approve' }, { type: 'reject' }],
		)

		expect(executeApproved).toHaveBeenCalledTimes(1)
		expect(executeRejected).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledWith('[Tool] approved_tool')
		expect(log).not.toHaveBeenCalledWith('[Tool] rejected_tool')
		const toolMessages = model.calls[1].messages.filter((message) =>
			ToolMessage.isInstance(message),
		) as ToolMessage[]
		expect(toolMessages).toHaveLength(2)
		expect(toolMessages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					tool_call_id: 'call-approved',
					status: 'success',
				}),
				expect.objectContaining({
					tool_call_id: 'call-rejected',
					status: 'error',
				}),
			]),
		)
		checkpointer.db.close()
	})

	it('rejects a resume response with the wrong number of decisions', async () => {
		const execute = jest.fn(() => 'result')
		const echo = tool(execute, {
			name: 'echo',
			description: 'Echo.',
			schema: z.object({}),
		})
		const model = fakeModel().respondWithTools([
			{ id: 'call-1', name: 'echo', args: {} },
		])
		const { graph, checkpointer } = createTestGraph(model, [echo])
		const config = {
			configurable: { thread_id: 'invalid-approval-thread' },
			context: {
				model: undefined,
				contextControl: undefined,
				contextCompression: undefined,
			},
		}

		await graph.invoke(
			{ messages: [new HumanMessage('use the tool')] },
			config,
		)
		await expect(
			graph.invoke(
				new Command<ToolApprovalResume>({
					resume: { decisions: [] },
				}) as any,
				config,
			),
		).rejects.toThrow('expected 1 decisions, received 0')
		expect(execute).not.toHaveBeenCalled()
		checkpointer.db.close()
	})

	it('returns tool results to the model through the tools node', async () => {
		const callOrder: string[] = []
		const log = jest.spyOn(console, 'log').mockImplementation((message) => {
			callOrder.push(String(message))
		})
		const echo = tool(({ text }: { text: string }) => {
			callOrder.push('executed')
			return `echo:${text}`
		}, {
			name: 'echo',
			description: 'Echo text.',
			schema: z.object({ text: z.string() }),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-1', name: 'echo', args: { text: 'hello' } },
			])
			.respond(new AIMessage('final'))
		const { graph, checkpointer } = createTestGraph(model, [echo])

		const result = await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('use the tool')] },
			{
					configurable: { thread_id: 'tool-thread' },
					context: {
						model: undefined,
						contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(model.callCount).toBe(2)
		expect(model.calls[1].messages.some((message) => message.getType() === 'tool')).toBe(true)
		expect(result.messages.at(-1)?.content).toBe('final')
		expect(log).toHaveBeenCalledWith('[Tool] echo')
		expect(callOrder).toEqual(['[Tool] echo', 'executed'])
		checkpointer.db.close()
	})

	it('updates the complete profile without rewriting existing history', async () => {
		const profileRoot = mkdtempSync(join(process.cwd(), '.profile-graph-'))
		const profileFilePath = join(profileRoot, '.data/profile.md')
		const oldProfile = '## 基本身份\n\n- 姓名：Pupil\n'
		const updatedProfile = `${oldProfile}\n## 技能\n\n- TypeScript`
		mkdirSync(dirname(profileFilePath), { recursive: true })
		writeFileSync(profileFilePath, oldProfile, 'utf8')
		const profileUpdate = createProfileUpdateTool(profileFilePath)
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'profile-update-call-1',
					name: 'profile_update',
					args: { content: updatedProfile },
				},
			])
			.respond(new AIMessage('已更新用户画像。'))
		const { graph, checkpointer } = createTestGraph(model, [profileUpdate])
		const config = { configurable: { thread_id: 'profile-update-thread' } }

		try {
			await graph.updateState(config, {
				messages: [
					new HumanMessage({ id: 'existing-message', content: '已有历史' }),
				],
			})
			await invokeWithToolApprovals(
				graph,
				{ messages: [new HumanMessage('我还会 TypeScript')] },
				{
					...config,
					context: {
						model: undefined,
						contextControl: undefined,
						contextCompression: undefined,
					},
				},
			)

			expect(model.callCount).toBe(2)
			const toolMessage = model.calls[1].messages.find(
				(message) => message.getType() === 'tool',
			)
			expect(toolMessage).toMatchObject({
				name: 'profile_update',
				tool_call_id: 'profile-update-call-1',
			})
			const toolResult = JSON.parse(String(toolMessage?.content)) as {
				status: string
				backup: string
			}
			expect(toolResult.status).toBe('updated')
			expect(readFileSync(profileFilePath, 'utf8')).toBe(`${updatedProfile}\n`)
			expect(
				readFileSync(join(dirname(profileFilePath), toolResult.backup), 'utf8'),
			).toBe(oldProfile)
			expect(readdirSync(dirname(profileFilePath))).toHaveLength(2)

			const snapshot = await graph.getState(config)
			expect(snapshot.values.messages[0]).toMatchObject({
				id: 'existing-message',
				content: '已有历史',
			})
		} finally {
			checkpointer.db.close()
			rmSync(profileRoot, { recursive: true, force: true })
		}
	})

	it('passes the graph thread ID to memory_create without rewriting history', async () => {
		const memoryDatabasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-graph-memory-')),
			'memory.db',
		)
		initializeDatabase(memoryDatabasePath)
		const memoryCreate = createMemoryCreateTool(memoryDatabasePath)
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'memory-call-1',
					name: 'memory_create',
					args: {
						type: 'preference',
						content: '用户偏好简洁回答。',
						keywords: ['response style'],
						importance: 4,
					},
				},
			])
			.respond(new AIMessage('已记住。'))
		const { graph, checkpointer } = createTestGraph(model, [memoryCreate])
		const config = { configurable: { thread_id: 'memory-graph-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'existing-message', content: '已有历史' })],
		})

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('请记住我的回答偏好')] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const database = new Database(memoryDatabasePath, { readonly: true })
		try {
			const row = database
				.prepare('SELECT session_id FROM memory WHERE id = 1')
				.get()
			expect(row).toEqual({ session_id: 'memory-graph-thread' })
		} finally {
			database.close()
		}

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(toolMessage).toMatchObject({
			name: 'memory_create',
			tool_call_id: 'memory-call-1',
			content: '{"status":"created","id":1}',
		})
		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages[0]).toMatchObject({
			id: 'existing-message',
			content: '已有历史',
		})
		checkpointer.db.close()
	})

	it('retrieves long-term memory without modifying storage or rewriting history', async () => {
		const memoryDatabasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-graph-memory-retrieve-')),
			'memory.db',
		)
		initializeDatabase(memoryDatabasePath)
		const memoryId = createMemory(
			{
				type: 'preference',
				content: '用户偏好简洁回答。',
				keywords: ['回答偏好', '简洁'],
				importance: 4,
				sessionId: 'source-thread',
			},
			memoryDatabasePath,
		)
		const memoryRetrieve = createMemoryRetrieveTool(memoryDatabasePath)
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'memory-retrieve-call-1',
					name: 'memory_retrieve',
					args: { keywords: ['回答偏好', '简洁'] },
				},
			])
			.respond(new AIMessage('你偏好简洁回答。'))
		const { graph, checkpointer } = createTestGraph(model, [memoryRetrieve])
		const config = { configurable: { thread_id: 'retrieve-graph-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'existing-message', content: '已有历史' })],
		})

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('你记得我的回答偏好吗？')] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(toolMessage).toMatchObject({
			name: 'memory_retrieve',
			tool_call_id: 'memory-retrieve-call-1',
			content: expect.stringContaining('用户偏好简洁回答。'),
		})
		if (typeof toolMessage?.content === 'string') {
			expect(JSON.parse(toolMessage.content)).toMatchObject({
				status: 'found',
				memories: [{ id: memoryId }],
			})
		}

		const database = new Database(memoryDatabasePath, { readonly: true })
		try {
			expect(database.prepare('SELECT COUNT(*) AS count FROM memory').get()).toEqual({
				count: 1,
			})
			expect(
				database
					.prepare(
						'SELECT COUNT(*) AS count FROM memory_fts WHERE memory_fts MATCH ?',
					)
					.get('"回答偏好"'),
			).toEqual({ count: 1 })
		} finally {
			database.close()
		}

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages[0]).toMatchObject({
			id: 'existing-message',
			content: '已有历史',
		})
		checkpointer.db.close()
	})

	it('retrieves an exact memory ID before deleting it without rewriting history', async () => {
		const memoryDatabasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-graph-memory-delete-')),
			'memory.db',
		)
		initializeDatabase(memoryDatabasePath)
		const memoryId = createMemory(
			{
				type: 'preference',
				content: '用户偏好芒果。',
				keywords: ['水果偏好', '芒果'],
				sessionId: 'source-thread',
			},
			memoryDatabasePath,
		)
		const memoryRetrieve = createMemoryRetrieveTool(memoryDatabasePath)
		const memoryDelete = createMemoryDeleteTool(memoryDatabasePath)
		const model = fakeModel()
			.respondWithTools([
				{
					id: 'memory-retrieve-call-1',
					name: 'memory_retrieve',
					args: { keywords: ['水果偏好', '芒果'] },
				},
			])
			.respondWithTools([
				{
					id: 'memory-delete-call-1',
					name: 'memory_delete',
					args: { id: memoryId },
				},
			])
			.respond(new AIMessage('已删除这条记忆。'))
		const { graph, checkpointer } = createTestGraph(model, [
			memoryRetrieve,
			memoryDelete,
		])
		const config = { configurable: { thread_id: 'delete-graph-thread' } }
		await graph.updateState(config, {
			messages: [new HumanMessage({ id: 'existing-message', content: '已有历史' })],
		})

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('忘记我的水果偏好')] },
			{
				...config,
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		expect(model.callCount).toBe(3)
		const deleteToolMessage = model.calls[2].messages.find(
			(message) =>
				message.getType() === 'tool' &&
				(message as ToolMessage).name === 'memory_delete',
		)
		expect(deleteToolMessage).toMatchObject({
			name: 'memory_delete',
			tool_call_id: 'memory-delete-call-1',
			content: `{"status":"deleted","id":${memoryId}}`,
		})

		const database = new Database(memoryDatabasePath, { readonly: true })
		try {
			expect(database.prepare('SELECT COUNT(*) AS count FROM memory').get()).toEqual({
				count: 0,
			})
			expect(
				database
					.prepare(
						'SELECT COUNT(*) AS count FROM memory_fts WHERE memory_fts MATCH ?',
					)
					.get('芒果'),
			).toEqual({ count: 0 })
		} finally {
			database.close()
		}

		const snapshot = await graph.getState(config)
		expect(snapshot.values.messages[0]).toMatchObject({
			id: 'existing-message',
			content: '已有历史',
		})
		checkpointer.db.close()
	})

	it('returns thrown tool errors to the model with an error status', async () => {
		const failingTool = tool(async () => {
			throw new Error('tool failed')
		}, {
			name: 'failing_tool',
			description: 'Always fails.',
			schema: z.object({}),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-1', name: 'failing_tool', args: {} },
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(model, [failingTool])

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('use the tool')] },
			{
				configurable: { thread_id: 'failed-tool-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(toolMessage).toMatchObject({
			status: 'error',
			content: expect.stringContaining('tool failed'),
		})
		checkpointer.db.close()
	})

	it('returns processed tool output to the model', async () => {
		const processedContent = '<persisted-output>preview</persisted-output>'
		const persist = jest
			.spyOn(toolOutput, 'maybePersistToolMessages')
			.mockImplementation(async (messages) =>
				messages.map((message) =>
					ToolMessage.isInstance(message)
						? new ToolMessage({
							...message,
							content: processedContent,
						})
						: message,
				),
			)
		const largeOutput = tool(() => 'a'.repeat(50_001), {
			name: 'large_output',
			description: 'Returns a large output.',
			schema: z.object({}),
		})
		const model = fakeModel()
			.respondWithTools([
				{ id: 'call-large', name: 'large_output', args: {} },
			])
			.respond(new AIMessage('handled'))
		const { graph, checkpointer } = createTestGraph(model, [largeOutput])

		await invokeWithToolApprovals(
			graph,
			{ messages: [new HumanMessage('use the tool')] },
			{
				configurable: { thread_id: 'large-tool-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
			},
		)

		const toolMessage = model.calls[1].messages.find(
			(message) => message.getType() === 'tool',
		)
		expect(persist).toHaveBeenCalledTimes(1)
		expect(toolMessage?.content).toBe(processedContent)
		checkpointer.db.close()
	})

	it('keeps model and tool node names in message stream metadata', async () => {
		const model = fakeModel().respond(new AIMessage('streamed'))
		const { graph, checkpointer } = createTestGraph(model)
		const stream = await graph.stream(
			{ messages: [new HumanMessage('hello')] },
			{
				configurable: { thread_id: 'stream-thread' },
				context: {
					model: undefined,
					contextControl: undefined,
					contextCompression: undefined,
				},
				streamMode: 'messages',
			},
		)
		const nodeNames: string[] = []

		for await (const chunk of stream as any) {
			nodeNames.push(chunk[1]?.langgraph_node)
		}

		expect(nodeNames).toContain('model_request')
		checkpointer.db.close()
	})
})
