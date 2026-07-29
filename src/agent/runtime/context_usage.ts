export const DEFAULT_MOONSHOT_MODEL = 'kimi-k2.6'

const MODEL_CONTEXT_LIMITS: Record<string, number> = {
	'kimi-k2.6': 262_144,
}

const CONTEXT_USAGE_WARNING_THRESHOLD = 0.8

export interface ContextUsage {
	model: string
	inputTokens?: number
	contextLimit?: number
}

export function getModelContextLimit(model: string): number | undefined {
	return MODEL_CONTEXT_LIMITS[model]
}

export function getLatestInputTokens(usageMetadata: unknown[]): number | undefined {
	let inputTokens: number | undefined

	for (const usage of usageMetadata) {
		if (
			typeof usage === 'object' &&
			usage !== null &&
			typeof (usage as { input_tokens?: unknown }).input_tokens === 'number'
		) {
			inputTokens = (usage as { input_tokens: number }).input_tokens
		}
	}

	return inputTokens
}

function formatTokens(tokens: number | undefined): string {
	return tokens === undefined ? '未知' : tokens.toLocaleString('en-US')
}

export function formatContextUsage(usage: ContextUsage): string {
	const { inputTokens, contextLimit } = usage
	const percentage =
		inputTokens === undefined || contextLimit === undefined
			? '未知'
			: `${((inputTokens / contextLimit) * 100).toFixed(2)}%`

	return `Context: ${formatTokens(inputTokens)} / ${formatTokens(contextLimit)} tokens (${percentage})`
}

export function shouldWarnContextUsage(usage: ContextUsage): boolean {
	const { inputTokens, contextLimit } = usage

	return (
		inputTokens !== undefined &&
		contextLimit !== undefined &&
		inputTokens / contextLimit >= CONTEXT_USAGE_WARNING_THRESHOLD
	)
}
