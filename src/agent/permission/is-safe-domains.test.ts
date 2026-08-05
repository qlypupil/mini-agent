import {
	commonDomainsCNForDevelopers,
	isSafeDomain,
} from './is-safe-domains'

describe('isSafeDomain', () => {
	it('keeps exactly 100 unique lowercase main domains', () => {
		expect(commonDomainsCNForDevelopers).toHaveLength(100)
		expect(new Set(commonDomainsCNForDevelopers).size).toBe(100)
		for (const domain of commonDomainsCNForDevelopers) {
			expect(domain).toBe(domain.toLowerCase())
			expect(domain).toMatch(
				/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/,
			)
		}
	})

	it.each([
		'https://github.com/openai/codex',
		'https://docs.github.com/en',
		'https://GITHUB.COM:443/path?query=value',
		'https://github.com./openai/codex',
		'http://juejin.cn/post/1',
	])('allows a listed domain or its subdomain: %s', (url) => {
		expect(isSafeDomain(url)).toBe(true)
	})

	it.each([
		'https://example.com',
		'https://evilgithub.com',
		'https://github.com.evil.example',
		'https://github.com@evil.example',
		'ftp://github.com/archive',
		'/relative/path',
		'not a url',
	])('rejects an unlisted, deceptive, or invalid URL: %s', (url) => {
		expect(isSafeDomain(url)).toBe(false)
	})
})
