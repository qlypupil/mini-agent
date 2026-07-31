import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeDatabase } from './db'
import { createMemory } from './memory'

interface MemoryRow {
	id: number
	type: string
	content: string
	keywords: string | null
	importance: number
	session_id: string | null
}

function createDatabasePath(): string {
	return join(
		mkdtempSync(join(tmpdir(), 'termclaw-memory-create-')),
		'memory.db',
	)
}

describe('createMemory', () => {
	it('stores all memory fields and returns the inserted ID', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const id = createMemory(
			{
				type: 'preference',
				content: '用户偏好 TypeScript 代码不使用 any 类型。',
				keywords: ['TypeScript', 'coding preference'],
				importance: 4,
				sessionId: 'session-1',
			},
			databasePath,
		)

		const database = new Database(databasePath, { readonly: true })
		try {
			const row = database
				.prepare('SELECT * FROM memory WHERE id = ?')
				.get(id) as MemoryRow

			expect(row).toMatchObject({
				id,
				type: 'preference',
				content: '用户偏好 TypeScript 代码不使用 any 类型。',
				keywords: JSON.stringify(['TypeScript', 'coding preference']),
				importance: 4,
				session_id: 'session-1',
			})
			expect(JSON.parse(row.keywords ?? 'null')).toEqual([
				'TypeScript',
				'coding preference',
			])
		} finally {
			database.close()
		}
	})

	it('stores NULL keywords and the default importance', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const id = createMemory(
			{
				type: 'fact',
				content: '用户是一名技术写作者。',
				sessionId: 'session-2',
			},
			databasePath,
		)

		const database = new Database(databasePath, { readonly: true })
		try {
			const row = database
				.prepare('SELECT * FROM memory WHERE id = ?')
				.get(id) as MemoryRow

			expect(row.keywords).toBeNull()
			expect(row.importance).toBe(3)
		} finally {
			database.close()
		}
	})

	it('throws when the memory table is unavailable', () => {
		const databasePath = createDatabasePath()

		expect(() =>
			createMemory(
				{
					type: 'fact',
					content: '无法写入的记忆。',
					sessionId: 'session-3',
				},
				databasePath,
			),
		).toThrow('no such table: memory')
	})
})
