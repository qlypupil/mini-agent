import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeDatabase } from '../storage/db'
import {
	createMemoryCreateTool,
	memoryCreateSchema,
} from './memory_create_tool'

interface MemoryRow {
	type: string
	content: string
	keywords: string | null
	importance: number
	session_id: string | null
}

function createDatabasePath(): string {
	return join(
		mkdtempSync(join(tmpdir(), 'termclaw-memory-tool-')),
		'memory.db',
	)
}

describe('memory_create tool', () => {
	it('creates a memory with the runtime thread ID and a compact result', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const memoryCreate = createMemoryCreateTool(databasePath)

		const result = await memoryCreate.invoke(
			{
				type: 'skill',
				content: '  用户正在长期学习 LangGraph。  ',
				keywords: ['LangGraph', 'AI Agent'],
				importance: 5,
			},
			{ configurable: { thread_id: 'runtime-thread' } },
		)

		expect(result).toBe('{"status":"created","id":1}')
		const database = new Database(databasePath, { readonly: true })
		try {
			const row = database
				.prepare('SELECT * FROM memory WHERE id = 1')
				.get() as MemoryRow

			expect(row).toMatchObject({
				type: 'skill',
				content: '用户正在长期学习 LangGraph。',
				keywords: JSON.stringify(['LangGraph', 'AI Agent']),
				importance: 5,
				session_id: 'runtime-thread',
			})
		} finally {
			database.close()
		}
	})

	it('rejects calls without a non-empty runtime thread ID', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const memoryCreate = createMemoryCreateTool(databasePath)
		const input = {
			type: 'fact' as const,
			content: '用户是一名技术写作者。',
		}

		await expect(memoryCreate.invoke(input, {})).rejects.toThrow(
			'memory_create requires a non-empty configurable.thread_id.',
		)
		await expect(
			memoryCreate.invoke(input, { configurable: { thread_id: '   ' } }),
		).rejects.toThrow(
			'memory_create requires a non-empty configurable.thread_id.',
		)

		const database = new Database(databasePath, { readonly: true })
		try {
			const row = database.prepare('SELECT COUNT(*) AS count FROM memory').get()
			expect(row).toEqual({ count: 0 })
		} finally {
			database.close()
		}
	})

	it('does not expose session_id in the model input schema', () => {
		expect(Object.keys(memoryCreateSchema.shape)).toEqual([
			'type',
			'content',
			'keywords',
			'importance',
		])
	})

	it.each([
		[{ type: 'unknown', content: 'content' }, 'type'],
		[{ type: 'fact', content: '   ' }, 'content'],
		[{ type: 'fact', content: 'content', importance: 0 }, 'importance'],
		[{ type: 'fact', content: 'content', importance: 6 }, 'importance'],
		[{ type: 'fact', content: 'content', keywords: Array(21).fill('tag') }, 'keywords'],
		[{ type: 'fact', content: 'content', keywords: ['x'.repeat(65)] }, 'keywords'],
	])('rejects invalid model input %# (%s)', (input, field) => {
		const result = memoryCreateSchema.safeParse(input)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.issues[0]?.path).toContain(field)
		}
	})
})
