import type { ToolApprovalRequest } from '../runtime/graph'

export type ToolApprovalAnswer = 'approve' | 'reject' | 'invalid'

export function parseToolApprovalAnswer(answer: string): ToolApprovalAnswer {
	const normalized = answer.trim().toLowerCase()
	if (normalized === 'y' || normalized === 'yes') return 'approve'
	if (normalized === '' || normalized === 'n' || normalized === 'no') {
		return 'reject'
	}
	return 'invalid'
}

export function formatToolApprovalRequest(request: ToolApprovalRequest): string {
	return [
		`[Confirm] Tool: ${request.name}`,
		`Permission: ${request.permissionLevel}`,
		'Arguments:',
		JSON.stringify(request.args, null, 2),
	].join('\n')
}
