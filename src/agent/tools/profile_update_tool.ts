import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
	copyFile,
	lstat,
	mkdir,
	realpath,
	rename,
	unlink,
	writeFile,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { withPermissionLevel } from '../permission/tool-permission'

export const PROFILE_PATH = resolve(process.cwd(), '.data/profile.md')

const profileInfoTagPattern = /<\s*\/?\s*profile_info(?:\s[^>]*)?>/i

export const profileUpdateSchema = z.object({
	content: z
		.string()
		.trim()
		.min(1)
		.refine((content) => !profileInfoTagPattern.test(content), {
			message: 'Profile content must not include <profile_info> wrapper tags.',
		})
		.describe(
			'The complete updated profile body in Markdown, including every still-valid detail from <profile_info>, without wrapper tags.',
		),
})

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		error.code === 'ENOENT'
	)
}

function assertInsideRoot(root: string, target: string): string {
	const relativePath = relative(root, target)
	if (
		relativePath === '..' ||
		relativePath.startsWith(`..${sep}`) ||
		isAbsolute(relativePath)
	) {
		throw new Error('Profile files must remain inside the current directory.')
	}

	return relativePath
}

async function resolveProfilePath(profileFilePath: string): Promise<string> {
	const logicalRoot = resolve(process.cwd())
	const requestedPath = resolve(profileFilePath)
	const relativePath = assertInsideRoot(logicalRoot, requestedPath)
	const root = await realpath(logicalRoot)
	const rootedPath = resolve(root, relativePath)
	const profileDirectory = dirname(rootedPath)

	await mkdir(profileDirectory, { recursive: true })
	const resolvedDirectory = await realpath(profileDirectory)
	assertInsideRoot(root, resolvedDirectory)

	return resolve(resolvedDirectory, basename(rootedPath))
}

async function profileExists(profileFilePath: string): Promise<boolean> {
	try {
		const entry = await lstat(profileFilePath)
		if (!entry.isFile() || entry.isSymbolicLink()) {
			throw new Error('The profile path must be a regular file.')
		}
		return true
	} catch (error) {
		if (isMissingFileError(error)) return false
		throw error
	}
}

function createBackupFileName(): string {
	const timestamp = new Date().toISOString().replace(/[-:.]/g, '')
	return `profile.${timestamp}-${randomUUID()}.md`
}

export async function profileUpdateTool(
	input: ProfileUpdateInput,
	profileFilePath = PROFILE_PATH,
): Promise<string> {
	const parsedInput = profileUpdateSchema.parse(input)
	const writablePath = await resolveProfilePath(profileFilePath)
	const exists = await profileExists(writablePath)
	let backupFileName: string | undefined

	if (exists) {
		backupFileName = createBackupFileName()
		await copyFile(
			writablePath,
			resolve(dirname(writablePath), backupFileName),
			constants.COPYFILE_EXCL,
		)
	}

	const temporaryPath = `${writablePath}.${process.pid}.${randomUUID()}.tmp`
	try {
		await writeFile(temporaryPath, `${parsedInput.content}\n`, {
			encoding: 'utf8',
			flag: 'wx',
		})
		await rename(temporaryPath, writablePath)
	} catch (error) {
		await unlink(temporaryPath).catch(() => {})
		throw error
	}

	return JSON.stringify(
		backupFileName
			? { status: 'updated', backup: backupFileName }
			: { status: 'created' },
	)
}

export function createProfileUpdateTool(profileFilePath = PROFILE_PATH) {
	return withPermissionLevel(
		tool((input) => profileUpdateTool(input, profileFilePath), {
			name: 'profile_update',
			description:
				"Update the user's current, stable profile attributes covered by <profile_template>. Do not use this tool for dated or time-bound past events. Always submit the complete updated profile, preserving every still-valid detail from <profile_info>, not only the changed field.",
			schema: profileUpdateSchema,
		}),
		'write',
	)
}

export const profileUpdate = createProfileUpdateTool()
