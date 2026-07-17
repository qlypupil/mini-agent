import { search } from './search'

describe('search', () => {
	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation()
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('returns foggy weather for San Francisco queries', () => {
		expect(search('San Francisco weather')).toBe(
			"It's 60 degrees and foggy.",
		)
	})

	it('returns sunny weather for other queries', () => {
		expect(search('Beijing weather')).toBe(
			"It's 90 degrees and sunny.",
		)
	})
})
