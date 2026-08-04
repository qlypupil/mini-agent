import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { withPermissionLevel } from './index'
import { authorizeRead } from './read'
import {
	createProjectPathBoundary,
	type ProjectPathBoundary,
} from './util'

function readTool(filePathArg?: string) {
	return withPermissionLevel(
		tool(() => 'ok', {
			name: `test_read_${filePathArg ?? 'no_path'}`,
			description: 'Test read tool.',
			schema: z.object({ path: z.string().optional() }),
		}),
		'read',
		filePathArg ? { filePathArg } : {},
	)
}

describe('authorizeRead', () => {
	let projectRoot: string
	let outsideRoot: string
	let projectBoundary: ProjectPathBoundary

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(process.cwd(), '.read-authorization-'))
		outsideRoot = await mkdtemp(join(tmpdir(), 'termclaw-read-authorization-'))
		projectBoundary = createProjectPathBoundary(projectRoot)
	})

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true })
		await rm(outsideRoot, { recursive: true, force: true })
	})

	it('allows read tools without a model-controlled file path', () => {
		expect(authorizeRead(readTool(), {}, projectBoundary)).toEqual({
			action: 'allow',
		})
		expect(
			authorizeRead(readTool('path'), {}, projectBoundary),
		).toEqual({ action: 'allow' })
	})

	it('allows ordinary project files under a dynamically protected directory', async () => {
		const filePath = join(projectRoot, 'notes.txt')
		await writeFile(filePath, 'notes')

		expect(
			authorizeRead(readTool('path'), { path: filePath }, projectBoundary),
		).toMatchObject({
			action: 'allow',
			inspection: { status: 'user_selection_required' },
		})
	})

	it('allows ordinary paths outside the project without confirmation', () => {
		expect(
			authorizeRead(
				readTool('path'),
				{ path: join(outsideRoot, 'notes.txt') },
				projectBoundary,
			),
		).toMatchObject({ action: 'allow', inspection: { status: 'safe' } })
	})

	it('denies invalid, static, and dynamically protected paths', () => {
		expect(
			authorizeRead(
				readTool('path'),
				{ path: '/tmp/file\0.txt' },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'invalid_path' })
		expect(
			authorizeRead(
				readTool('path'),
				{ path: join(projectRoot, '.env') },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'protected_path' })

		const siblingPersonalPath = join(
			dirname(projectRoot),
			'other-project',
			'notes.txt',
		)
		expect(
			authorizeRead(
				readTool('path'),
				{ path: siblingPersonalPath },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'protected_path' })
	})

	it('allows symlinks that cross a safe project boundary', async () => {
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
				authorizeRead(readTool('path'), { path }, projectBoundary),
			).toMatchObject({ action: 'allow' })
		}
	})
})
