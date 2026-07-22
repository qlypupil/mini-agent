import { spawn } from 'node:child_process'

const PYTHON_COMMAND = 'python3'
const COMMAND_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_CODE_BYTES = 20 * 1024

function runPython(code: string, pythonCommand = PYTHON_COMMAND): Promise<string> {
	return new Promise((resolveResult) => {
		const child = spawn(
			pythonCommand,
			// -I：隔离模式，忽略用户 site 与 PYTHON* 环境变量，减少外部环境影响。
			['-I', '-c', code],
			{
				cwd: process.cwd(),
				// 不启动 shell，且只传 PATH，避免模型代码获得项目中的密钥环境变量。
				shell: false,
				env: { PATH: process.env.PATH ?? '' },
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		)
		let stdout = ''
		let stderr = ''
		let outputBytes = 0
		let timedOut = false
		let exceededOutputLimit = false
		let settled = false

		const finish = (result: string) => {
			if (settled) {
				return
			}

			settled = true
			clearTimeout(timeout)
			resolveResult(result)
		}

		const appendOutput = (chunk: Buffer, destination: 'stdout' | 'stderr') => {
			outputBytes += chunk.length

			if (outputBytes > MAX_OUTPUT_BYTES) {
				exceededOutputLimit = true
				child.kill()
				return
			}

			if (destination === 'stdout') {
				stdout += chunk.toString('utf8')
			} else {
				stderr += chunk.toString('utf8')
			}
		}

		child.stdout.on('data', (chunk: Buffer) => appendOutput(chunk, 'stdout'))
		child.stderr.on('data', (chunk: Buffer) => appendOutput(chunk, 'stderr'))
		child.on('error', (error) => {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				finish('Python 3 is not installed or is not available on PATH.')
				return
			}

			finish(`Unable to start Python 3: ${error.message}`)
		})

		const timeout = setTimeout(() => {
			timedOut = true
			child.kill()
		}, COMMAND_TIMEOUT_MS)

		child.on('close', (code) => {
			if (timedOut) {
				finish('Python execution timed out after 5 seconds.')
				return
			}

			if (exceededOutputLimit) {
				finish('Python output exceeded the 64 KB limit.')
				return
			}

			if (code !== 0) {
				finish(`Python execution failed:\n${stderr || stdout}`)
				return
			}

			finish(stdout + stderr)
		})
	})
}

export async function runPyTool(code: string): Promise<string> {
	if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
		return 'Python source exceeded the 20 KB limit.'
	}

	return runPython(code)
}

export { runPython }
