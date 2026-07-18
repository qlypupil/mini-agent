import { execTool } from './exec_tool'

describe('execTool', () => {
	it('lists files inside the current directory', async () => {
		await expect(execTool({ command: 'ls', path: 'src' })).resolves.toContain(
			'agent',
		)
	})

	it('returns the current working directory', async () => {
		await expect(execTool({ command: 'pwd' })).resolves.toContain('mini-agent')
	})

	it('rejects commands outside the allowlist', async () => {
		await expect(execTool({ command: 'rm' })).rejects.toThrow(
			'Command is not allowed: rm',
		)
	})

	it('rejects paths outside the current directory', async () => {
		await expect(execTool({ command: 'ls', path: '../' })).rejects.toThrow(
			'Only paths in the current directory can be used.',
		)
	})

	it('rejects sensitive paths', async () => {
		await expect(execTool({ command: 'ls', path: '.env' })).rejects.toThrow(
			'Sensitive paths cannot be used.',
		)
	})
})
