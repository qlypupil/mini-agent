import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileTool } from './write_file_tool'

describe('writeFileTool', () => {
	let insideDirectory: string
	let outsideDirectory: string

	beforeEach(async () => {
		insideDirectory = await mkdtemp(join(process.cwd(), '.write-file-tool-'))
		outsideDirectory = await mkdtemp(join(tmpdir(), 'mini-agent-write-file-'))
	})

	afterEach(async () => {
		await rm(insideDirectory, { recursive: true, force: true })
		await rm(outsideDirectory, { recursive: true, force: true })
	})

	function insidePath(fileName: string): string {
		return relative(process.cwd(), join(insideDirectory, fileName))
	}

	it('creates a file inside the current directory', async () => {
		const path = insidePath('created.txt')

		await expect(writeFileTool(path, 'hello')).resolves.toBe(`Wrote file: ${path}`)
		await expect(readFile(join(insideDirectory, 'created.txt'), 'utf8')).resolves.toBe(
			'hello',
		)
	})

	it('overwrites an existing file inside the current directory', async () => {
		const path = insidePath('existing.txt')
		await writeFile(join(insideDirectory, 'existing.txt'), 'old content')

		await writeFileTool(path, 'new content')

		await expect(readFile(join(insideDirectory, 'existing.txt'), 'utf8')).resolves.toBe(
			'new content',
		)
	})

	it('rejects absolute paths', async () => {
		await expect(
			writeFileTool(resolve(process.cwd(), 'package.json'), 'content'),
		).rejects.toThrow('Only relative file paths are allowed.')
	})

	it('rejects paths outside the current directory', async () => {
		await expect(writeFileTool('../outside.txt', 'content')).rejects.toThrow(
			'Only files in the current directory can be written.',
		)
	})

	it('rejects sensitive environment files', async () => {
		await expect(writeFileTool('.env.local', 'content')).rejects.toThrow(
			'Sensitive files cannot be written.',
		)
	})

	it('rejects symbolic links that point outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'outside.txt')
		const linkPath = join(insideDirectory, 'outside-link.txt')
		await writeFile(outsideFile, 'outside content')
		await symlink(outsideFile, linkPath)

		await expect(writeFileTool(insidePath('outside-link.txt'), 'content')).rejects.toThrow(
			'Only files in the current directory can be written.',
		)
		await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside content')
	})
})
