import { tool, type ToolRunnableConfig } from '@langchain/core/tools'
import { z } from 'zod'
import { DB_PATH } from '../storage/db'
import { createMemory } from '../storage/memory'
import { withPermissionLevel } from '../permission'

export const memoryCreateSchema = z.object({
	type: z.enum(['fact', 'event', 'preference', 'skill']),
	content: z.string().trim().min(1).max(2000),
	keywords: z
		.array(z.string().trim().min(1).max(64))
		.max(20)
		.optional(),
	importance: z.number().int().min(1).max(5).default(3),
})

export type MemoryCreateInput = z.infer<typeof memoryCreateSchema>

function getSessionId(config: ToolRunnableConfig): string {
	const sessionId = config.configurable?.thread_id
	if (typeof sessionId !== 'string' || sessionId.trim() === '') {
		throw new Error('memory_create requires a non-empty configurable.thread_id.')
	}

	return sessionId
}

export function memoryCreateTool(
	input: MemoryCreateInput,
	sessionId: string,
	databasePath = DB_PATH,
): string {
	const id = createMemory(
		{
			...input,
			sessionId,
		},
		databasePath,
	)

	return JSON.stringify({ status: 'created', id })
}

export function createMemoryCreateTool(databasePath = DB_PATH) {
	return withPermissionLevel(
		tool(
			(input, config) =>
				memoryCreateTool(input, getSessionId(config), databasePath),
			{
				name: 'memory_create',
				description:
					'Create one durable long-term memory about the user. Use only for stable facts, important events, preferences, or skills with future value. Never store secrets or temporary task details.',
				schema: memoryCreateSchema,
			},
		),
		'db',
	)
}

export const memoryCreate = createMemoryCreateTool()
