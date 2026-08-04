import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DangerousPathInspection } from './is-dangerous-path'

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
	readonly file_path_arg?: string
}

export interface ToolPermissionOptions {
	filePathArg?: string
}

export type ToolAuthorizationAction = 'allow' | 'ask' | 'deny'

export interface ToolAuthorization {
	action: ToolAuthorizationAction
	reason?:
		| 'directory_change'
		| 'file_deletion'
		| 'file_modification'
		| 'invalid_path'
		| 'javascript_execution'
		| 'network_remote_control'
		| 'other_language_execution'
		| 'permission_change'
		| 'privilege_escalation'
		| 'process_service_control'
		| 'protected_path'
		| 'python_execution'
		| 'sensitive_information_access'
		| 'user_account_change'
	inspection?: DangerousPathInspection
}

export function withPermissionLevel<T extends StructuredToolInterface>(
	tool: T,
	permissionLevel: ToolPermissionLevel,
	options: ToolPermissionOptions = {},
): PermissionedTool<T> {
	return Object.assign(
		tool,
		{ permission_level: permissionLevel },
		options.filePathArg ? { file_path_arg: options.filePathArg } : {},
	)
}
