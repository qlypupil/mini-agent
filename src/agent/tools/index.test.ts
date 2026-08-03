import { createMemoryCreateTool } from './memory_create_tool'
import { createMemoryDeleteTool } from './memory_delete_tool'
import { createMemoryRetrieveTool } from './memory_retrieve_tool'
import { createProfileUpdateTool } from './profile_update_tool'
import { tools } from './index'
import type { ToolPermissionLevel } from './tool_permission'

const expectedPermissions = {
	read_file: 'read',
	write_file: 'write',
	exec: 'exec',
	run_js: 'exec',
	run_py: 'exec',
	current_time: 'read',
	web_search: 'network',
	web_fetch: 'network',
	profile_update: 'write',
	memory_create: 'db',
	memory_retrieve: 'db',
	memory_delete: 'db',
	load_skill: 'read',
} satisfies Record<string, ToolPermissionLevel>

describe('tool permissions', () => {
	it('assigns the expected permission level to every registered tool', () => {
		expect(tools).toHaveLength(Object.keys(expectedPermissions).length)
		expect(
			Object.fromEntries(
				tools.map((registeredTool) => [
					registeredTool.name,
					registeredTool.permission_level,
				]),
			),
		).toEqual(expectedPermissions)
	})

	it('assigns permissions inside configurable tool factories', () => {
		expect(createMemoryCreateTool().permission_level).toBe('db')
		expect(createMemoryRetrieveTool().permission_level).toBe('db')
		expect(createMemoryDeleteTool().permission_level).toBe('db')
		expect(createProfileUpdateTool().permission_level).toBe('write')
	})
})
