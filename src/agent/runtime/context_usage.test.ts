import {
	formatContextUsage,
	getLatestInputTokens,
	getModelContextLimit,
	shouldWarnContextUsage,
} from './context_usage'
import { DEFAULT_DEEPSEEK_MODEL, DEFAULT_KIMI_MODEL } from './models'

describe('getModelContextLimit', () => {
	it('returns the known context limit for the default model', () => {
		expect(getModelContextLimit(DEFAULT_KIMI_MODEL)).toBe(262_144)
		expect(getModelContextLimit(DEFAULT_DEEPSEEK_MODEL)).toBe(1_048_576)
	})

	it('leaves an unknown model limit undefined', () => {
		expect(getModelContextLimit('other-provider-model')).toBeUndefined()
	})
})

describe('getLatestInputTokens', () => {
	it('uses the final model request usage from a tool loop', () => {
		expect(
			getLatestInputTokens([
				{ input_tokens: 120, output_tokens: 4 },
				undefined,
				{ input_tokens: 360, output_tokens: 12 },
			]),
		).toBe(360)
	})

	it('returns undefined when the provider omits streamed usage', () => {
		expect(getLatestInputTokens([undefined, {}])).toBeUndefined()
	})
})

describe('formatContextUsage', () => {
	it('renders token count, limit, and percentage', () => {
		expect(
			formatContextUsage({
				model: DEFAULT_KIMI_MODEL,
				inputTokens: 13_107,
				contextLimit: 262_144,
			}),
		).toBe('Context: 13,107 / 262,144 tokens (5.00%)')
	})

	it('does not invent values for unavailable usage or context limits', () => {
		expect(
			formatContextUsage({ model: 'other-provider-model' }),
		).toBe('Context: 未知 / 未知 tokens (未知)')
	})
})

describe('shouldWarnContextUsage', () => {
	it('warns when usage reaches 80 percent', () => {
		expect(
			shouldWarnContextUsage({
				model: DEFAULT_KIMI_MODEL,
				inputTokens: 80,
				contextLimit: 100,
			}),
		).toBe(true)
	})

	it('does not warn below 80 percent or without complete usage data', () => {
		expect(
			shouldWarnContextUsage({
				model: DEFAULT_KIMI_MODEL,
				inputTokens: 79,
				contextLimit: 100,
			}),
		).toBe(false)
		expect(shouldWarnContextUsage({ model: DEFAULT_KIMI_MODEL })).toBe(false)
	})
})
