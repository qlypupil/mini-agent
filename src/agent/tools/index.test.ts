import { createMemoryCreateTool } from './memory_create_tool'
import { createMemoryDeleteTool } from './memory_delete_tool'
import { createMemoryRetrieveTool } from './memory_retrieve_tool'
import { createProfileUpdateTool } from './profile_update_tool'
import { tools } from './index'
import type { ToolPermissionLevel } from '../permission'

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

	it('declares model-controlled file path arguments only on file tools', () => {
		expect(
			Object.fromEntries(
				tools
					.filter((registeredTool) => registeredTool.file_path_arg)
					.map((registeredTool) => [
						registeredTool.name,
						registeredTool.file_path_arg,
					]),
			),
		).toEqual({
			read_file: 'path',
			write_file: 'path',
		})
	})

	it('describes relative-date search as a sequential tool flow', () => {
		const currentTime = tools.find((registeredTool) =>
			registeredTool.name === 'current_time',
		)
		const webSearch = tools.find((registeredTool) =>
			registeredTool.name === 'web_search',
		)

		expect(currentTime?.description).toContain(
			'call this in an earlier tool round and wait for its ToolMessage before calling web_search',
		)
		expect(currentTime?.description).toContain(
			'never batch web_search with this call',
		)
		expect(webSearch?.description).toContain(
			'only after a successful current_time ToolMessage from an earlier tool round',
		)
		expect(webSearch?.description).toContain(
			'include the resolved YYYY-MM-DD date in the query',
		)
	})
})
