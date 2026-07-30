import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1_024 * 1_024
const MAX_AGENT_CONTENT_BYTES = 8 * 1_024
const MAX_REDIRECTS = 3

function isPrivateAddress(address: string): boolean {
	if (isIP(address) === 4) {
		const [first, second] = address.split('.').map(Number)
		return (
			first === 0 ||
			first === 10 ||
			first === 127 ||
			(first === 100 && second >= 64 && second <= 127) ||
			(first === 169 && second === 254) ||
			(first === 172 && second >= 16 && second <= 31) ||
			(first === 192 && second === 168)
		)
	}

	const normalized = address.toLowerCase()
	return (
		normalized === '::' ||
		normalized === '::1' ||
		normalized.startsWith('fc') ||
		normalized.startsWith('fd') ||
		normalized.startsWith('fe80:')
	)
}

async function assertPublicUrl(value: string): Promise<URL> {
	const url = new URL(value)
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('Only HTTP and HTTPS URLs are allowed.')
	}

	const hostname = url.hostname.toLowerCase()
	if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
		throw new Error('Local network URLs are not allowed.')
	}

	const addresses = isIP(hostname)
		? [{ address: hostname }]
		: await lookup(hostname, { all: true, verbatim: true })
	if (addresses.some(({ address }) => isPrivateAddress(address))) {
		throw new Error('Local network URLs are not allowed.')
	}

	return url
}

function isTextResponse(contentType: string | null): boolean {
	return Boolean(
		contentType?.startsWith('text/') ||
			contentType?.includes('application/json') ||
			contentType?.includes('application/xml') ||
			contentType?.includes('application/javascript'),
	)
}

async function readTextResponse(response: Response): Promise<string> {
	const contentLength = Number(response.headers.get('content-length'))
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error('Response exceeded the 1 MB limit.')
	}

	if (!isTextResponse(response.headers.get('content-type'))) {
		return `Non-text resource: ${response.headers.get('content-type') ?? 'unknown type'}.`
	}

	const reader = response.body?.getReader()
	if (!reader) {
		const content = await response.text()
		if (Buffer.byteLength(content, 'utf8') > MAX_RESPONSE_BYTES) {
			throw new Error('Response exceeded the 1 MB limit.')
		}
		return limitContentForAgent(content)
	}

	const decoder = new TextDecoder()
	let content = ''
	let receivedBytes = 0

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			receivedBytes += value.byteLength
			if (receivedBytes > MAX_RESPONSE_BYTES) {
				throw new Error('Response exceeded the 1 MB limit.')
			}
			if (receivedBytes > MAX_AGENT_CONTENT_BYTES) {
				const remainingBytes = MAX_AGENT_CONTENT_BYTES - (receivedBytes - value.byteLength)
				content += decoder.decode(value.subarray(0, remainingBytes), { stream: true })
				await reader.cancel()
				return `${content}${decoder.decode()}\n\n[Content truncated at 8 KB.]`
			}
			content += decoder.decode(value, { stream: true })
		}
	} finally {
		reader.releaseLock()
	}

	return content + decoder.decode()
}

function limitContentForAgent(content: string): string {
	const buffer = Buffer.from(content, 'utf8')
	if (buffer.byteLength <= MAX_AGENT_CONTENT_BYTES) {
		return content
	}

	return `${buffer.subarray(0, MAX_AGENT_CONTENT_BYTES).toString('utf8')}\n\n[Content truncated at 8 KB.]`
}

export async function webFetchTool(
	url: string,
	request: typeof fetch = fetch,
): Promise<string> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

	try {
		let target = await assertPublicUrl(url)

		for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
			const response = await request(target, {
				redirect: 'manual',
				signal: controller.signal,
			})

			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.get('location')
				if (!location) {
					throw new Error(`Redirect response from ${target} has no location.`)
				}
				if (redirectCount === MAX_REDIRECTS) {
					throw new Error('Too many redirects.')
				}
				target = await assertPublicUrl(new URL(location, target).toString())
				continue
			}

			if (!response.ok) {
				throw new Error(`Request failed with HTTP ${response.status}.`)
			}

			const content = await readTextResponse(response)
			return `URL: ${target}\nContent-Type: ${response.headers.get('content-type') ?? 'unknown'}\n\n${content}`
		}

		throw new Error('Too many redirects.')
	} catch (error) {
		if ((error as Error).name === 'AbortError') {
			throw new Error('Request timed out after 10 seconds.')
		}
		throw error instanceof Error ? error : new Error(String(error))
	} finally {
		clearTimeout(timeout)
	}
}
