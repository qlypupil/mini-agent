import { lookup } from 'node:dns/promises'
import { webFetchTool } from './web_fetch_tool'

jest.mock('node:dns/promises', () => ({
	lookup: jest.fn(),
}))

const mockLookup = lookup as jest.MockedFunction<typeof lookup>

function textResponse(content: string, contentType = 'text/html'): Response {
	return {
		body: null,
		headers: new Headers({
			'content-type': contentType,
			'content-length': String(Buffer.byteLength(content, 'utf8')),
		}),
		ok: true,
		status: 200,
		text: jest.fn().mockResolvedValue(content),
	} as unknown as Response
}

function redirectResponse(location: string): Response {
	return {
		body: null,
		headers: new Headers({ location }),
		ok: false,
		status: 302,
	} as unknown as Response
}

describe('webFetchTool', () => {
	beforeEach(() => {
		// lookup() 的 all: true 重载返回数组，Jest 无法从重载函数类型中推断该分支。
		mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
	})

	it('returns text content from a public HTTP URL', async () => {
		const request = jest.fn().mockResolvedValue(textResponse('<h1>Hello</h1>'))

		await expect(webFetchTool('https://example.com/page', request)).resolves.toContain(
			'<h1>Hello</h1>',
		)
		expect(mockLookup).toHaveBeenCalledWith('example.com', {
			all: true,
			verbatim: true,
		})
	})

	it('rejects non-HTTP URLs', async () => {
		await expect(webFetchTool('file:///etc/passwd')).rejects.toThrow(
			'Only HTTP and HTTPS URLs are allowed.',
		)
	})

	it('rejects local network URLs', async () => {
		await expect(webFetchTool('http://127.0.0.1/admin')).rejects.toThrow(
			'Local network URLs are not allowed.',
		)
	})

	it('returns request errors to the agent', async () => {
		const request = jest.fn().mockRejectedValue(new Error('Network unavailable'))

		await expect(webFetchTool('https://example.com', request)).rejects.toThrow(
			'Network unavailable',
		)
	})

	it('follows same-domain redirects', async () => {
		const request = jest
			.fn()
			.mockResolvedValueOnce(redirectResponse('/new-location'))
			.mockResolvedValueOnce(textResponse('redirected'))

		await expect(
			webFetchTool('https://example.com/old-location', request),
		).resolves.toContain('redirected')
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('follows cross-domain redirects to another listed domain', async () => {
		const request = jest
			.fn()
			.mockResolvedValueOnce(
				redirectResponse('https://raw.githubusercontent.com/openai/codex/main/README.md'),
			)
			.mockResolvedValueOnce(textResponse('readme'))

		await expect(
			webFetchTool('https://github.com/openai/codex', request),
		).resolves.toContain('readme')
		expect(request).toHaveBeenCalledTimes(2)
	})

	it('requires a new tool call before redirecting to an unlisted domain', async () => {
		const request = jest
			.fn()
			.mockResolvedValueOnce(redirectResponse('https://example.com/landing'))

		await expect(
			webFetchTool('https://github.com/openai/codex', request),
		).rejects.toThrow(
			'Redirect target requires a separate web_fetch tool call and user confirmation: https://example.com/landing',
		)
		expect(request).toHaveBeenCalledTimes(1)
		expect(mockLookup).not.toHaveBeenCalledWith('example.com', expect.anything())
	})

	it('rejects responses larger than 1 MB', async () => {
		const response = textResponse('small content')
		jest.spyOn(response.headers, 'get').mockImplementation((name) =>
			name === 'content-length' ? String(1_024 * 1_024 + 1) : 'text/html',
		)
		const request = jest.fn().mockResolvedValue(response)

		await expect(webFetchTool('https://example.com', request)).rejects.toThrow(
			'Response exceeded the 1 MB limit.',
		)
	})

	it('truncates text sent to the agent at 8 KB', async () => {
		const request = jest.fn().mockResolvedValue(textResponse('a'.repeat(8 * 1_024 + 1)))

		await expect(webFetchTool('https://example.com', request)).resolves.toContain(
			'[Content truncated at 8 KB.]',
		)
	})
})
