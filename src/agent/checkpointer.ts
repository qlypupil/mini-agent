import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'

export const CHECKPOINT_DATABASE_PATH = resolve(
	process.cwd(),
	'.data/checkpointer.db',
)

export function createCheckpointer(
	databasePath = CHECKPOINT_DATABASE_PATH,
): SqliteSaver {
	mkdirSync(dirname(databasePath), { recursive: true })
	return SqliteSaver.fromConnString(databasePath)
}
