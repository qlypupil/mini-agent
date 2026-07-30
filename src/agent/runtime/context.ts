import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	SystemMessage,
	ToolMessage,
} from '@langchain/core/messages'
import { formatMessagesForSummary } from './context_patch'

export const RECENT_CONTEXT_MESSAGES_TO_KEEP = 6
export const RECENT_TOOL_MESSAGES_TO_KEEP = 3

const READ_FILE_TOOL_NAME = 'read_file'

export interface ContextCompression {
	summary: string
	compressedMessageIds: string[]
	compressionCount: number
	updatedAt: string
}

export interface ContextCompressionResult {
	compression?: ContextCompression
	compressed: boolean
	newlyCompressedMessageCount: number
	retainedMessageCount: number
	compressionCount: number
}

function requireMessageId(message: BaseMessage): string {
	if (!message.id) {
		throw new Error('聊天消息缺少 message ID，无法安全标记压缩状态。')
	}
	return message.id
}

function stringifySummaryContent(content: AIMessage['content']): string {
	if (typeof content === 'string') return content.trim()
	if (!Array.isArray(content)) return ''

	return content
		.map((part) => {
			if (typeof part === 'string') return part
			if ('text' in part && typeof part.text === 'string') return part.text
			return ''
		})
		.join('')
		.trim()
}

function getToolMessageGroups(messages: BaseMessage[]): Set<number>[] {
	const groups: Set<number>[] = []

	for (const [index, message] of messages.entries()) {
		if (!AIMessage.isInstance(message) || !message.tool_calls?.length) continue

		const toolCallIds = new Set(
			message.tool_calls
				.map((toolCall) => toolCall.id)
				.filter((id): id is string => Boolean(id)),
		)
		const group = new Set<number>([index])

		for (const [candidateIndex, candidate] of messages.entries()) {
			if (
				ToolMessage.isInstance(candidate) &&
				toolCallIds.has(candidate.tool_call_id)
			) {
				group.add(candidateIndex)
			}
		}

		groups.push(group)
	}

	return groups
}

function getRetainedStartIndex(messages: BaseMessage[]): number {
	let retainedStart = Math.max(
		0,
		messages.length - RECENT_CONTEXT_MESSAGES_TO_KEEP,
	)
	const groups = getToolMessageGroups(messages)
	let boundaryChanged = true

	while (boundaryChanged) {
		boundaryChanged = false
		for (const group of groups) {
			const indices = [...group]
			const crossesBoundary =
				indices.some((index) => index < retainedStart) &&
				indices.some((index) => index >= retainedStart)
			if (crossesBoundary) {
				const nextRetainedStart = Math.min(retainedStart, ...indices)
				boundaryChanged = nextRetainedStart !== retainedStart
				retainedStart = nextRetainedStart
			}
		}
	}

	return retainedStart
}

function getToolNamesByCallId(messages: BaseMessage[]): Map<string, string> {
	const names = new Map<string, string>()

	for (const message of messages) {
		if (!AIMessage.isInstance(message)) continue
		for (const toolCall of message.tool_calls ?? []) {
			if (toolCall.id) names.set(toolCall.id, toolCall.name)
		}
	}

	return names
}

function cloneToolMessageWithContent(
	message: ToolMessage,
	content: string,
): ToolMessage {
	return new ToolMessage({
		content,
		tool_call_id: message.tool_call_id,
		name: message.name,
		status: message.status,
		id: message.id,
		artifact: message.artifact,
		metadata: message.metadata,
		additional_kwargs: message.additional_kwargs,
		response_metadata: message.response_metadata,
	})
}

export function simplifyHistoricalToolMessages(
	messages: BaseMessage[],
): BaseMessage[] {
	let currentTurnStart = -1
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (HumanMessage.isInstance(messages[index])) {
			currentTurnStart = index
			break
		}
	}
	if (currentTurnStart < 0) return messages

	const historicalToolIndices = messages
		.map((message, index) =>
			index < currentTurnStart && ToolMessage.isInstance(message) ? index : -1,
		)
		.filter((index) => index >= 0)
	const recentToolIndices = new Set(
		historicalToolIndices.slice(-RECENT_TOOL_MESSAGES_TO_KEEP),
	)
	const toolNamesByCallId = getToolNamesByCallId(messages)

	return messages.map((message, index) => {
		if (
			!ToolMessage.isInstance(message) ||
			index >= currentTurnStart ||
			recentToolIndices.has(index)
		) {
			return message
		}

		const toolName =
			message.name ?? toolNamesByCallId.get(message.tool_call_id)
		if (!toolName || toolName === READ_FILE_TOOL_NAME) return message

		return cloneToolMessageWithContent(
			message,
			`[Previous: used ${toolName}]`,
		)
	})
}

