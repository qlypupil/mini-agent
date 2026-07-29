import * as readline from 'node:readline'

export interface SelectMenuOption<T extends string> {
	label: string
	value: T
}

interface SelectMenuInput extends NodeJS.ReadableStream {
	isTTY?: boolean
	isRaw?: boolean
	setRawMode?: (mode: boolean) => void
}

interface SelectMenuIO {
	input: SelectMenuInput
	output: NodeJS.WritableStream
}

/** 在 TTY 中显示一个支持方向键、Enter 和取消操作的轻量选择菜单。 */
export function selectMenu<T extends string>(
	title: string,
	options: SelectMenuOption<T>[],
	initialIndex = 0,
	io: SelectMenuIO = { input: process.stdin, output: process.stdout },
): Promise<T | undefined> {
	if (!io.input.isTTY || options.length === 0) {
		return Promise.resolve(undefined)
	}

	let selectedIndex = Math.min(Math.max(initialIndex, 0), options.length - 1)
	let rendered = false
	const renderedLineCount = options.length + 1
	const wasRaw = io.input.isRaw ?? false
	const wasPaused = io.input.isPaused()

	readline.emitKeypressEvents(io.input)
	io.input.setRawMode?.(true)
	io.input.resume()

	const clearRenderedMenu = () => {
		if (!rendered) return

		readline.moveCursor(io.output, 0, -renderedLineCount)
		readline.cursorTo(io.output, 0)
		readline.clearScreenDown(io.output)
		rendered = false
	}

	const render = () => {
		clearRenderedMenu()
		io.output.write(`${title}\n`)
		for (const [index, option] of options.entries()) {
			io.output.write(`${index === selectedIndex ? '❯' : ' '} ${option.label}\n`)
		}
		rendered = true
	}

	return new Promise((resolve) => {
		const finish = (value?: T, clear = false) => {
			io.input.off('keypress', onKeypress)
			if (clear) clearRenderedMenu()
			io.input.setRawMode?.(wasRaw)
			if (wasPaused) io.input.pause()
			resolve(value)
		}

		const onKeypress = (
			_character: string,
			key: { name?: string; ctrl?: boolean },
		) => {
			if (key.name === 'up') {
				selectedIndex = (selectedIndex - 1 + options.length) % options.length
				render()
				return
			}

			if (key.name === 'down') {
				selectedIndex = (selectedIndex + 1) % options.length
				render()
				return
			}

			if (key.name === 'return' || key.name === 'enter') {
				finish(options[selectedIndex].value)
				return
			}

			if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
				finish(undefined, true)
			}
		}

		io.input.on('keypress', onKeypress)
		render()
	})
}
