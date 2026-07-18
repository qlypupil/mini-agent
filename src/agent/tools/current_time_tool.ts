export function currentTimeTool(): string {
	const now = new Date()
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

	// 同时提供机器可读的 ISO 时间和用户所在系统时区的本地时间，供模型准确回答“今天”和“现在”。
	return JSON.stringify({
		isoTime: now.toISOString(),
		timeZone,
		localTime: new Intl.DateTimeFormat('en-US', {
			dateStyle: 'full',
			timeStyle: 'long',
			timeZone,
		}).format(now),
	})
}
