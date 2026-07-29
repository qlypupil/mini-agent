import { randomUUID } from 'node:crypto'
import Table from 'cli-table3'
import {
	AIMessage,
	BaseMessage,
	HumanMessage,
	RemoveMessage,
	ToolMessage,
} from '@langchain/core/messages'
import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph'

export type ContextOperation =
	| {
			type: 'replace'
			messageId: string
			content: string
	  }
	| {
			type: 'remove'
			messageIds: string[]
	  }
	| {
			type: 'replaceRange'
			messageIds: string[]
			summary: string
	  }

export interface ContextPatch {
	operations: ContextOperation[]
}

function stringifyContent(content: unknown): string {
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return String(content ?? '')

	return content
		.map((part) => {
			if (typeof part === 'string') return part
			if (
				typeof part === 'object' &&
				part !== null &&
				'text' in part &&
				typeof part.text === 'string'
			) {
				return part.text
			}
			return JSON.stringify(part)
		})
		.join('')
}

function requireMessageId(message: BaseMessage): string {
	if (!message.id) {
		message.id = randomUUID()
	}
	return message.id
}

function getTargetIds(operation: ContextOperation): string[] {
	return operation.type === 'replace'
		? [operation.messageId]
		: operation.messageIds
}

function assertKnownAndUniqueTargets(
	messages: BaseMessage[],
	patch: ContextPatch,
): void {
	const knownIds = new Set(messages.map(requireMessageId))
	const targetedIds = new Set<string>()

	for (const operation of patch.operations) {
		for (const id of getTargetIds(operation)) {
			if (!knownIds.has(id)) {
				throw new Error(`消息不存在: ${id}`)
			}
			if (targetedIds.has(id)) {
				throw new Error(`同一条消息不能被重复编辑: ${id}`)
			}
			targetedIds.add(id)
		}
	}
}

function assertContiguousRange(
	messages: BaseMessage[],
	messageIds: string[],
): void {
	if (messageIds.length === 0) {
		throw new Error('消息范围不能为空。')
	}

	const targetIds = new Set(messageIds)
	const indices = messages
		.map((message, index) => targetIds.has(requireMessageId(message)) ? index : -1)
		.filter((index) => index >= 0)

	for (let index = 1; index < indices.length; index += 1) {
		if (indices[index] !== indices[index - 1] + 1) {
			throw new Error('只能编辑连续的消息范围。')
		}
	}
}

function getToolMessageGroups(messages: BaseMessage[]): Set<string>[] {
	const groups: Set<string>[] = []

	for (const message of messages) {
		if (!AIMessage.isInstance(message) || !message.tool_calls?.length) continue

		const toolCallIds = new Set(
			message.tool_calls
				.map((toolCall) => toolCall.id)
				.filter((id): id is string => Boolean(id)),
		)
		const group = new Set<string>([requireMessageId(message)])

		for (const candidate of messages) {
			if (
				ToolMessage.isInstance(candidate) &&
				toolCallIds.has(candidate.tool_call_id)
			) {
				group.add(requireMessageId(candidate))
			}
		}

		groups.push(group)
	}

	return groups
}

function assertCompleteToolGroups(
	messages: BaseMessage[],
	operation: ContextOperation,
): void {
	const targetIds = new Set(getTargetIds(operation))

	for (const group of getToolMessageGroups(messages)) {
		const selectedCount = [...group].filter((id) => targetIds.has(id)).length
		if (selectedCount > 0 && selectedCount !== group.size) {
			throw new Error('工具调用消息必须与对应的工具结果一起编辑。')
		}
	}
}

function cloneWithContent(message: BaseMessage, content: string): BaseMessage {
	if (HumanMessage.isInstance(message)) {
		return new HumanMessage({
			id: requireMessageId(message),
			name: message.name,
			content,
			additional_kwargs: message.additional_kwargs,
			response_metadata: message.response_metadata,
		})
	}

	if (AIMessage.isInstance(message) && !message.tool_calls?.length) {
		return new AIMessage({
			id: requireMessageId(message),
			name: message.name,
			content,
			additional_kwargs: message.additional_kwargs,
			response_metadata: message.response_metadata,
			usage_metadata: message.usage_metadata,
		})
	}

	throw new Error('只能直接替换不含工具调用的用户消息或 AI 消息。')
}

