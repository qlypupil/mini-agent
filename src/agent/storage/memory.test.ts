import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeDatabase } from './db'
import { createMemory, retrieveMemories } from './memory'

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

describe('retrieveMemories', () => {
	it('retrieves content and keyword matches with FTS relevance first', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const combinedMatchId = createMemory(
			{
				type: 'skill',
				content: 'User builds TypeScript agent projects.',
				keywords: ['TypeScript', 'agent development'],
				importance: 1,
				sessionId: 'session-1',
			},
			databasePath,
		)
		const singleMatchId = createMemory(
			{
				type: 'preference',
				content: 'User prefers TypeScript.',
				keywords: ['TypeScript'],
				importance: 5,
				sessionId: 'session-2',
			},
			databasePath,
		)
		const contentMatchId = createMemory(
			{
				type: 'preference',
				content: 'User prefers concise answers.',
				importance: 3,
				sessionId: 'session-3',
			},
			databasePath,
		)

		expect(
			retrieveMemories(
				['TypeScript', 'agent development'],
				databasePath,
			).map((memory) => memory.id),
		).toEqual([combinedMatchId, singleMatchId])
		expect(
			retrieveMemories(['concise'], databasePath).map(
				(memory) => memory.id,
			),
		).toEqual([contentMatchId])
	})

	it('quotes FTS operators and deduplicates equivalent keywords', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const exactPhraseId = createMemory(
			{
				type: 'preference',
				content: 'User has a specific language comparison preference.',
				keywords: ['TypeScript OR Rust', '他说"简洁"'],
				sessionId: 'session-1',
			},
			databasePath,
		)
		createMemory(
			{
				type: 'skill',
				content: 'User knows TypeScript.',
				keywords: ['TypeScript'],
				sessionId: 'session-2',
			},
			databasePath,
		)

		const results = retrieveMemories(
			['TypeScript OR Rust', 'typescript or rust', '他说"简洁"'],
			databasePath,
		)

		expect(results.map((memory) => memory.id)).toEqual([exactPhraseId])
	})

	it('uses importance and recency as tie-breakers and returns at most five rows', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		const ids = [1, 2, 3, 4, 5, 1].map((importance, index) =>
			createMemory(
				{
					type: 'fact',
					content: `Shared memory ${index + 1}.`,
					keywords: ['shared'],
					importance,
					sessionId: `session-${index + 1}`,
				},
				databasePath,
			),
		)
		const database = new Database(databasePath)
		try {
			database
				.prepare("UPDATE memory SET updated_at = '2020-01-01 00:00:00' WHERE id = ?")
				.run(ids[0])
			database
				.prepare("UPDATE memory SET updated_at = '2025-01-01 00:00:00' WHERE id = ?")
				.run(ids[5])
		} finally {
			database.close()
		}

		const results = retrieveMemories(['shared'], databasePath)

		expect(results.map((memory) => memory.id)).toEqual([
			ids[4],
			ids[3],
			ids[2],
			ids[1],
			ids[5],
		])
	})

	it('returns no rows for an unmatched or empty query', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)
		createMemory(
			{
				type: 'fact',
				content: 'User writes TypeScript.',
				sessionId: 'session-1',
			},
			databasePath,
		)

		expect(retrieveMemories(['Rust'], databasePath)).toEqual([])
		expect(retrieveMemories([' ', ''], databasePath)).toEqual([])
	})

	it('throws when the memory database is unavailable', () => {
		expect(() => retrieveMemories(['TypeScript'], createDatabasePath())).toThrow()
	})
})
