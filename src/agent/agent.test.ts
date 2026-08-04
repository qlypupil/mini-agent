import {
	collectToolApprovalDecisions,
	compressChatContextIfNeeded,
	type AutomaticContextCompressionResult,
} from './agent'
import { type ContextCompressionResult } from './runtime/context'
import { type ToolApprovalRequest } from './runtime/graph'

const contextUsage = {
	model: 'kimi-k2.6',
	inputTokens: 209_716,
	contextLimit: 262_144,
}

describe('automatic Context compression orchestration', () => {
	it('does not run compression below the usage threshold', async () => {
		const compress = jest.fn()
		const onStart = jest.fn()

		const result = await compressChatContextIfNeeded(
			'thread-1',
			{ ...contextUsage, inputTokens: 209_715 },
			'kimi',
			{ compress, onStart },
		)

		expect(result).toEqual({ status: 'not-needed' })
		expect(compress).not.toHaveBeenCalled()
		expect(onStart).not.toHaveBeenCalled()
	})

	it('runs compression at the threshold and returns its result', async () => {
		const compression: ContextCompressionResult = {
			compressed: true,
			newlyCompressedMessageCount: 2,
			retainedMessageCount: 6,
			compressionCount: 1,
		}
		const compress = jest.fn().mockResolvedValue(compression)
		const onStart = jest.fn()

		const result = await compressChatContextIfNeeded(
			'thread-1',
			contextUsage,
			'kimi',
			{ compress, onStart },
		)

		expect(result).toEqual({ status: 'completed', compression })
		expect(onStart).toHaveBeenCalledTimes(1)
		expect(compress).toHaveBeenCalledWith('thread-1', 'kimi')
	})

	it('keeps a completed AI response successful when compression fails', async () => {
		const result: AutomaticContextCompressionResult =
			await compressChatContextIfNeeded(
				'thread-1',
				contextUsage,
				'kimi',
				{
					compress: jest.fn().mockRejectedValue(new Error('summary unavailable')),
				},
			)

		expect(result).toEqual({
			status: 'failed',
			error: 'summary unavailable',
	})
	})
})

describe('tool approval orchestration', () => {
	const requests = [
		{
			id: 'call-1',
			name: 'read_file',
			args: { path: '/tmp/a.txt' },
			permissionLevel: 'read' as const,
		},
		{
			id: 'call-2',
			name: 'write_file',
			args: { path: '/tmp/b.txt', content: 'hello' },
			permissionLevel: 'write' as const,
		},
	]

	it('rejects every request when no approval callback is provided', async () => {
		const onToolEvent = jest.fn()

		await expect(
			collectToolApprovalDecisions(requests, undefined, onToolEvent),
		).resolves.toEqual([{ type: 'reject' }, { type: 'reject' }])
		expect(onToolEvent.mock.calls.map(([event]) => event)).toEqual([
			{ name: 'read_file', status: 'rejected' },
			{ name: 'write_file', status: 'rejected' },
		])
	})

	it('collects independent decisions in request order', async () => {
		const reviewed: string[] = []
		const onToolApproval = jest.fn(async (request: ToolApprovalRequest) => {
			reviewed.push(request.name)
			return request.name === 'read_file'
		})

		await expect(
			collectToolApprovalDecisions(requests, onToolApproval),
		).resolves.toEqual([{ type: 'approve' }, { type: 'reject' }])
		expect(reviewed).toEqual(['read_file', 'write_file'])
		expect(onToolApproval).toHaveBeenCalledTimes(2)
	})
})
