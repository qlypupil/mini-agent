import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileTool } from './write_file_tool'

describe('writeFileTool', () => {
	let insideDirectory: string
	let outsideDirectory: string

	beforeEach(async () => {
		insideDirectory = await mkdtemp(join(process.cwd(), '.write-file-tool-'))
		outsideDirectory = await mkdtemp(join(tmpdir(), 'termclaw-write-file-'))
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

	it('creates a file using an absolute path outside the current directory', async () => {
		const path = join(outsideDirectory, 'absolute.txt')

		await expect(writeFileTool(path, 'absolute content')).resolves.toBe(
			`Wrote file: ${path}`,
		)
		await expect(readFile(path, 'utf8')).resolves.toBe('absolute content')
	})

	it('creates a file using a relative path outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'relative.txt')
		const path = relative(process.cwd(), outsideFile)

		await expect(writeFileTool(path, 'relative content')).resolves.toBe(
			`Wrote file: ${path}`,
		)
		await expect(readFile(outsideFile, 'utf8')).resolves.toBe('relative content')
	})

	it('expands environment-variable path expressions before writing', async () => {
		const variableName = 'TERMCLAW_WRITE_FILE_ROOT'
		const previousValue = process.env[variableName]
		process.env[variableName] = insideDirectory

		try {
			await expect(
				writeFileTool(`%${variableName}%/environment.txt`, 'environment content'),
			).resolves.toBe(
				`Wrote file: %${variableName}%/environment.txt`,
			)
			await expect(
				readFile(join(insideDirectory, 'environment.txt'), 'utf8'),
			).resolves.toBe('environment content')
		} finally {
			if (previousValue === undefined) {
				delete process.env[variableName]
			} else {
				process.env[variableName] = previousValue
			}
		}
	})

	it('rejects sensitive environment files', async () => {
		await expect(writeFileTool('.env.local', 'content')).rejects.toThrow(
			'Sensitive files cannot be written.',
		)
	})

	it('writes through a symbolic link that points outside the current directory', async () => {
		const outsideFile = join(outsideDirectory, 'outside.txt')
		const linkPath = join(insideDirectory, 'outside-link.txt')
		await writeFile(outsideFile, 'outside content')
		await symlink(outsideFile, linkPath)

		await expect(
			writeFileTool(insidePath('outside-link.txt'), 'updated content'),
		).resolves.toBe(
			`Wrote file: ${insidePath('outside-link.txt')}`,
		)
		await expect(readFile(outsideFile, 'utf8')).resolves.toBe('updated content')
	})

	it('rejects symbolic links that resolve to sensitive files', async () => {
		const sensitiveFile = join(outsideDirectory, '.env.secret')
		const linkPath = join(insideDirectory, 'secret-link.txt')
		await writeFile(sensitiveFile, 'secret')
		await symlink(sensitiveFile, linkPath)

		await expect(
			writeFileTool(insidePath('secret-link.txt'), 'updated secret'),
		).rejects.toThrow('Sensitive files cannot be written.')
		await expect(readFile(sensitiveFile, 'utf8')).resolves.toBe('secret')
	})

	it('rejects directories', async () => {
		await expect(writeFileTool(outsideDirectory, 'content')).rejects.toThrow(
			'The requested path is not a file.',
		)
	})
})
