// 示例搜索实现：尚未接入真实搜索服务。
export function search(query: string): string {
	console.log(`\n[Tool] search called: "${query}"`)

	if (
		query.toLowerCase().includes('sf') ||
		query.toLowerCase().includes('san francisco')
	) {
		return "It's 60 degrees and foggy."
	}

	return "It's 90 degrees and sunny."
}
