import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
	inspectDangerousPath,
	type DangerousPathInspection,
} from './is-dangerous-path'
import type { PermissionedTool } from './tool-permission'

export type ToolAuthorizationAction = 'allow' | 'ask' | 'deny'

export interface ProjectPathBoundary {
	requestedRoot: string
	resolvedRoot: string
}

export interface ToolAuthorization {
	action: ToolAuthorizationAction
	reason?: 'invalid_path' | 'protected_path'
	inspection?: DangerousPathInspection
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

function isWithinRoot(root: string, filePath: string): boolean {
	const relativePath = relative(root, filePath)

	return (
		relativePath === '' ||
		(!relativePath.startsWith(`..${sep}`) &&
			relativePath !== '..' &&
			!isAbsolute(relativePath))
	)
}

export function classifyToolAuthorization(
	registeredTool: PermissionedTool,
	args: Record<string, unknown>,
	projectBoundary: ProjectPathBoundary,
): ToolAuthorization {
	if (
		registeredTool.permission_level !== 'read' &&
		registeredTool.permission_level !== 'write'
	) {
		return { action: 'ask' }
	}

	const filePathArg = registeredTool.file_path_arg
	if (!filePathArg || typeof args[filePathArg] !== 'string') {
		return { action: 'allow' }
	}

	const inspection = inspectDangerousPath(args[filePathArg])
	if (inspection.status === 'invalid') {
		return { action: 'deny', reason: 'invalid_path', inspection }
	}
	if (inspection.status === 'deny') {
		return { action: 'deny', reason: 'protected_path', inspection }
	}

	const requestedPath = inspection.requestedPath
	const resolvedPath = inspection.resolvedPath
	if (requestedPath === undefined || resolvedPath === undefined) {
		return { action: 'deny', reason: 'invalid_path', inspection }
	}

	const requestedInsideProject = isWithinRoot(
		projectBoundary.requestedRoot,
		requestedPath,
	)
	const resolvedInsideProject = isWithinRoot(
		projectBoundary.resolvedRoot,
		resolvedPath,
	)
	if (requestedInsideProject && resolvedInsideProject) {
		return { action: 'allow', inspection }
	}
	if (requestedInsideProject !== resolvedInsideProject) {
		const outsidePath = requestedInsideProject ? resolvedPath : requestedPath
		const outsideInspection = inspectDangerousPath(outsidePath, {
			resolveRealPath: () => undefined,
		})
		if (outsideInspection.status === 'safe') {
			return { action: 'ask', inspection }
		}
	}

	if (inspection.status === 'user_selection_required') {
		return { action: 'deny', reason: 'protected_path', inspection }
	}

	return { action: 'ask', inspection }
}
