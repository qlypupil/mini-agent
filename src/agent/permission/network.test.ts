import { authorizeNetwork } from './network'

describe('authorizeNetwork', () => {
	it('allows tools without a string URL argument', () => {
		for (const args of [{}, { url: undefined }, { url: null }, { url: 42 }]) {
			expect(authorizeNetwork(args)).toEqual({ action: 'allow' })
		}
	})

	it('allows listed domains and their subdomains', () => {
		for (const url of [
			'https://github.com/openai/codex',
			'https://docs.github.com/en',
		]) {
			expect(authorizeNetwork({ url })).toEqual({ action: 'allow' })
		}
	})

	it('asks for unlisted or invalid URLs', () => {
		for (const url of [
			'https://example.com',
			'https://github.com.evil.example',
			'ftp://github.com/archive',
			'',
		]) {
			expect(authorizeNetwork({ url })).toEqual({ action: 'ask' })
		}
	})
})
