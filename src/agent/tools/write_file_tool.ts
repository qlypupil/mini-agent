import { lstat, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function assertInsideRoot(root: string, target: string): string {
	const relativePath = relative(root, target)

	// 相对路径以 .. 开头或仍是绝对路径，表示目标已越出当前工作目录。
	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error('Only files in the current directory can be written.')
	}

	return relativePath
}

function assertSafePath(relativePath: string): void {
	const segments = relativePath.split(sep)

	// 文件内容由模型提供，禁止模型覆写环境变量和 Git 元数据。
	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive files cannot be written.')
	}
}

async function resolveWritablePath(filePath: string): Promise<string> {
	if (isAbsolute(filePath)) {
		throw new Error('Only relative file paths are allowed.')
	}

	const root = await realpath(process.cwd())
	const requestedPath = resolve(root, filePath)
	assertSafePath(assertInsideRoot(root, requestedPath))

	// 新建文件时父目录必须已经存在，并且不能通过父目录符号链接逃出根目录。
	const resolvedParentPath = await realpath(dirname(requestedPath))
	assertSafePath(assertInsideRoot(root, resolvedParentPath))

	try {
		// lstat 保留符号链接本身的信息，避免在判断文件类型前隐式跟随链接。
		const entry = await lstat(requestedPath)

		if (!entry.isFile() && !entry.isSymbolicLink()) {
			throw new Error('The requested path is not a file.')
		}
	} catch (error) {
		// 目标不存在时允许后续 writeFile 创建；其他文件系统错误仍需直接暴露。
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return requestedPath
		}
		throw error
	}

	// 覆写已有文件前解析符号链接，防止链接指向当前目录外的文件。
	const resolvedPath = await realpath(requestedPath)
	assertSafePath(assertInsideRoot(root, resolvedPath))

	if (!(await lstat(resolvedPath)).isFile()) {
		throw new Error('The requested path is not a file.')
	}

	return resolvedPath
}

export async function writeFileTool(
	filePath: string,
	content: string,
): Promise<string> {
	const writablePath = await resolveWritablePath(filePath)

	// writeFile 会创建不存在的普通文件，或以 UTF-8 内容完整覆写已有文件。
	await writeFile(writablePath, content, 'utf8')

	// 返回相对路径，便于 Agent 向用户确认实际写入目标而不暴露绝对工作目录。
	return `Wrote file: ${filePath}`
}
