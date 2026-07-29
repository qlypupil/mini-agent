import {
	createChatModel,
	DEFAULT_DEEPSEEK_MODEL,
	DEFAULT_KIMI_MODEL,
	formatModelSelection,
	getDefaultModelProvider,
	getModelMetadata,
	resolveModelProvider,
} from './models'

describe('model configuration', () => {
	it('defaults to Kimi and accepts provider names case-insensitively', () => {
		expect(getDefaultModelProvider({})).toBe('kimi')
		expect(resolveModelProvider(' DeepSeek ')).toBe('deepseek')
		expect(() => resolveModelProvider('unknown')).toThrow(
			'不支持的模型: unknown。可选值: kimi, deepseek',
		)
	})

	it('reports model metadata without exposing the API key', () => {
		const env = {
			DEEPSEEK_API_KEY: 'test-key',
			DEEPSEEK_MODEL: 'custom-deepseek-model',
		}

		expect(getModelMetadata('deepseek', env)).toEqual({
			provider: 'deepseek',
			model: 'custom-deepseek-model',
		})
		expect(formatModelSelection('deepseek', env)).toBe(
			'deepseek (custom-deepseek-model)',
		)
	})

	it('uses the official defaults for both providers', () => {
		const kimi = createChatModel('kimi', { MOONSHOT_API_KEY: 'test-key' })
		const deepseek = createChatModel('deepseek', {
			DEEPSEEK_API_KEY: 'test-key',
		})

		expect(kimi.model).toBe(DEFAULT_KIMI_MODEL)
		expect((kimi as any).clientConfig.baseURL).toBe(
			'https://api.moonshot.cn/v1',
		)
		expect(deepseek.model).toBe(DEFAULT_DEEPSEEK_MODEL)
		expect((deepseek as any).clientConfig.baseURL).toBe(
			'https://api.deepseek.com',
		)
		expect(deepseek.modelKwargs).toEqual({
			thinking: { type: 'disabled' },
		})
	})

	it('fails only when the selected provider has no API key', () => {
		expect(() => createChatModel('deepseek', {})).toThrow(
			'DEEPSEEK_API_KEY is not set',
		)
	})
})
