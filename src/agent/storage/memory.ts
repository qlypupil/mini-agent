import Database from 'better-sqlite3'
import { DB_PATH } from './db'

export type MemoryType = 'fact' | 'event' | 'preference' | 'skill'

export interface CreateMemoryInput {
	type: MemoryType
	content: string
	keywords?: string[]
	importance?: number
	sessionId: string
}

export function createMemory(
	input: CreateMemoryInput,
	databasePath = DB_PATH,
): number {
	const database = new Database(databasePath)

	try {
		const result = database
			.prepare(`
				INSERT INTO memory (
					type,
					content,
					keywords,
					importance,
					session_id
				) VALUES (?, ?, ?, ?, ?)
			`)
			.run(
				input.type,
				input.content,
				input.keywords === undefined ? null : JSON.stringify(input.keywords),
				input.importance ?? 3,
				input.sessionId,
			)

		return Number(result.lastInsertRowid)
	} finally {
		database.close()
	}
}
