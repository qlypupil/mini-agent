import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
	createProfileUpdateTool,
	profileUpdate,
	profileUpdateSchema,
} from './profile_update_tool'
import { tools } from './index'

describe('profile_update tool', () => {
	let rootDirectory: string
	let profileFilePath: string

	beforeEach(async () => {
		rootDirectory = await mkdtemp(join(process.cwd(), '.profile-update-tool-'))
		profileFilePath = join(rootDirectory, '.data/profile.md')
	})

	afterEach(async () => {
		await rm(rootDirectory, { recursive: true, force: true })
	})

	it('creates the profile without a backup when no file exists', async () => {
		const profileUpdate = createProfileUpdateTool(profileFilePath)

		await expect(
			profileUpdate.invoke({ content: '  ## 基本身份\n\n- 姓名：Pupil  ' }),
		).resolves.toBe('{"status":"created"}')
		await expect(readFile(profileFilePath, 'utf8')).resolves.toBe(
			'## 基本身份\n\n- 姓名：Pupil\n',
		)
		await expect(readdir(dirname(profileFilePath))).resolves.toEqual(['profile.md'])
	})

	it('backs up the exact old profile before replacing it', async () => {
		await mkdir(dirname(profileFilePath), { recursive: true })
		const oldProfile = 'old profile\n\n'
		await writeFile(profileFilePath, oldProfile, 'utf8')
		const profileUpdate = createProfileUpdateTool(profileFilePath)

		const result = JSON.parse(
			await profileUpdate.invoke({ content: 'new profile' }),
		) as { status: string; backup: string }

		expect(result.status).toBe('updated')
		expect(result.backup).toMatch(
			/^profile\.\d{8}T\d{9}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.md$/,
		)
		await expect(
			readFile(join(dirname(profileFilePath), result.backup), 'utf8'),
		).resolves.toBe(oldProfile)
		await expect(readFile(profileFilePath, 'utf8')).resolves.toBe('new profile\n')
	})

	it('keeps a unique backup for every replacement', async () => {
		await mkdir(dirname(profileFilePath), { recursive: true })
		await writeFile(profileFilePath, 'version one\n', 'utf8')
		const profileUpdate = createProfileUpdateTool(profileFilePath)

		await profileUpdate.invoke({ content: 'version two' })
		await profileUpdate.invoke({ content: 'version three' })

		const backupNames = (await readdir(dirname(profileFilePath)))
			.filter((name) => name !== 'profile.md')
			.sort()
		expect(backupNames).toHaveLength(2)
		await expect(
			Promise.all(
				backupNames.map((name) =>
					readFile(join(dirname(profileFilePath), name), 'utf8'),
				),
			),
		).resolves.toEqual(expect.arrayContaining(['version one\n', 'version two\n']))
	})

	it('backs up an existing empty profile', async () => {
		await mkdir(dirname(profileFilePath), { recursive: true })
		await writeFile(profileFilePath, '', 'utf8')
		const profileUpdate = createProfileUpdateTool(profileFilePath)

		const result = JSON.parse(
			await profileUpdate.invoke({ content: 'new profile' }),
		) as { status: string; backup: string }

		expect(result.status).toBe('updated')
		await expect(
			readFile(join(dirname(profileFilePath), result.backup), 'utf8'),
		).resolves.toBe('')
	})

	it('exposes only complete profile content without implementation details', () => {
		expect(Object.keys(profileUpdateSchema.shape)).toEqual(['content'])
		expect(profileUpdateSchema.safeParse({ content: '   ' }).success).toBe(false)
		expect(
			profileUpdateSchema.safeParse({
				content: '<profile_info>profile</profile_info>',
			}).success,
		).toBe(false)
		expect(profileUpdate.description).toContain('complete updated profile')
		expect(profileUpdate.description).toContain('every still-valid detail')
		expect(profileUpdate.description).toContain('current, stable profile')
		expect(profileUpdate.description).toContain(
			'Do not use this tool for dated or time-bound past events',
		)
		expect(profileUpdate.description).not.toMatch(
			/\.data|profile\.md|backup|atomic/i,
		)
	})

	it('is registered in the shared tool catalog', () => {
		expect(tools.map((registeredTool) => registeredTool.name)).toContain(
			'profile_update',
		)
	})

	it('rejects an existing profile symbolic link', async () => {
		const outsideDirectory = await mkdtemp(join(tmpdir(), 'termclaw-profile-outside-'))
		const outsideFile = join(outsideDirectory, 'profile.md')
		try {
			await mkdir(dirname(profileFilePath), { recursive: true })
			await writeFile(outsideFile, 'outside profile\n', 'utf8')
			await symlink(outsideFile, profileFilePath)
			const profileUpdate = createProfileUpdateTool(profileFilePath)

			await expect(
				profileUpdate.invoke({ content: 'new profile' }),
			).rejects.toThrow('The profile path must be a regular file.')
			await expect(readFile(outsideFile, 'utf8')).resolves.toBe('outside profile\n')
		} finally {
			await rm(outsideDirectory, { recursive: true, force: true })
		}
	})

	it('rejects an existing profile directory', async () => {
		await mkdir(profileFilePath, { recursive: true })
		const profileUpdate = createProfileUpdateTool(profileFilePath)

		await expect(
			profileUpdate.invoke({ content: 'new profile' }),
		).rejects.toThrow('The profile path must be a regular file.')
	})

	it('rejects a profile directory link outside the current directory', async () => {
		const outsideDirectory = await mkdtemp(join(tmpdir(), 'termclaw-profile-directory-'))
		try {
			await symlink(outsideDirectory, dirname(profileFilePath))
			const profileUpdate = createProfileUpdateTool(profileFilePath)

			await expect(
				profileUpdate.invoke({ content: 'new profile' }),
			).rejects.toThrow('Profile files must remain inside the current directory.')
		} finally {
			await rm(outsideDirectory, { recursive: true, force: true })
		}
	})

	it('rejects profile paths outside the current directory', async () => {
		const outsideDirectory = await mkdtemp(join(tmpdir(), 'termclaw-profile-path-'))
		try {
			const profileUpdate = createProfileUpdateTool(
				join(outsideDirectory, 'profile.md'),
			)

			await expect(
				profileUpdate.invoke({ content: 'new profile' }),
			).rejects.toThrow('Profile files must remain inside the current directory.')
		} finally {
			await rm(outsideDirectory, { recursive: true, force: true })
		}
	})
})
