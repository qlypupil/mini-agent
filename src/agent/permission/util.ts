import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export interface ProjectPathBoundary {
	requestedRoot: string
	resolvedRoot: string
}

export function createProjectPathBoundary(
	projectRoot = process.cwd(),
): ProjectPathBoundary {
	const requestedRoot = resolve(projectRoot)

	return {
		requestedRoot,
		resolvedRoot: realpathSync.native(requestedRoot),
	}
}

export function isInProjectDir(filePath: string, projectDir: string): boolean {
	const relativePath = relative(projectDir, filePath)

	return (
		relativePath === '' ||
		(!relativePath.startsWith(`..${sep}`) &&
			relativePath !== '..' &&
			!isAbsolute(relativePath))
	)
}
