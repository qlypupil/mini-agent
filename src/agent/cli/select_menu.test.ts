import { PassThrough } from 'node:stream'
import { selectMenu } from './select_menu'

function createMenuIO() {
	const input = new PassThrough() as PassThrough & {
		isTTY: boolean
		isRaw: boolean
		setRawMode: jest.Mock
	}
	input.isTTY = true
	input.isRaw = false
	input.setRawMode = jest.fn((mode: boolean) => {
		input.isRaw = mode
	})
	const output = new PassThrough()

	return { input, output }
}

describe('selectMenu', () => {
	it('selects an option with the down arrow and Enter', async () => {
		const io = createMenuIO()
		const selection = selectMenu(
			'选择模型：',
			[
				{ label: 'Kimi', value: 'kimi' },
				{ label: 'DeepSeek', value: 'deepseek' },
			],
			0,
			io,
		)

		io.input.emit('keypress', '', { name: 'down' })
		io.input.emit('keypress', '', { name: 'return' })

		await expect(selection).resolves.toBe('deepseek')
		expect(io.input.setRawMode).toHaveBeenNthCalledWith(1, true)
		expect(io.input.setRawMode).toHaveBeenLastCalledWith(false)
	})

	it('wraps upward and cancels with ESC', async () => {
		const io = createMenuIO()
		const selection = selectMenu(
			'选择操作：',
			[
				{ label: '查看', value: 'show' },
				{ label: '返回', value: 'back' },
			],
			0,
			io,
		)

		io.input.emit('keypress', '', { name: 'up' })
		io.input.emit('keypress', '', { name: 'escape' })

		await expect(selection).resolves.toBeUndefined()
	})

	it('returns immediately outside a TTY', async () => {
		const io = createMenuIO()
		io.input.isTTY = false

		await expect(
			selectMenu('选择：', [{ label: '选项', value: 'value' }], 0, io),
		).resolves.toBeUndefined()
		expect(io.input.setRawMode).not.toHaveBeenCalled()
	})
})
