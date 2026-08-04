import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { withPermissionLevel } from './index'
import {
	createProjectPathBoundary,
	type ProjectPathBoundary,
} from './util'
import { authorizeWrite } from './write'

function writeTool(filePathArg?: string) {
	return withPermissionLevel(
		tool(() => 'ok', {
			name: `test_write_${filePathArg ?? 'no_path'}`,
			description: 'Test write tool.',
			schema: z.object({ path: z.string().optional() }),
		}),
		'write',
		filePathArg ? { filePathArg } : {},
	)
}

describe('authorizeWrite', () => {
	let projectRoot: string
	let outsideRoot: string
	let projectBoundary: ProjectPathBoundary

	beforeEach(async () => {
		projectRoot = await mkdtemp(join(process.cwd(), '.write-authorization-'))
		outsideRoot = await mkdtemp(join(tmpdir(), 'termclaw-write-authorization-'))
		projectBoundary = createProjectPathBoundary(projectRoot)
	})

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true })
		await rm(outsideRoot, { recursive: true, force: true })
	})

	it('allows write tools without a model-controlled file path', () => {
		expect(authorizeWrite(writeTool(), {}, projectBoundary)).toEqual({
			action: 'allow',
		})
		expect(
			authorizeWrite(writeTool('path'), {}, projectBoundary),
		).toEqual({ action: 'allow' })
	})

	it('allows ordinary project files under a dynamically protected directory', async () => {
		const filePath = join(projectRoot, 'notes.txt')
		await writeFile(filePath, 'notes')

		expect(
			authorizeWrite(writeTool('path'), { path: filePath }, projectBoundary),
		).toMatchObject({
			action: 'allow',
			inspection: { status: 'user_selection_required' },
		})
	})

	it('asks for ordinary paths outside the project and denies personal folders', () => {
		expect(
			authorizeWrite(
				writeTool('path'),
				{ path: join(outsideRoot, 'notes.txt') },
				projectBoundary,
			),
		).toMatchObject({ action: 'ask', inspection: { status: 'safe' } })

		const siblingPersonalPath = join(
			dirname(projectRoot),
			'other-project',
			'notes.txt',
		)
		expect(
			authorizeWrite(
				writeTool('path'),
				{ path: siblingPersonalPath },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'protected_path' })
	})

	it('denies invalid and statically protected paths', () => {
		expect(
			authorizeWrite(
				writeTool('path'),
				{ path: '/tmp/file\0.txt' },
				projectBoundary,
			),
		).toMatchObject({ action: 'deny', reason: 'invalid_path' })
		expect(
			authorizeWrite(
				writeTool('path'),
				{ path: join(projectRoot, '.env') },
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
				authorizeWrite(writeTool('path'), { path }, projectBoundary),
			).toMatchObject({ action: 'ask' })
		}
	})
})
