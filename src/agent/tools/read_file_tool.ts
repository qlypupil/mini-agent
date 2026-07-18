import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

function assertInsideRoot(root: string, target: string): string {
	const relativePath = relative(root, target)

	// relative() 结果以 .. 开头或仍是绝对路径，说明请求已越出当前工作目录。
	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error('Only files in the current directory can be read.')
	}

	return relativePath
}

function assertSafePath(relativePath: string): void {
	const segments = relativePath.split(sep)

	// 工具结果会发送给模型，禁止读取环境变量和 Git 元数据以避免泄露密钥与历史信息。
	if (segments.some((segment) => segment === '.git' || segment.startsWith('.env'))) {
		throw new Error('Sensitive files cannot be read.')
	}
}

export async function readFileTool(filePath: string): Promise<string> {
	// 接口只接受相对路径，避免调用方用绝对路径绕过当前目录边界。
	if (isAbsolute(filePath)) {
		throw new Error('Only relative file paths are allowed.')
	}

	// 使用规范化后的根目录，使后续检查不受工作目录自身符号链接影响。
	const root = await realpath(process.cwd())
	const requestedPath = resolve(root, filePath)
	assertSafePath(assertInsideRoot(root, requestedPath))

	// Resolve symbolic links before the final boundary check to prevent path escapes.
	const resolvedPath = await realpath(requestedPath)
	assertSafePath(assertInsideRoot(root, resolvedPath))

	if (!(await stat(resolvedPath)).isFile()) {
		throw new Error('The requested path is not a file.')
	}

	// 明确按 UTF-8 读取，保证工具结果是可直接传给模型的文本。
	return readFile(resolvedPath, 'utf8')
}
