import { spawn } from 'node:child_process'
import { z } from 'zod'

// 防止模型触发长时间运行的子进程，或将大日志完整送回上下文。
const COMMAND_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 64 * 1024

export const execSchema = z.object({
	command: z.string().trim().min(1).describe('The complete shell command to execute.'),
})

export type ExecInput = z.infer<typeof execSchema>

function runCommand(command: string): Promise<string> {
	return new Promise((resolveCommand, rejectCommand) => {
		const child = spawn(command, {
			cwd: process.cwd(),
			// 完整命令由 shell 解析；具体放行、确认和拒绝留给后续权限层处理。
			shell: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		})
		let stdout = ''
		let stderr = ''
		let outputBytes = 0
		let timedOut = false
		let exceededOutputLimit = false

		const appendOutput = (chunk: Buffer, destination: 'stdout' | 'stderr') => {
			outputBytes += chunk.length

			// 到达上限立即停止子进程，避免大型文件或递归列表撑满模型上下文。
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
		child.on('error', rejectCommand)

		const timeout = setTimeout(() => {
			timedOut = true
			child.kill()
		}, COMMAND_TIMEOUT_MS)

		child.on('close', (code) => {
			clearTimeout(timeout)

			if (timedOut) {
				rejectCommand(new Error('Command timed out.'))
				return
			}

			if (exceededOutputLimit) {
				rejectCommand(new Error('Command output exceeded the 64 KB limit.'))
				return
			}

			if (code !== 0) {
				rejectCommand(new Error(stderr || `Command failed with exit code ${code}.`))
				return
			}

			resolveCommand(stdout)
		})
	})
}

export async function execTool(input: ExecInput): Promise<string> {
	return runCommand(input.command)
}
