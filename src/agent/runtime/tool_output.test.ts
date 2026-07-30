import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolMessage } from '@langchain/core/messages'
import {
	maybePersistToolMessages,
	maybePersistToolOutput,
	TOOL_OUTPUT_LENGTH_LIMIT,
	TOOL_OUTPUT_PREVIEW_LENGTH,
} from './tool_output'

describe('tool output persistence', () => {
	let rootDirectory: string
	let outputDirectory: string

	beforeEach(async () => {
		rootDirectory = await mkdtemp(join(tmpdir(), 'termclaw-tool-output-'))
		outputDirectory = join(rootDirectory, 'tool_output')
	})

	afterEach(async () => {
		await rm(rootDirectory, { recursive: true, force: true })
	})

	it('returns output at the length limit without creating a file', async () => {
		const content = 'a'.repeat(TOOL_OUTPUT_LENGTH_LIMIT)

		await expect(
			maybePersistToolOutput(content, 'call-limit', outputDirectory),
		).resolves.toBe(content)
		await expect(access(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
	})

	it('persists output over the limit and returns a bounded preview', async () => {
		const content = 'a'.repeat(TOOL_OUTPUT_LENGTH_LIMIT + 1)
		const result = await maybePersistToolOutput(
			content,
			'call-large',
			outputDirectory,
		)
		const filePath = join(outputDirectory, 'tool_output_call-large.txt')

		await expect(readFile(filePath, 'utf8')).resolves.toBe(content)
		expect(result).toContain(
			`Output too large (${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)}KB).`,
		)
		expect(result).toContain(`Full output saved to: ${filePath}`)
		expect(result).toContain('Preview (first 2000 characters):')
		expect(result).toContain(content.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH))
		expect(result.length).toBeLessThan(3_000)
	})

	it('reports the UTF-8 byte size for non-ASCII output', async () => {
		const content = '中'.repeat(TOOL_OUTPUT_LENGTH_LIMIT + 1)
		const result = await maybePersistToolOutput(
			content,
			'call-unicode',
			outputDirectory,
		)

		expect(result).toContain(
			`Output too large (${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)}KB).`,
		)
	})

	it('sanitizes unsafe tool call ids before using them as file names', async () => {
		const content = 'a'.repeat(TOOL_OUTPUT_LENGTH_LIMIT + 1)

		await maybePersistToolOutput(content, '../../call/1', outputDirectory)

		const files = await readdir(outputDirectory)
		expect(files).toHaveLength(1)
		expect(files[0]).toMatch(/^tool_output_[A-Za-z0-9_-]+\.txt$/)
		await expect(readFile(join(outputDirectory, files[0]), 'utf8')).resolves.toBe(content)
	})

	it('preserves non-string content and ToolMessage metadata', async () => {
		const structured = new ToolMessage({
			content: [{ type: 'text', text: 'structured output' }],
			tool_call_id: 'call-structured',
			name: 'structured_tool',
		})
		const artifact = { complete: true }
		const large = new ToolMessage({
			content: 'a'.repeat(TOOL_OUTPUT_LENGTH_LIMIT + 1),
			tool_call_id: 'call-metadata',
			name: 'large_tool',
			status: 'success',
			id: 'message-id',
			artifact,
			metadata: { source: 'test' },
			additional_kwargs: { custom: 'value' },
			response_metadata: { model: 'test-model' },
		})

		const [structuredResult, largeResult] = await maybePersistToolMessages(
			[structured, large],
			outputDirectory,
		) as ToolMessage[]

		expect(structuredResult).toBe(structured)
		expect(largeResult).not.toBe(large)
		expect(largeResult).toMatchObject({
			tool_call_id: 'call-metadata',
			name: 'large_tool',
			status: 'success',
			id: 'message-id',
			metadata: { source: 'test' },
			additional_kwargs: { custom: 'value' },
			response_metadata: { model: 'test-model' },
		})
		expect(largeResult.artifact).toBe(artifact)
	})

	it('marks the ToolMessage as an error when persistence fails', async () => {
		const content = 'a'.repeat(TOOL_OUTPUT_LENGTH_LIMIT + 1)
		const invalidDirectory = join(rootDirectory, 'not-a-directory')
		await writeFile(invalidDirectory, 'file')
		const message = new ToolMessage({
			content,
			tool_call_id: 'call-failure',
			name: 'large_tool',
			status: 'success',
		})

		const [result] = await maybePersistToolMessages(
			[message],
			invalidDirectory,
		) as ToolMessage[]

		expect(result.status).toBe('error')
		expect(result.content).toEqual(expect.stringContaining(
			'Tool output exceeded the Context limit, but could not be saved.',
		))
		expect(result.content).toEqual(expect.stringContaining(
			content.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH),
		))
		expect(String(result.content).length).toBeLessThan(3_000)
	})
})