export function validateContextPatch(
	messages: BaseMessage[],
	patch: ContextPatch,
): void {
	if (patch.operations.length === 0) {
		throw new Error('Context 修改不能为空。')
	}

	assertKnownAndUniqueTargets(messages, patch)

	for (const operation of patch.operations) {
		assertCompleteToolGroups(messages, operation)

		if (operation.type === 'replace') {
			if (!operation.content.trim()) throw new Error('替换内容不能为空。')
			const message = messages.find(
				(candidate) => requireMessageId(candidate) === operation.messageId,
			)
			cloneWithContent(message as BaseMessage, operation.content)
			continue
		}

		assertContiguousRange(messages, operation.messageIds)
		if (operation.type === 'replaceRange' && !operation.summary.trim()) {
			throw new Error('摘要内容不能为空。')
		}
	}
}

export function applyContextPatch(
	messages: BaseMessage[],
	patch: ContextPatch,
): BaseMessage[] {
	validateContextPatch(messages, patch)
	let result = [...messages]

	for (const operation of patch.operations) {
		if (operation.type === 'replace') {
			result = result.map((message) =>
				requireMessageId(message) === operation.messageId
					? cloneWithContent(message, operation.content)
					: message,
			)
			continue
		}

		const targetIds = new Set(operation.messageIds)
		if (operation.type === 'remove') {
			result = result.filter(
				(message) => !targetIds.has(requireMessageId(message)),
			)
			continue
		}

		const firstIndex = result.findIndex((message) =>
			targetIds.has(requireMessageId(message)),
		)
		const summaryMessage = new HumanMessage({
			id: randomUUID(),
			content: `Conversation summary:\n${operation.summary.trim()}`,
		})

		result = result.flatMap((message, index) => {
			if (index === firstIndex) return [summaryMessage]
			return targetIds.has(requireMessageId(message)) ? [] : [message]
		})
	}

	return result
}

export function createMessagesReset(messages: BaseMessage[]): BaseMessage[] {
	return [
		new RemoveMessage({ id: REMOVE_ALL_MESSAGES }),
		...messages,
	]
}

export function parseMessageSelector(
	selector: string,
	messages: BaseMessage[],
): string[] {
	const match = /^(\d+)(?:-(\d+))?$/.exec(selector.trim())
	if (!match) throw new Error('消息序号必须是单个数字或连续范围，例如 2 或 1-6。')

	const start = Number(match[1])
	const end = Number(match[2] ?? match[1])
	if (start < 1 || end < start || end > messages.length) {
		throw new Error(`消息范围必须在 1-${messages.length} 之间。`)
	}

	return messages
		.slice(start - 1, end)
		.map(requireMessageId)
}

function truncateContent(content: string, maxLength = 70): string {
	const normalized = content.replace(/\s+/g, ' ').trim()
	const characters = Array.from(normalized)
	return characters.length > maxLength
		? `${characters.slice(0, maxLength).join('')}...`
		: normalized
}

export function formatContextMessages(messages: BaseMessage[]): string {
	if (messages.length === 0) return '当前会话暂无聊天记录。'

	const table = new Table({
		head: ['序号', 'message_id', '角色', '内容'],
		colWidths: [6, 14, 10, 74],
		wordWrap: true,
	})

	for (const [index, message] of messages.entries()) {
		table.push([
			String(index + 1),
			requireMessageId(message).slice(0, 8),
			message.getType(),
			truncateContent(stringifyContent(message.content)),
		])
	}

	return table.toString()
}

export function formatMessagesForSummary(messages: BaseMessage[]): string {
	return messages
		.map((message, index) => {
			const toolCalls =
				AIMessage.isInstance(message) && message.tool_calls?.length
					? `\nTool calls: ${JSON.stringify(message.tool_calls)}`
					: ''
			return `[${index + 1}] ${message.getType()}:\n${stringifyContent(message.content)}${toolCalls}`
		})
		.join('\n\n')
}
