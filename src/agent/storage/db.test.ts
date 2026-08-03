import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initializeDatabase } from './db'

interface MemoryRow {
	id: number
	type: string
	content: string
	keywords: string | null
	importance: number
	session_id: string | null
	created_at: string
	updated_at: string
}

function createDatabasePath(): string {
	return join(
		mkdtempSync(join(tmpdir(), 'termclaw-memory-')),
		'memory.db',
	)
}

describe('initializeDatabase', () => {
	it('creates the memory tables and FTS triggers idempotently', () => {
		const databasePath = createDatabasePath()

		initializeDatabase(databasePath)
		initializeDatabase(databasePath)

		const database = new Database(databasePath, { readonly: true })
		try {
			const tables = database
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory', 'memory_fts') ORDER BY name",
				)
				.all()
			const triggers = database
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memory_fts_%' ORDER BY name",
				)
				.all()

			expect(tables).toEqual([
				{ name: 'memory' },
				{ name: 'memory_fts' },
			])
			expect(triggers).toEqual([
				{ name: 'memory_fts_after_delete' },
				{ name: 'memory_fts_after_insert' },
				{ name: 'memory_fts_after_update' },
			])
		} finally {
			database.close()
		}
	})

	it('keeps the FTS index synchronized with new memory changes', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const database = new Database(databasePath)
		const search = (query: string) =>
			database
				.prepare(
					'SELECT rowid AS id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rowid',
				)
				.all(query)

		try {
			const result = database
				.prepare(
					"INSERT INTO memory (type, content, keywords) VALUES ('preference', ?, ?)",
				)
				.run(
					'User prefers TypeScript for agent projects.',
					JSON.stringify(['TypeScript', 'agent development']),
				)
			const id = Number(result.lastInsertRowid)

			expect(search('TypeScript')).toEqual([{ id }])
			expect(search('development')).toEqual([{ id }])

			database
				.prepare('UPDATE memory SET content = ?, keywords = ? WHERE id = ?')
				.run(
					'User prefers Rust for systems projects.',
					JSON.stringify(['Rust', 'systems development']),
					id,
				)

			expect(search('TypeScript')).toEqual([])
			expect(search('Rust')).toEqual([{ id }])

			database.prepare('DELETE FROM memory WHERE id = ?').run(id)

			expect(search('Rust')).toEqual([])
		} finally {
			database.close()
		}
	})

	it('sets defaults and refreshes updated_at after memory changes', () => {
		const databasePath = createDatabasePath()
		initializeDatabase(databasePath)

		const database = new Database(databasePath)
		try {
			const result = database
				.prepare("INSERT INTO memory (type, content) VALUES ('fact', 'first')")
				.run()
			const id = Number(result.lastInsertRowid)
			const inserted = database
				.prepare('SELECT * FROM memory WHERE id = ?')
				.get(id) as MemoryRow

			expect(inserted.importance).toBe(3)
			expect(inserted.keywords).toBeNull()
			expect(inserted.session_id).toBeNull()
			expect(inserted.created_at).toBe(inserted.updated_at)

			database
				.prepare("UPDATE memory SET updated_at = '2000-01-01 00:00:00' WHERE id = ?")
				.run(id)
			database
				.prepare("UPDATE memory SET content = 'second' WHERE id = ?")
				.run(id)
			const updated = database
				.prepare('SELECT * FROM memory WHERE id = ?')
				.get(id) as MemoryRow

			expect(updated.content).toBe('second')
			expect(updated.updated_at).not.toBe('2000-01-01 00:00:00')
		} finally {
			database.close()
		}
	})
})
