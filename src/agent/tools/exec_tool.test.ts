import { execSchema, execTool } from './exec_tool'

describe('execTool', () => {
	it('exposes only one non-empty command string', () => {
		expect(Object.keys(execSchema.shape)).toEqual(['command'])
		expect(execSchema.safeParse({ command: 'printf hello' }).success).toBe(true)
		expect(execSchema.safeParse({ command: '   ' }).success).toBe(false)
	})

	it('executes a command outside the former allowlist', async () => {
		await expect(execTool({ command: "printf 'hello from exec'" })).resolves.toBe(
			'hello from exec',
		)
	})

	it('supports shell pipelines', async () => {
		await expect(
			execTool({ command: "printf 'hello\\n' | tr '[:lower:]' '[:upper:]'" }),
		).resolves.toBe('HELLO\n')
	})

	it('returns the current working directory', async () => {
		await expect(execTool({ command: 'pwd' })).resolves.toContain('mini-agent')
	})

	it('returns stderr when a command exits with an error', async () => {
		await expect(
			execTool({
				command:
					'node -e "process.stderr.write(\'command failed\'); process.exit(2)"',
			}),
		).rejects.toThrow('command failed')
	})

	it('rejects output larger than 64 KB', async () => {
		await expect(
			execTool({
				command: 'node -e "process.stdout.write(\'x\'.repeat(70 * 1024))"',
			}),
		).rejects.toThrow('Command output exceeded the 64 KB limit.')
	})
})
