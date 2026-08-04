import {
	formatToolApprovalRequest,
	parseToolApprovalAnswer,
} from './tool_confirmation'

describe('tool confirmation', () => {
	it.each([
		['y', 'approve'],
		['YES', 'approve'],
		[' n ', 'reject'],
		['no', 'reject'],
		['', 'reject'],
		['later', 'invalid'],
	] as const)('parses %p as %s', (input, expected) => {
		expect(parseToolApprovalAnswer(input)).toBe(expected)
	})

	it('formats the trusted permission level and complete arguments', () => {
		expect(
			formatToolApprovalRequest({
				id: 'call-1',
				name: 'write_file',
				permissionLevel: 'write',
				args: {
					path: '/tmp/example.txt',
					content: 'hello',
				},
			}),
		).toBe(
			'[Confirm] Tool: write_file\nPermission: write\nArguments:\n{\n  "path": "/tmp/example.txt",\n  "content": "hello"\n}',
		)
	})
})
