import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { DB_PATH } from '../storage/db'
import { retrieveMemories } from '../storage/memory'
import { withPermissionLevel } from './tool_permission'

export const memoryRetrieveSchema = z.object({
	keywords: z
		.array(z.string().trim().min(1).max(64))
		.min(1)
		.max(8)
		.describe(
			'One to eight concise keywords or phrases describing the long-term memory to retrieve.',
		),
})

export type MemoryRetrieveInput = z.infer<typeof memoryRetrieveSchema>

export function memoryRetrieveTool(
	input: MemoryRetrieveInput,
	databasePath = DB_PATH,
): string {
	const memories = retrieveMemories(input.keywords, databasePath)

	return JSON.stringify({
		status: memories.length > 0 ? 'found' : 'not_found',
		memories,
	})
}

export function createMemoryRetrieveTool(databasePath = DB_PATH) {
	return withPermissionLevel(
		tool((input) => memoryRetrieveTool(input, databasePath), {
			name: 'memory_retrieve',
			description:
				'Retrieve durable long-term memories relevant to a set of keywords. Use when the user asks about previously saved personal facts, preferences, events, or skills and the current context does not contain enough information to answer. Always call this tool before claiming that no saved memory exists for the current topic.',
			schema: memoryRetrieveSchema,
		}),
		'db',
	)
}

export const memoryRetrieve = createMemoryRetrieveTool()
