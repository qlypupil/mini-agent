import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeDatabase } from '../storage/db'
import { createMemory } from '../storage/memory'
import {
	createMemoryDeleteTool,
	memoryDeleteSchema,
} from './memory_delete_tool'

function createDatabasePath(): string {
	return join(
		mkdtempSync(join(tmpdir(), 'termclaw-memory-delete-tool-')),
		'memory.db',
	)
}

describe('memory_delete tool', () => {
	it('deletes exactly one memory and returns a compact result', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const id = createMemory(
			{
				type: 'preference',
				content: '用户偏好芒果。',
				keywords: ['水果偏好', '芒果'],
				sessionId: 'source-thread',
			},
			databasePath,
		)
		const memoryDelete = createMemoryDeleteTool(databasePath)

		await expect(memoryDelete.invoke({ id })).resolves.toBe(
			`{"status":"deleted","id":${id}}`,
		)

		const database = new Database(databasePath, { readonly: true })
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
	})

	it('returns not_found when the memory ID does not exist', async () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const memoryDelete = createMemoryDeleteTool(databasePath)

		await expect(memoryDelete.invoke({ id: 42 })).resolves.toBe(
			'{"status":"not_found","id":42}',
		)
	})

	it('exposes only the exact memory ID in the model input schema', () => {
		expect(Object.keys(memoryDeleteSchema.shape)).toEqual(['id'])
	})

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid memory ID %s',
		(id) => {
			expect(memoryDeleteSchema.safeParse({ id }).success).toBe(false)
		},
	)
})
