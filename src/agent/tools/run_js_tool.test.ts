import { runJavaScript, runJsTool } from './run_js_tool'

describe('runJsTool', () => {
	it('returns JavaScript stdout', async () => {
		await expect(runJsTool('console.log(2 + 3)')).resolves.toBe('5\n')
	})

	it('runs multi-line asynchronous JavaScript', async () => {
		const code = `
			const values = [1, 2, 3]
			const total = await Promise.resolve(values.reduce((sum, value) => sum + value, 0))
			console.log(total)
		`

		await expect(runJsTool(code)).resolves.toBe('6\n')
	})

	it('runs complex JavaScript data processing', async () => {
		const code = `
			const records = [
				{ category: 'book', price: 35 },
				{ category: 'book', price: 65 },
				{ category: 'game', price: 80 },
			]
			const totals = Object.groupBy(records, ({ category }) => category)
			console.log(totals.book.reduce((sum, item) => sum + item.price, 0))
		`

		await expect(runJsTool(code)).resolves.toBe('100\n')
	})

	it('preserves Chinese, quotes, and template literals in output', async () => {
		const code = "const name = 'Pupil'; console.log(`你好，${name}：\"测试\"`);"

		await expect(runJsTool(code)).resolves.toBe('你好，Pupil："测试"\n')
	})

	it('returns syntax error details', async () => {
		await expect(runJsTool('const = 1')).resolves.toContain('SyntaxError')
	})

	it('returns runtime error details', async () => {
		await expect(runJsTool("throw new Error('boom')")).resolves.toContain('boom')
	})

	it('denies file system access', async () => {
		await expect(
			runJsTool("import { readFileSync } from 'node:fs'; readFileSync('package.json')"),
		).resolves.toContain('ERR_ACCESS_DENIED')
	})

	it('does not expose parent environment variables', async () => {
		await expect(
			runJsTool("console.log(process.env.MOONSHOT_API_KEY ?? 'missing')"),
		).resolves.toBe('missing\n')
	})

	it('reports when Node.js is unavailable', async () => {
		await expect(
			runJavaScript('console.log(1)', 'node-command-not-installed'),
		).resolves.toContain('Node.js is not installed')
	})
})
