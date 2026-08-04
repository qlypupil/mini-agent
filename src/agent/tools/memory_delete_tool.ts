import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { DB_PATH } from '../storage/db'
import { deleteMemory } from '../storage/memory'
import { withPermissionLevel } from '../permission'

export const memoryDeleteSchema = z.object({
	id: z
		.number()
		.int()
		.positive()
		.max(Number.MAX_SAFE_INTEGER)
		.describe('The exact memory ID returned by memory_retrieve.'),
})

export type MemoryDeleteInput = z.infer<typeof memoryDeleteSchema>

export function memoryDeleteTool(
	input: MemoryDeleteInput,
	databasePath = DB_PATH,
): string {
	const deleted = deleteMemory(input.id, databasePath)

	return JSON.stringify({
		status: deleted ? 'deleted' : 'not_found',
		id: input.id,
	})
}

export function createMemoryDeleteTool(databasePath = DB_PATH) {
	return withPermissionLevel(
		tool((input) => memoryDeleteTool(input, databasePath), {
			name: 'memory_delete',
			description:
				'Delete exactly one durable long-term memory by its retrieved ID. Use only when the user explicitly asks to delete or forget that memory. If no exact memory ID is available in the current context, call memory_retrieve first. Never guess an ID or delete while multiple plausible candidates remain.',
			schema: memoryDeleteSchema,
		}),
		'db',
	)
}

export const memoryDelete = createMemoryDeleteTool()
