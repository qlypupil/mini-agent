import type { ToolAuthorization } from './index'
import { isSafeDomain } from './is-safe-domains'

export function authorizeNetwork(
	args: Record<string, unknown>,
): ToolAuthorization {
	const url = args.url
	if (typeof url !== 'string') {
		return { action: 'allow' }
	}

	return { action: isSafeDomain(url) ? 'allow' : 'ask' }
}
