import {
	compressChatContextIfNeeded,
	type AutomaticContextCompressionResult,
} from './agent'
import { type ContextCompressionResult } from './runtime/context'

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
