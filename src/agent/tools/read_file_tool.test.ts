import { resolve } from 'node:path'
import { readFileTool } from './read_file_tool'

describe('readFileTool', () => {
	it('reads a file inside the current directory', async () => {
		await expect(readFileTool('package.json')).resolves.toContain(
			'"name": "mini-agent"',
		)
	})

	it('rejects absolute paths', async () => {
		await expect(
			readFileTool(resolve(process.cwd(), 'package.json')),
		).rejects.toThrow('Only relative file paths are allowed.')
	})

	it('rejects paths outside the current directory', async () => {
		await expect(readFileTool('../package.json')).rejects.toThrow(
			'Only files in the current directory can be read.',
		)
	})

	it('rejects sensitive environment files', async () => {
		await expect(readFileTool('.env')).rejects.toThrow(
			'Sensitive files cannot be read.',
		)
	})
})
