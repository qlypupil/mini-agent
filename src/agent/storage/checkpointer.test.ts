import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCheckpointer } from './checkpointer'

describe('createCheckpointer', () => {
	it('persists checkpoints in a SQLite database file', async () => {
		const databasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-checkpointer-')),
			'checkpointer.db',
		)
		const checkpointer = createCheckpointer(databasePath)
		const config = { configurable: { thread_id: 'test-thread' } }

		await checkpointer.put(
			config,
			{
				v: 4,
				ts: '2026-07-24T00:00:00.000Z',
				id: 'checkpoint-1',
				channel_values: { message: 'saved message' },
				channel_versions: { message: 1 },
				versions_seen: {},
			},
			{ source: 'input', step: 0, parents: {} },
		)

		const restored = await checkpointer.getTuple(config)

		expect(existsSync(databasePath)).toBe(true)
		expect(restored?.checkpoint.channel_values.message).toBe('saved message')
		checkpointer.db.close()
	})
})