export async function summarizeContextMessages(
	model: BaseChatModel,
	messages: BaseMessage[],
): Promise<string> {
	if (messages.length === 0) throw new Error('没有可摘要的消息。')

	const response = await model.invoke([
		new SystemMessage(
			'Create a concise plain-text summary of the supplied conversation. Preserve concrete facts, user requirements, decisions, unresolved questions, and important tool results. Do not add commentary or markdown headings.',
		),
		new HumanMessage(formatMessagesForSummary(messages)),
	])
	const summary = stringifySummaryContent(response.content)
	if (!summary) throw new Error('模型返回了空摘要。')

	return summary
}

export async function compressContextMessages(
	model: BaseChatModel,
	messages: BaseMessage[],
	previous?: ContextCompression,
): Promise<ContextCompressionResult> {
	const retainedStart = getRetainedStartIndex(messages)
	const retainedMessageCount = messages.length - retainedStart
	const messageIds = new Set(messages.map(requireMessageId))
	const validPrevious = previous?.compressedMessageIds.every((id) =>
		messageIds.has(id),
	)
		? previous
		: undefined
	const compressedIds = new Set(validPrevious?.compressedMessageIds ?? [])
	const messagesToCompress = messages
		.slice(0, retainedStart)
		.filter((message) => !compressedIds.has(requireMessageId(message)))

	if (messagesToCompress.length === 0) {
		return {
			compression: validPrevious,
			compressed: false,
			newlyCompressedMessageCount: 0,
			retainedMessageCount,
			compressionCount: validPrevious?.compressionCount ?? 0,
		}
	}

	const previousSummary = validPrevious?.summary.trim()
	const summaryInput = [
		previousSummary
			? `Existing compressed conversation summary:\n${previousSummary}`
			: undefined,
		`New conversation messages to merge into the summary:\n${formatMessagesForSummary(messagesToCompress)}`,
	]
		.filter((section): section is string => Boolean(section))
		.join('\n\n')
	const response = await model.invoke([
		new SystemMessage(
			'Create a concise cumulative plain-text conversation summary for a future model request. Preserve concrete facts, user requirements, decisions, unresolved questions, code, file paths, and important tool results. Merge the existing summary with only the new messages. Do not add commentary or markdown headings. Keep the conversation language when practical.',
		),
		new HumanMessage(summaryInput),
	])
	const summary = stringifySummaryContent(response.content)
	if (!summary) throw new Error('模型返回了空摘要。')

	const compression: ContextCompression = {
		summary,
		compressedMessageIds: [
			...compressedIds,
			...messagesToCompress.map(requireMessageId),
		],
		compressionCount: (validPrevious?.compressionCount ?? 0) + 1,
		updatedAt: new Date().toISOString(),
	}

	return {
		compression,
		compressed: true,
		newlyCompressedMessageCount: messagesToCompress.length,
		retainedMessageCount,
		compressionCount: compression.compressionCount,
	}
}

export function applyContextCompression(
	messages: BaseMessage[],
	compression: ContextCompression,
): BaseMessage[] {
	const compressedIds = new Set(compression.compressedMessageIds)
	const messageIds = new Set(messages.map(requireMessageId))
	if (compression.compressedMessageIds.some((id) => !messageIds.has(id))) {
		return messages
	}
	const firstCompressedIndex = messages.findIndex((message) =>
		compressedIds.has(message.id as string),
	)
	if (firstCompressedIndex < 0) return messages

	const summaryMessage = new HumanMessage({
		content: `Conversation summary (automatically compressed):\n${compression.summary.trim()}`,
	})

	return messages.flatMap((message, index) => {
		if (index === firstCompressedIndex) return [summaryMessage]
		return compressedIds.has(message.id as string) ? [] : [message]
	})
}
