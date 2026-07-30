import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ToolMessage } from '@langchain/core/messages'

export const TOOL_OUTPUT_LENGTH_LIMIT = 50_000
export const TOOL_OUTPUT_PREVIEW_LENGTH = 2_000
export const TOOL_OUTPUT_DIRECTORY = resolve(process.cwd(), 'tool_output')

function getSafeToolCallId(toolCallId: string): string {
	if (/^[A-Za-z0-9_-]{1,120}$/.test(toolCallId)) return toolCallId

	const normalized =
		toolCallId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'tool_call'
	const hash = createHash('sha256')
		.update(toolCallId)
		.digest('hex')
		.slice(0, 12)

	return `${normalized}_${hash}`
}

function getDisplayPath(filePath: string): string {
	const relativePath = relative(process.cwd(), filePath)
	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		return filePath
	}

	return relativePath
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function cloneToolMessage(
	message: ToolMessage,
	content: string,
	status = message.status,
): ToolMessage {
	return new ToolMessage({
		content,
		tool_call_id: message.tool_call_id,
		name: message.name,
		status,
		id: message.id,
		artifact: message.artifact,
		metadata: message.metadata,
		additional_kwargs: message.additional_kwargs,
		response_metadata: message.response_metadata,
	})
}

export async function maybePersistToolOutput(
	content: string,
	toolCallId: string,
	outputDirectory = TOOL_OUTPUT_DIRECTORY,
): Promise<string> {
	if (content.length <= TOOL_OUTPUT_LENGTH_LIMIT) return content

	await mkdir(outputDirectory, { recursive: true })
	const fileName = `tool_output_${getSafeToolCallId(toolCallId)}.txt`
	const filePath = join(outputDirectory, fileName)
	await writeFile(filePath, content, 'utf8')

	return `<persisted-output>
Output too large (${(Buffer.byteLength(content, 'utf8') / 1024).toFixed(1)}KB).
Full output saved to: ${getDisplayPath(filePath)}
If you need the complete content, read it in segments.

Preview (first 2000 characters):
${content.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)}
...
</persisted-output>`
}

async function maybePersistToolMessage(
	message: ToolMessage,
	outputDirectory: string,
): Promise<ToolMessage> {
	if (typeof message.content !== 'string') return message

	try {
		const content = await maybePersistToolOutput(
			message.content,
			message.tool_call_id,
			outputDirectory,
		)
		return content === message.content
			? message
			: cloneToolMessage(message, content)
	} catch (error) {
		const content = `<persisted-output-error>
Tool output exceeded the Context limit, but could not be saved.
Reason: ${getErrorMessage(error)}

Preview (first 2000 characters):
${message.content.slice(0, TOOL_OUTPUT_PREVIEW_LENGTH)}
...
</persisted-output-error>`

		return cloneToolMessage(message, content, 'error')
	}
}

export async function maybePersistToolMessages(
	messages: unknown[],
	outputDirectory = TOOL_OUTPUT_DIRECTORY,
): Promise<unknown[]> {
	return Promise.all(
		messages.map((message) =>
			ToolMessage.isInstance(message)
				? maybePersistToolMessage(message, outputDirectory)
				: message,
		),
	)
}
