import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCheckpointer } from './checkpointer'
import {
	formatRelativeTime,
	formatSessionsTable,
	getLastUserMessage,
	hasChatSession,
	listRecentChatSessions,
} from './sessions'

async function saveCheckpoint(
	databasePath: string,
	threadId: string,
	checkpointId: string,
	ts: string,
	message: string,
): Promise<void> {
	const checkpointer = createCheckpointer(databasePath)
	await checkpointer.put(
		{ configurable: { thread_id: threadId } },
		{
			v: 4,
			ts,
			id: checkpointId,
			channel_values: { messages: [{ type: 'human', content: message }] },
			channel_versions: { messages: 1 },
			versions_seen: {},
		},
		{ source: 'input', step: 0, parents: {} },
	)
	checkpointer.db.close()
}

describe('listRecentChatSessions', () => {
	it('returns each thread once, ordered by its latest chat time', async () => {
		const databasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-sessions-')),
			'checkpointer.db',
		)

		await saveCheckpoint(
			databasePath,
			'thread-old',
			'checkpoint-001',
			'2026-07-24T10:00:00.000Z',
			'旧问题',
		)
		await saveCheckpoint(
			databasePath,
			'thread-old',
			'checkpoint-003',
			'2026-07-24T10:05:00.000Z',
			'旧会话的新问题',
		)
		await saveCheckpoint(
			databasePath,
			'thread-new',
			'checkpoint-002',
			'2026-07-24T11:00:00.000Z',
			'最新问题',
		)

		await expect(listRecentChatSessions(databasePath)).resolves.toEqual([
			{
				threadId: 'thread-new',
				lastUserMessage: '最新问题',
				updatedAt: new Date('2026-07-24T11:00:00.000Z'),
			},
			{
				threadId: 'thread-old',
				lastUserMessage: '旧会话的新问题',
				updatedAt: new Date('2026-07-24T10:05:00.000Z'),
			},
		])
	})
})

describe('hasChatSession', () => {
	it('checks whether a thread ID exists without reading its chat content', async () => {
		const databasePath = join(
			mkdtempSync(join(tmpdir(), 'termclaw-session-exists-')),
			'checkpointer.db',
		)

		await expect(hasChatSession('missing-thread', databasePath)).resolves.toBe(false)
		await saveCheckpoint(
			databasePath,
			'existing-thread',
			'checkpoint-001',
			'2026-07-24T10:00:00.000Z',
			'保存的消息',
		)

		await expect(hasChatSession('existing-thread', databasePath)).resolves.toBe(true)
		await expect(hasChatSession('missing-thread', databasePath)).resolves.toBe(false)
	})
})

describe('session display helpers', () => {
	it('uses the final human message and renders concise terminal table cells', () => {
		const message = '一二三四五六七八九十'.repeat(6)
		expect(
			getLastUserMessage([
				{ type: 'human', content: '旧问题' },
				{ type: 'ai', content: '旧回答' },
				{ type: 'human', content: message },
			]),
		).toBe(message)
		const table = formatSessionsTable(
			[
				{
					threadId: 'thread-full-id',
					lastUserMessage: `${message}|包含分隔符`,
					updatedAt: new Date('2026-07-24T11:59:30.000Z'),
				},
			],
			new Date('2026-07-24T12:00:00.000Z'),
		)

		expect(table).toContain('┌')
		expect(table).toContain('thread-full-id')
		expect(table).toContain('最后用户输入的问题')
		expect(table).toContain(`${Array.from(message).slice(0, 50).join('')}...`)
	})

	it('uses concise relative time labels', () => {
		const now = new Date('2026-07-24T12:00:00.000Z')
		expect(formatRelativeTime(new Date('2026-07-24T11:59:30.000Z'), now)).toBe('刚刚')
		expect(formatRelativeTime(new Date('2026-07-24T11:55:00.000Z'), now)).toBe('5分钟前')
		expect(formatRelativeTime(new Date('2026-07-24T09:00:00.000Z'), now)).toBe('3小时前')
	})
})
