import { currentTimeTool } from './current_time_tool'

describe('currentTimeTool', () => {
	it('returns the current time with the host time zone', () => {
		jest.useFakeTimers()
		jest.setSystemTime(new Date('2026-07-18T08:30:00.000Z'))

		const result = JSON.parse(currentTimeTool())

		expect(result.isoTime).toBe('2026-07-18T08:30:00.000Z')
		expect(result.timeZone).toBe(
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		)
		expect(result.localTime).toBeTruthy()

		jest.useRealTimers()
	})
})
