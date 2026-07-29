import { randomUUID } from 'node:crypto'
import { BaseMessage } from '@langchain/core/messages'
import { type ContextControl } from '../runtime/graph'
import {
	applyContextPatch,
	formatContextMessages,
	parseMessageSelector,
	validateContextPatch,
	type ContextOperation,
	type ContextPatch,
} from '../runtime/context_patch'

export interface ContextSessionDependencies {
	getThreadId: () => string
	setThreadId: (threadId: string) => void
	getMessages: (threadId: string) => Promise<BaseMessage[]>
	persistPatch: (threadId: string, patch: ContextPatch) => Promise<void>
	seedSession: (threadId: string, messages: BaseMessage[]) => Promise<void>
	summarize: (messages: BaseMessage[]) => Promise<string>
	readSummaryFile: (path: string) => Promise<string>
	createThreadId?: () => string
}

interface PendingContextPatch {
	threadId: string
	patch: ContextPatch
	readyOnce: boolean
}

const CONTEXT_USAGE = [
	'Context 命令:',
	'  /context show',
	'  /context replace <序号> <新内容>',
	'  /context remove <序号或范围>',
	'  /context summarize <序号范围>',
	'  /context load-summary <序号范围> <txt_path>',
	'  /context preview',
	'  /context apply once|persist|fork',
	'  /context cancel',
].join('\n')

export class ContextSessionManager {
	private pending?: PendingContextPatch

	constructor(private readonly dependencies: ContextSessionDependencies) {}

	clear(): void {
		this.pending = undefined
	}

	peekNextContextControl(threadId: string): ContextControl | undefined {
		if (
			!this.pending ||
			this.pending.threadId !== threadId ||
			!this.pending.readyOnce
		) {
			return undefined
		}

		return {
			mode: 'once',
			patch: this.pending.patch,
		}
	}

	completeNextContextControl(threadId: string): void {
		if (
			this.pending?.threadId === threadId &&
			this.pending.readyOnce
		) {
			this.pending = undefined
		}
	}

	private async getCurrentMessages(): Promise<BaseMessage[]> {
		return this.dependencies.getMessages(this.dependencies.getThreadId())
	}

	private async stage(operation: ContextOperation): Promise<string> {
		const threadId = this.dependencies.getThreadId()
		const messages = await this.dependencies.getMessages(threadId)
		const existingOperations =
			this.pending?.threadId === threadId
				? this.pending.patch.operations
				: []
		const patch = {
			operations: [...existingOperations, operation],
		}
		validateContextPatch(messages, patch)

		this.pending = {
			threadId,
			patch,
			readyOnce: false,
		}
		return `已暂存 Context 修改，共 ${patch.operations.length} 项。输入 /context preview 查看结果。`
	}

	private requirePending(): PendingContextPatch {
		const threadId = this.dependencies.getThreadId()
		if (!this.pending || this.pending.threadId !== threadId) {
			throw new Error('当前会话没有待应用的 Context 修改。')
		}
		return this.pending
	}

	private async show(): Promise<string> {
		const messages = await this.getCurrentMessages()
		const pending =
			this.pending?.threadId === this.dependencies.getThreadId()
				? `\n\n待应用修改: ${this.pending.patch.operations.length} 项${this.pending.readyOnce ? '（下一轮生效）' : ''}`
				: ''
		return `${formatContextMessages(messages)}${pending}`
	}

	private async preview(): Promise<string> {
		const pending = this.requirePending()
		const messages = await this.getCurrentMessages()
		return formatContextMessages(applyContextPatch(messages, pending.patch))
	}

	private async replace(rawArgs: string): Promise<string> {
		const match = /^replace\s+(\d+)\s+([\s\S]+)$/.exec(rawArgs)
		if (!match) throw new Error('用法: /context replace <序号> <新内容>')

		const messages = await this.getCurrentMessages()
		const [messageId] = parseMessageSelector(match[1], messages)
		return this.stage({
			type: 'replace',
			messageId,
			content: match[2],
		})
	}

	private async remove(rawArgs: string): Promise<string> {
		const match = /^remove\s+(\S+)$/.exec(rawArgs)
		if (!match) throw new Error('用法: /context remove <序号或范围>')

		const messages = await this.getCurrentMessages()
		return this.stage({
			type: 'remove',
			messageIds: parseMessageSelector(match[1], messages),
		})
	}

	private async summarize(rawArgs: string): Promise<string> {
		const match = /^summarize\s+(\S+)$/.exec(rawArgs)
		if (!match) throw new Error('用法: /context summarize <序号范围>')

		const messages = await this.getCurrentMessages()
		const messageIds = parseMessageSelector(match[1], messages)
		validateContextPatch(messages, {
			operations: [{ type: 'replaceRange', messageIds, summary: 'pending' }],
		})
		const selectedIds = new Set(messageIds)
		const selectedMessages = messages.filter(
			(message) => message.id && selectedIds.has(message.id),
		)
		const summary = await this.dependencies.summarize(selectedMessages)

		return this.stage({ type: 'replaceRange', messageIds, summary })
	}

	private async loadSummary(rawArgs: string): Promise<string> {
		const match = /^load-summary\s+(\S+)\s+([\s\S]+)$/.exec(rawArgs)
		if (!match) {
			throw new Error('用法: /context load-summary <序号范围> <txt_path>')
		}

		const messages = await this.getCurrentMessages()
		const summary = (await this.dependencies.readSummaryFile(match[2].trim())).trim()
		return this.stage({
			type: 'replaceRange',
			messageIds: parseMessageSelector(match[1], messages),
			summary,
		})
	}

	private async apply(mode: string): Promise<string> {
		const pending = this.requirePending()
		if (!['once', 'persist', 'fork'].includes(mode)) {
			throw new Error('用法: /context apply once|persist|fork')
		}

		if (mode === 'once') {
			pending.readyOnce = true
			return 'Context 修改将在下一轮请求中生效，不会替换 SQLite 中的原历史。'
		}

		if (mode === 'persist') {
			await this.dependencies.persistPatch(pending.threadId, pending.patch)
			this.pending = undefined
			return 'Context 修改已永久写入当前会话。'
		}

		const messages = await this.dependencies.getMessages(pending.threadId)
		const threadId = (this.dependencies.createThreadId ?? randomUUID)()
		await this.dependencies.seedSession(
			threadId,
			applyContextPatch(messages, pending.patch),
		)
		this.dependencies.setThreadId(threadId)
		this.pending = undefined
		return `已基于修改后的 Context 创建新会话: ${threadId}`
	}

	async handle(rawArgs: string): Promise<string> {
		const args = rawArgs.trim()
		if (!args) return CONTEXT_USAGE
		if (args === 'show') return this.show()
		if (args === 'preview') return this.preview()
		if (args === 'cancel') {
			this.clear()
			return '已取消待应用的 Context 修改。'
		}
		if (args.startsWith('replace ')) return this.replace(args)
		if (args.startsWith('remove ')) return this.remove(args)
		if (args.startsWith('summarize ')) return this.summarize(args)
		if (args.startsWith('load-summary ')) return this.loadSummary(args)
		if (args.startsWith('apply ')) return this.apply(args.slice('apply '.length).trim())

		throw new Error(CONTEXT_USAGE)
	}
}
