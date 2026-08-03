import type { StructuredToolInterface } from '@langchain/core/tools'

export type ToolPermissionLevel =
	| 'read'
	| 'write'
	| 'exec'
	| 'network'
	| 'db'

export type PermissionedTool<
	T extends StructuredToolInterface = StructuredToolInterface,
> = T & {
	readonly permission_level: ToolPermissionLevel
}

export function withPermissionLevel<T extends StructuredToolInterface>(
	tool: T,
	permissionLevel: ToolPermissionLevel,
): PermissionedTool<T> {
	return Object.assign(tool, { permission_level: permissionLevel })
}
