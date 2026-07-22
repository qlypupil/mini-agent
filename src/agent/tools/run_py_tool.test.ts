import { runPython, runPyTool } from './run_py_tool'

describe('runPyTool', () => {
	it('returns Python stdout', async () => {
		await expect(runPyTool('print(2 + 3)')).resolves.toBe('5\n')
	})

	it('runs multi-line Python', async () => {
		const code = `
values = [1, 2, 3]
total = sum(values)
print(total)
`

		await expect(runPyTool(code)).resolves.toBe('6\n')
	})

	it('runs complex Python data processing', async () => {
		const code = `
from collections import defaultdict

records = [
    {"category": "book", "price": 35},
    {"category": "book", "price": 65},
    {"category": "game", "price": 80},
]
totals = defaultdict(int)
for item in records:
    totals[item["category"]] += item["price"]
print(totals["book"])
`

		await expect(runPyTool(code)).resolves.toBe('100\n')
	})

	it('preserves Chinese, quotes, and f-strings in output', async () => {
		const code = 'name = "Pupil"; print(f\'你好，{name}："测试"\')'

		await expect(runPyTool(code)).resolves.toBe('你好，Pupil："测试"\n')
	})

	it('returns syntax error details', async () => {
		await expect(runPyTool('def = 1')).resolves.toContain('SyntaxError')
	})

	it('returns runtime error details', async () => {
		await expect(runPyTool('raise RuntimeError("boom")')).resolves.toContain('boom')
	})

	it('does not expose parent environment variables', async () => {
		await expect(
			runPyTool('import os; print(os.environ.get("MOONSHOT_API_KEY", "missing"))'),
		).resolves.toBe('missing\n')
	})

	it('reports when Python 3 is unavailable', async () => {
		await expect(
			runPython('print(1)', 'python3-command-not-installed'),
		).resolves.toContain('Python 3 is not installed')
	})

	it('rejects oversized source', async () => {
		const code = `print(1)\n${'x'.repeat(20 * 1024)}`

		await expect(runPyTool(code)).resolves.toBe('Python source exceeded the 20 KB limit.')
	})
})
