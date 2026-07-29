import Table from 'cli-table3'
import { createCheckpointer, CHECKPOINT_DATABASE_PATH } from './checkpointer'

export interface ChatSession {
	threadId: string
	lastUserMessage: string
	updatedAt: Date
}

interface CheckpointRow {
	thread_id: string
	checkpoint_ns: string
	checkpoint_id: string
}

interface ChatMessage {
	type?: unknown
	content?: unknown
}

function stringifyContent(content: unknown): string {
	if (typeof content === 'string') return content
	if (Array.isArray(content)) {
		return content
			.map((part) => (typeof part === 'string' ? part : JSON.stringify(part)))
			.join('')
	}
	return ''
}

export function getLastUserMessage(messages: unknown): string | undefined {
	if (!Array.isArray(messages)) return undefined

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as ChatMessage
		if (message?.type !== 'human') continue

		const content = stringifyContent(message.content).replace(/\s+/g, ' ').trim()
		if (content) return content
	}

	return undefined
}

export function formatRelativeTime(date: Date, now = new Date()): string {
	const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000))
	if (elapsedSeconds < 60) return '刚刚'

	const elapsedMinutes = Math.floor(elapsedSeconds / 60)
	if (elapsedMinutes < 60) return `${elapsedMinutes}分钟前`

	const elapsedHours = Math.floor(elapsedMinutes / 60)
	if (elapsedHours < 24) return `${elapsedHours}小时前`

	const elapsedDays = Math.floor(elapsedHours / 24)
	if (elapsedDays < 7) return `${elapsedDays}天前`

	return date.toLocaleDateString('zh-CN', {
		month: 'numeric',
		day: 'numeric',
	})
}

function truncateMessage(message: string, maxLength = 50): string {
	const characters = Array.from(message)
	return characters.length > maxLength
		? `${characters.slice(0, maxLength).join('')}...`
		: message
}

export function formatSessionsTable(
	sessions: ChatSession[],
	now = new Date(),
): string {
	if (sessions.length === 0) return '暂无聊天记录。'

	const table = new Table({
		head: ['thread_id', '最后用户输入的问题', '时间'],
	})
	for (const session of sessions) {
		table.push([
			session.threadId,
			truncateMessage(session.lastUserMessage),
			formatRelativeTime(session.updatedAt, now),
		])
	}

	return table.toString()
}

// 只检查 threadId 是否已有 checkpoint，不读取消息内容，也不修改数据库。
export async function hasChatSession(
	threadId: string,
	databasePath = CHECKPOINT_DATABASE_PATH,
): Promise<boolean> {
	if (!threadId) return false

	const checkpointer = createCheckpointer(databasePath)

	try {
		// 首次执行命令时初始化 schema，空数据库会自然返回 false。
		await checkpointer.getTuple({
			configurable: { thread_id: '', checkpoint_ns: '' },
		})

		return Boolean(
			checkpointer.db
				.prepare('SELECT 1 FROM checkpoints WHERE thread_id = ? LIMIT 1')
				.get(threadId),
		)
	} finally {
		checkpointer.db.close()
	}
}

// 每个 thread 只读取最新 checkpoint，再按 checkpoint 中记录的时间排序。
export async function listRecentChatSessions(
	databasePath = CHECKPOINT_DATABASE_PATH,
	limit = 20,
): Promise<ChatSession[]> {
	const checkpointer = createCheckpointer(databasePath)

	try {
		// 首次执行 /sessions 时数据库可能为空，先让 checkpointer 初始化 SQLite schema。
		await checkpointer.getTuple({
			configurable: { thread_id: '', checkpoint_ns: '' },
		})

		const rows = checkpointer.db
			.prepare(
				`SELECT thread_id, checkpoint_ns, checkpoint_id
				FROM (
					SELECT thread_id, checkpoint_ns, checkpoint_id,
						ROW_NUMBER() OVER (
							PARTITION BY thread_id
							ORDER BY checkpoint_id DESC
						) AS checkpoint_rank
					FROM checkpoints
				)
				WHERE checkpoint_rank = 1
				ORDER BY checkpoint_id DESC`,
			)
			.all() as CheckpointRow[]

		const sessions: ChatSession[] = []
		for (const row of rows) {
			const tuple = await checkpointer.getTuple({ configurable: row })
			if (!tuple) continue

			const lastUserMessage = getLastUserMessage(
				tuple.checkpoint.channel_values.messages,
			)
			if (!lastUserMessage) continue

			sessions.push({
				threadId: row.thread_id,
				lastUserMessage,
				updatedAt: new Date(tuple.checkpoint.ts),
			})
		}

		return sessions
			.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
			.slice(0, limit)
	} finally {
		checkpointer.db.close()
	}
}
