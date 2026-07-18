import { spawn } from 'node:child_process'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { realpath } from 'node:fs/promises'

// 防止模型触发长时间运行的子进程，或将大日志完整送回上下文。
const COMMAND_TIMEOUT_MS = 5_000
const MAX_OUTPUT_BYTES = 64 * 1024

export type ExecInput = {
	command: string
	path?: string
	query?: string
	maxDepth?: number
}

function assertInsideRoot(root: string, target: string): string {
	const relativePath = relative(root, target)

	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error('Only paths in the current directory can be used.')
	}

	return relativePath
}

function assertSafePath(relativePath: string): void {
	const segments = relativePath.split(sep)

	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive paths cannot be used.')
	}
}

async function resolveSafePath(inputPath = '.'): Promise<string> {
	if (isAbsolute(inputPath)) {
		throw new Error('Only relative paths are allowed.')
	}

	const root = await realpath(process.cwd())
	const requestedPath = resolve(root, inputPath)
	assertSafePath(assertInsideRoot(root, requestedPath))

	// Resolve symbolic links before executing a command against the target path.
	const resolvedPath = await realpath(requestedPath)
	assertSafePath(assertInsideRoot(root, resolvedPath))

	return resolvedPath
}

function runCommand(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolveCommand, rejectCommand) => {
		const child = spawn(command, args, {
			cwd,
			// 不启动 shell，模型输入无法利用管道、重定向或命令替换拼接额外操作。
			shell: false,
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
	const root = await realpath(process.cwd())

	// 只分发预先定义的只读命令，模型不能自定义二进制文件或命令参数。
	switch (input.command) {
		case 'pwd':
			return runCommand('pwd', [], root)
		case 'ls': {
			const path = await resolveSafePath(input.path)
			return runCommand('ls', ['-la', path], root)
		}
		case 'find': {
			const path = await resolveSafePath(input.path)
			const maxDepth = input.maxDepth ?? 2

			if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 5) {
				throw new Error('maxDepth must be an integer between 0 and 5.')
			}

			return runCommand('find', [path, '-maxdepth', String(maxDepth), '-type', 'f'], root)
		}
		case 'rg': {
			if (!input.query) {
				throw new Error('A query is required for rg.')
			}

			const path = await resolveSafePath(input.path)
			return runCommand(
				'rg',
				[
					'--line-number',
					'--max-count',
					'50',
					'--glob',
					'!**/.env*',
					'--glob',
					'!**/.git/**',
					// -- 结束选项解析，保证模型提供的查询不会被 rg 解释为命令行选项。
					'--',
					input.query,
					path,
				],
				root,
			)
		}
		case 'git_status':
			return runCommand('git', ['status', '--short'], root)
		case 'git_diff':
			return runCommand('git', ['diff', '--no-ext-diff'], root)
		case 'git_log':
			return runCommand('git', ['log', '--oneline', '-20'], root)
		default:
			throw new Error(`Command is not allowed: ${input.command}`)
	}
}
