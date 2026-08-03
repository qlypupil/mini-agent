import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { readFileTool } from './read_file_tool'

describe('readFileTool', () => {
	let insideDirectory: string
	let outsideDirectory: string

	beforeEach(async () => {
		insideDirectory = await mkdtemp(join(process.cwd(), '.read-file-tool-'))
		outsideDirectory = await mkdtemp(join(tmpdir(), 'termclaw-read-file-'))
	})

	afterEach(async () => {
		await rm(insideDirectory, { recursive: true, force: true })
		await rm(outsideDirectory, { recursive: true, force: true })
	})

	it('reads a file inside the current directory', async () => {
		await expect(readFileTool('package.json')).resolves.toContain(
			'"name": "termclaw"',
		)
	})

	it('reads an absolute path outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'absolute.txt')
		await writeFile(outsideFile, 'absolute content')

		await expect(readFileTool(outsideFile)).resolves.toBe('absolute content')
	})

	it('reads a relative path outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'relative.txt')
		await writeFile(outsideFile, 'relative content')

		await expect(
			readFileTool(relative(process.cwd(), outsideFile)),
		).resolves.toBe('relative content')
	})

	it('reads through a symbolic link that points outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'outside.txt')
		const linkPath = join(insideDirectory, 'outside-link.txt')
		await writeFile(outsideFile, 'outside content')
		await symlink(outsideFile, linkPath)

		await expect(readFileTool(linkPath)).resolves.toBe('outside content')
	})

	it('rejects sensitive environment files', async () => {
		await expect(readFileTool('.env')).rejects.toThrow(
			'Sensitive files cannot be read.',
		)
	})

	it('rejects symbolic links that resolve to sensitive files', async () => {
		const sensitiveFile = join(outsideDirectory, '.env.secret')
		const linkPath = join(insideDirectory, 'secret-link.txt')
		await writeFile(sensitiveFile, 'secret')
		await symlink(sensitiveFile, linkPath)

		await expect(readFileTool(linkPath)).rejects.toThrow(
			'Sensitive files cannot be read.',
		)
	})

	it('rejects directories', async () => {
		await expect(readFileTool(resolve(outsideDirectory))).rejects.toThrow(
			'The requested path is not a file.',
		)
	})
})
