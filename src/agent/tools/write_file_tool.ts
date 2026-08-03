import { lstat, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

function assertSafePath(filePath: string): void {
	const segments = resolve(filePath).split(sep)

	// 文件内容由模型提供，禁止模型覆写环境变量和 Git 元数据。
	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive files cannot be written.')
	}
}

async function resolveWritablePath(filePath: string): Promise<string> {
	// 相对路径以当前目录为基准；绝对路径和当前目录外的目标均允许访问。
	const requestedPath = resolve(filePath)
	assertSafePath(requestedPath)

	// 新建文件时父目录必须已经存在；解析后再次阻止敏感目录。
	const resolvedParentPath = await realpath(dirname(requestedPath))
	assertSafePath(resolvedParentPath)

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

	// 覆写已有文件前解析符号链接，避免安全名称的链接指向敏感文件。
	const resolvedPath = await realpath(requestedPath)
	assertSafePath(resolvedPath)

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

	// 原样返回调用路径，便于 Agent 向用户确认实际写入目标。
	return `Wrote file: ${filePath}`
}
