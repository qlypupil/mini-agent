import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeDatabase } from '../storage/db'
import { createMemory } from '../storage/memory'
import {
	createMemoryRetrieveTool,
	memoryRetrieveSchema,
} from './memory_retrieve_tool'

function createDatabasePath(): string {
	return join(
		mkdtempSync(join(tmpdir(), 'termclaw-memory-retrieve-tool-')),
		'memory.db',
	)
}

describe('memory_retrieve tool', () => {
	it('returns relevant memories without internal fields', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const id = createMemory(
			{
				type: 'preference',
				content: '用户偏好简洁、结论先行的回答。',
				keywords: ['回答偏好', '简洁'],
				importance: 4,
				sessionId: 'private-session',
			},
			databasePath,
		)
		const memoryRetrieve = createMemoryRetrieveTool(databasePath)

		const rawResult = await memoryRetrieve.invoke({
			keywords: ['  回答偏好  ', '简洁'],
		})
		const result = JSON.parse(rawResult) as {
			status: string
			memories: Record<string, unknown>[]
		}

		expect(result.status).toBe('found')
		expect(result.memories).toEqual([
			{
				id,
				type: 'preference',
				content: '用户偏好简洁、结论先行的回答。',
				importance: 4,
				updated_at: expect.any(String),
			},
		])
		expect(rawResult).not.toContain('private-session')
		expect(rawResult).not.toContain('keywords')
		expect(rawResult).not.toContain('score')
	})

	it('returns a compact not_found result when nothing matches', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const memoryRetrieve = createMemoryRetrieveTool(databasePath)

		await expect(
			memoryRetrieve.invoke({ keywords: ['unknown topic'] }),
		).resolves.toBe('{"status":"not_found","memories":[]}')
	})

	it('exposes only keywords in the model input schema', () => {
		expect(Object.keys(memoryRetrieveSchema.shape)).toEqual(['keywords'])
	})

	it.each([
		[{ keywords: [] }, 'keywords'],
		[{ keywords: ['   '] }, 'keywords'],
		[{ keywords: Array(9).fill('tag') }, 'keywords'],
		[{ keywords: ['x'.repeat(65)] }, 'keywords'],
	])('rejects invalid model input %# (%s)', (input, field) => {
		const result = memoryRetrieveSchema.safeParse(input)
		expect(result.success).toBe(false)
		if (!result.success) {
			expect(result.error.issues[0]?.path).toContain(field)
		}
	})
})
