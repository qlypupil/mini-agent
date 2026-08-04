import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import {
	classifyToolAuthorization,
	createProjectPathBoundary,
	type ProjectPathBoundary,
} from './tool-authorization'
import { withPermissionLevel, type ToolPermissionLevel } from './tool-permission'

function testTool(
	permissionLevel: ToolPermissionLevel,
	filePathArg?: string,
) {
	return withPermissionLevel(
		tool(() => 'ok', {
			name: `test_${permissionLevel}_${filePathArg ?? 'no_path'}`,
			description: 'Test tool.',
			schema: z.object({ path: z.string().optional() }),
		}),
		permissionLevel,
		filePathArg ? { filePathArg } : {},
	)
}

describe('classifyToolAuthorization', () => {
	let projectRoot: string
	let outsideRoot: string
	let projectBoundary: ProjectPathBoundary

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(process.cwd(), '.tool-authorization-'))
		outsideRoot = await mkdtemp(join(tmpdir(), 'termclaw-tool-authorization-'))
		projectBoundary = createProjectPathBoundary(projectRoot)
	})

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true })
		await rm(outsideRoot, { recursive: true, force: true })
	})

	it('asks for non-file permissions and allows read or write tools without a path', () => {
		expect(
			classifyToolAuthorization(testTool('exec'), {}, projectBoundary),
		).toEqual({ action: 'ask' })
		expect(
			classifyToolAuthorization(testTool('read'), {}, projectBoundary),
		).toEqual({ action: 'allow' })
		expect(
			classifyToolAuthorization(
				testTool('write', 'path'),
				{},
				projectBoundary,
			),
		).toEqual({ action: 'allow' })
	})

	it('allows ordinary project files even when the project is under Documents', async () => {
		const filePath = join(projectRoot, 'notes.txt')
		await writeFile(filePath, 'notes')

		expect(
			classifyToolAuthorization(
				testTool('read', 'path'),
				{ path: filePath },
				projectBoundary,
			),
		).toMatchObject({
			action: 'allow',
			inspection: { status: 'user_selection_required' },
		})
	})

	it('denies invalid and statically protected paths before project exemptions', () => {
		expect(
			classifyToolAuthorization(
				testTool('read', 'path'),
				{ path: '/tmp/file\0.txt' },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'invalid_path' })
		expect(
			classifyToolAuthorization(
				testTool('write', 'path'),
				{ path: join(projectRoot, '.env') },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'protected_path' })
	})

	it('asks for an ordinary path outside the project and denies personal folders', () => {
		expect(
			classifyToolAuthorization(
				testTool('read', 'path'),
				{ path: join(outsideRoot, 'notes.txt') },
				projectBoundary,
			),
		).toMatchObject({ action: 'ask' })

		const siblingPersonalPath = join(
			dirname(projectRoot),
			'other-project',
			'notes.txt',
		)
		expect(
			classifyToolAuthorization(
				testTool('read', 'path'),
				{ path: siblingPersonalPath },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'protected_path' })
	})

	it('requires confirmation when a symlink crosses a safe project boundary', async () => {
		const projectFile = join(projectRoot, 'project.txt')
		const outsideFile = join(outsideRoot, 'outside.txt')
		const projectLink = join(projectRoot, 'outside-link.txt')
		const outsideLink = join(outsideRoot, 'project-link.txt')
		await writeFile(projectFile, 'project')
		await writeFile(outsideFile, 'outside')
		await symlink(outsideFile, projectLink)
		await symlink(projectFile, outsideLink)

		for (const path of [projectLink, outsideLink]) {
			expect(
				classifyToolAuthorization(
					testTool('read', 'path'),
					{ path },
					projectBoundary,
				),
			).toMatchObject({ action: 'ask' })
		}
	})
})
