import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'

export const DB_PATH = resolve(process.cwd(), '.data/memory.db')

const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS memory (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	type TEXT NOT NULL,
	content TEXT NOT NULL,
	keywords TEXT,
	importance INTEGER DEFAULT 3,
	session_id TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS memory_update_updated_at
AFTER UPDATE OF type, content, keywords, importance, session_id ON memory
FOR EACH ROW
WHEN
	OLD.type IS NOT NEW.type OR
	OLD.content IS NOT NEW.content OR
	OLD.keywords IS NOT NEW.keywords OR
	OLD.importance IS NOT NEW.importance OR
	OLD.session_id IS NOT NEW.session_id
BEGIN
	UPDATE memory
	SET updated_at = CURRENT_TIMESTAMP
	WHERE id = NEW.id;
END;
`

export function initializeDatabase(databasePath = DB_PATH): void {
	mkdirSync(dirname(databasePath), { recursive: true })
	const database = new Database(databasePath)

	try {
		database.exec(MEMORY_SCHEMA)
	} finally {
		database.close()
	}
}
