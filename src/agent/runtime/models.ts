import { ChatOpenAI } from '@langchain/openai'

export const MODEL_PROVIDERS = ['kimi', 'deepseek'] as const
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

export const DEFAULT_MODEL_PROVIDER: ModelProvider = 'kimi'
export const DEFAULT_KIMI_MODEL = 'kimi-k2.6'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'

interface ModelDefinition {
	apiKeyEnv: string
	baseUrlEnv: string
	modelEnv: string
	defaultBaseUrl: string
	defaultModel: string
}

const MODEL_DEFINITIONS: Record<ModelProvider, ModelDefinition> = {
	kimi: {
		apiKeyEnv: 'MOONSHOT_API_KEY',
		baseUrlEnv: 'MOONSHOT_BASE_URL',
		modelEnv: 'MOONSHOT_MODEL',
		defaultBaseUrl: 'https://api.moonshot.cn/v1',
		defaultModel: DEFAULT_KIMI_MODEL,
	},
	deepseek: {
		apiKeyEnv: 'DEEPSEEK_API_KEY',
		baseUrlEnv: 'DEEPSEEK_BASE_URL',
		modelEnv: 'DEEPSEEK_MODEL',
		defaultBaseUrl: 'https://api.deepseek.com',
		defaultModel: DEFAULT_DEEPSEEK_MODEL,
	},
}

export interface ModelMetadata {
	provider: ModelProvider
	model: string
}

export function resolveModelProvider(value: string): ModelProvider {
	const normalized = value.trim().toLowerCase()
	if (MODEL_PROVIDERS.includes(normalized as ModelProvider)) {
		return normalized as ModelProvider
	}

	throw new Error(`不支持的模型: ${value}。可选值: ${MODEL_PROVIDERS.join(', ')}`)
}

export function getDefaultModelProvider(
	env: NodeJS.ProcessEnv = process.env,
): ModelProvider {
	return env.MODEL_PROVIDER
		? resolveModelProvider(env.MODEL_PROVIDER)
		: DEFAULT_MODEL_PROVIDER
}

export function getModelMetadata(
	provider: ModelProvider,
	env: NodeJS.ProcessEnv = process.env,
): ModelMetadata {
	const definition = MODEL_DEFINITIONS[provider]
	return {
		provider,
		model: env[definition.modelEnv]?.trim() || definition.defaultModel,
	}
}

export function formatModelSelection(
	provider: ModelProvider,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const metadata = getModelMetadata(provider, env)
	return `${metadata.provider} (${metadata.model})`
}

export function createChatModel(
	provider: ModelProvider,
	env: NodeJS.ProcessEnv = process.env,
): ChatOpenAI {
	const definition = MODEL_DEFINITIONS[provider]
	const apiKey = env[definition.apiKeyEnv]?.trim()
	if (!apiKey) {
		throw new Error(`${definition.apiKeyEnv} is not set`)
	}

	return new ChatOpenAI({
		model: env[definition.modelEnv]?.trim() || definition.defaultModel,
		apiKey,
		configuration: {
			baseURL:
				env[definition.baseUrlEnv]?.trim() || definition.defaultBaseUrl,
		},
		streaming: true,
		// 标准工具循环不会回传 DeepSeek thinking mode 要求的 reasoning_content。
		...(provider === 'deepseek'
			? { modelKwargs: { thinking: { type: 'disabled' } } }
			: {}),
	})
}
