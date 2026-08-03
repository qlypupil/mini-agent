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

export interface RetrievedMemory {
	id: number
	type: MemoryType
	content: string
	importance: number
	updated_at: string
}

const MEMORY_RETRIEVE_LIMIT = 5

function buildMemoryFtsQuery(keywords: string[]): string {
	const seen = new Set<string>()
	const phrases: string[] = []

	for (const keyword of keywords) {
		const trimmedKeyword = keyword.trim()
		const normalizedKeyword = trimmedKeyword.toLowerCase()

		if (!trimmedKeyword || seen.has(normalizedKeyword)) continue

		seen.add(normalizedKeyword)
		phrases.push(`"${trimmedKeyword.replaceAll('"', '""')}"`)
	}

	return phrases.join(' OR ')
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

export function retrieveMemories(
	keywords: string[],
	databasePath = DB_PATH,
): RetrievedMemory[] {
	const ftsQuery = buildMemoryFtsQuery(keywords)
	if (!ftsQuery) return []

	const database = new Database(databasePath, {
		readonly: true,
		fileMustExist: true,
	})

	try {
		return database
			.prepare(`
				SELECT
					memory.id,
					memory.type,
					memory.content,
					memory.importance,
					memory.updated_at
				FROM memory_fts
				JOIN memory ON memory.id = memory_fts.rowid
				WHERE memory_fts MATCH ?
				ORDER BY
					bm25(memory_fts, 1.0, 2.0) ASC,
					memory.importance DESC,
					memory.updated_at DESC,
					memory.id DESC
				LIMIT ?
			`)
			.all(ftsQuery, MEMORY_RETRIEVE_LIMIT) as RetrievedMemory[]
	} finally {
		database.close()
	}
}
