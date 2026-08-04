import type { PermissionedTool, ToolAuthorization } from './index'
import { inspectDangerousPath } from './is-dangerous-path'
import {
	isInProjectDir,
	type ProjectPathBoundary,
} from './util'

export function authorizeRead(
	registeredTool: PermissionedTool,
	args: Record<string, unknown>,
	projectBoundary: ProjectPathBoundary,
): ToolAuthorization {
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

	const requestedInsideProject = isInProjectDir(
		requestedPath,
		projectBoundary.requestedRoot,
	)
	const resolvedInsideProject = isInProjectDir(
		resolvedPath,
		projectBoundary.resolvedRoot,
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
			return { action: 'allow', inspection }
		}
	}

	if (inspection.status === 'user_selection_required') {
		return { action: 'deny', reason: 'protected_path', inspection }
	}

	return { action: 'allow', inspection }
}
