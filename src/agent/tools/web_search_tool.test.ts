const mockInvoke = jest.fn()

jest.mock('@langchain/tavily', () => ({
	TavilySearch: jest.fn(() => ({ invoke: mockInvoke })),
}))

import { tavilySearchOptions, webSearchTool } from './web_search_tool'

describe('webSearchTool', () => {
	it('uses a general Tavily search with an answer and three results', () => {
		expect(tavilySearchOptions).toMatchObject({
			name: 'web_search',
			maxResults: 3,
			topic: 'general',
			includeAnswer: true,
		})
		expect(webSearchTool.permission_level).toBe('network')
	})

	it('passes the query to Tavily and returns its structured result', async () => {
		const result = {
			query: 'Mini Agent latest news',
			answer: 'Mini Agent shipped a new release.',
			results: [{ title: 'Mini Agent release' }],
		}
		mockInvoke.mockResolvedValue(result)

		await expect(webSearchTool.invoke({ query: 'Mini Agent latest news' })).resolves.toBe(
			result,
		)
		expect(mockInvoke).toHaveBeenCalledWith({
			query: 'Mini Agent latest news',
		})
	})
})
