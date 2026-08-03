import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

function assertSafePath(filePath: string): void {
	const segments = resolve(filePath).split(sep)

	// 工具结果会发送给模型，禁止读取环境变量和 Git 元数据以避免泄露密钥与历史信息。
	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive files cannot be read.')
	}
}

export async function readFileTool(filePath: string): Promise<string> {
	// 相对路径以当前目录为基准；绝对路径和当前目录外的目标均允许访问。
	const requestedPath = resolve(filePath)
	assertSafePath(requestedPath)

	// 解析符号链接后再次检查，避免安全名称的链接指向敏感文件。
	const resolvedPath = await realpath(requestedPath)
	assertSafePath(resolvedPath)

	if (!(await stat(resolvedPath)).isFile()) {
		throw new Error('The requested path is not a file.')
	}

	// 明确按 UTF-8 读取，保证工具结果是可直接传给模型的文本。
	return readFile(resolvedPath, 'utf8')
}
