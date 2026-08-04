import { readFile, realpath, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { inspectDangerousPath } from '../permission/is-dangerous-path'

function assertSafePath(filePath: string): void {
	const segments = resolve(filePath).split(sep)

	// 工具结果会发送给模型，禁止读取环境变量和 Git 元数据以避免泄露密钥与历史信息。
	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive files cannot be read.')
	}
}

export async function readFileTool(filePath: string): Promise<string> {
	const inspection = inspectDangerousPath(filePath)
	if (
		inspection.status === 'invalid' ||
		inspection.status === 'deny' ||
		!inspection.requestedPath ||
		!inspection.resolvedPath
	) {
		throw new Error('Sensitive files cannot be read.')
	}

	const requestedPath = inspection.requestedPath
	assertSafePath(requestedPath)

	// 解析符号链接后再次检查，避免安全名称的链接指向敏感文件。
	const resolvedPath = await realpath(requestedPath)
	const resolvedInspection = inspectDangerousPath(resolvedPath)
	if (
		resolvedInspection.status === 'invalid' ||
		resolvedInspection.status === 'deny'
	) {
		throw new Error('Sensitive files cannot be read.')
	}
	assertSafePath(resolvedPath)

	if (!(await stat(resolvedPath)).isFile()) {
		throw new Error('The requested path is not a file.')
	}

	// 明确按 UTF-8 读取，保证工具结果是可直接传给模型的文本。
	return readFile(resolvedPath, 'utf8')
}
