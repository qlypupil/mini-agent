import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDangerousPath, type DangerousPathOptions } from './is-dangerous-path'

function darwinOptions(overrides: DangerousPathOptions = {}): DangerousPathOptions {
	return {
		platform: 'darwin',
		cwd: '/Users/alice/work/project',
		env: { HOME: '/Users/alice' },
		userHomes: ['/Users/alice'],
		resolveRealPath: () => undefined,
		...overrides,
	}
}

function windowsOptions(overrides: DangerousPathOptions = {}): DangerousPathOptions {
	return {
		platform: 'win32',
		cwd: 'C:\\Users\\Alice\\work\\project',
		env: {
			USERPROFILE: 'C:\\Users\\Alice',
			APPDATA: 'C:\\Users\\Alice\\AppData\\Roaming',
			LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
			SYSTEMDRIVE: 'C:',
			SYSTEMROOT: 'C:\\Windows',
			PROGRAMDATA: 'C:\\ProgramData',
		},
		userHomes: ['C:\\Users\\Alice'],
		resolveRealPath: () => undefined,
		...overrides,
	}
}

function linuxOptions(overrides: DangerousPathOptions = {}): DangerousPathOptions {
	return {
		platform: 'linux',
		cwd: '/home/alice/work/project',
		env: { HOME: '/home/alice' },
		userHomes: ['/home/alice'],
		resolveRealPath: () => undefined,
		...overrides,
	}
}

describe('isDangerousPath', () => {
	describe('common rules', () => {
		it('matches an exact protected directory and all descendants', () => {
			expect(isDangerousPath('~/.ssh', linuxOptions())).toBe(true)
			expect(isDangerousPath('~/.ssh/id_ed25519', linuxOptions())).toBe(true)
		})

		it('expands POSIX HOME expressions', () => {
			expect(isDangerousPath('$HOME/.aws/credentials', linuxOptions())).toBe(true)
			expect(isDangerousPath('${HOME}/.gnupg/pubring.kbx', linuxOptions())).toBe(
				true,
			)
		})

		it('matches secret and private-key globs anywhere', () => {
			expect(isDangerousPath('/srv/example/.env.production', linuxOptions())).toBe(true)
			expect(isDangerousPath('/opt/example/server.pem', linuxOptions())).toBe(true)
		})

		it('expands a list-valued KUBECONFIG variable', () => {
			const options = linuxOptions({
				env: {
					HOME: '/home/alice',
					KUBECONFIG: '/tmp/development.yaml:/secure/production.yaml',
				},
			})

			expect(isDangerousPath('/secure/production.yaml', options)).toBe(true)
		})

		it('resolves relative paths against the supplied working directory', () => {
			expect(
				isDangerousPath('../.ssh/id_rsa', darwinOptions()),
			).toBe(true)
		})

		it('checks a resolved symbolic-link target', () => {
			const resolveRealPath = jest.fn(() => '/etc/shadow')

			expect(
				isDangerousPath(
					'/tmp/apparently-safe.txt',
					linuxOptions({ resolveRealPath }),
				),
			).toBe(true)
			expect(resolveRealPath).toHaveBeenCalledWith('/tmp/apparently-safe.txt')
		})

		it('fails closed when resolving the real path throws', () => {
			expect(
				isDangerousPath(
					'/tmp/apparently-safe.txt',
					linuxOptions({
						resolveRealPath: () => {
							throw new Error('permission denied')
						},
					}),
				),
			).toBe(true)
		})

		it('checks an actual symbolic-link or junction target', async () => {
			const root = await mkdtemp(join(tmpdir(), 'termclaw-dangerous-path-'))
			const targetDirectory = join(root, '.direnv')
			const linkDirectory = join(root, 'apparently-safe')
			try {
				await mkdir(targetDirectory)
				await writeFile(join(targetDirectory, 'secret.txt'), 'secret')
				await symlink(
					targetDirectory,
					linkDirectory,
					process.platform === 'win32' ? 'junction' : 'dir',
				)

				expect(isDangerousPath(join(linkDirectory, 'secret.txt'))).toBe(true)
			} finally {
				await rm(root, { recursive: true, force: true })
			}
		})

		it('fails closed for empty, malformed, or unresolved paths', () => {
			expect(isDangerousPath('', linuxOptions())).toBe(true)
			expect(isDangerousPath('"/tmp/file.txt', linuxOptions())).toBe(true)
			expect(isDangerousPath('$UNKNOWN/file.txt', linuxOptions())).toBe(true)
			expect(isDangerousPath('/tmp/file\0.txt', linuxOptions())).toBe(true)
		})
	})

	describe('macOS rules', () => {
		it.each([
			'/Users/alice/Library/Keychains/login.keychain-db',
			'/Users/alice/Library/Messages/chat.db',
			'/Users/alice/Library/Application Support/Google/Chrome/Default/Cookies',
			'/private/var/db/TCC/TCC.db',
			'/Volumes/Backup/private.txt',
		])('rejects %s', (filePath) => {
			expect(isDangerousPath(filePath, darwinOptions())).toBe(true)
		})

		it('protects personal known folders by default', () => {
			expect(
				isDangerousPath('/Users/alice/Documents/tax.pdf', darwinOptions()),
			).toBe(true)
		})

		it('allows an unrelated application resource path', () => {
			expect(
				isDangerousPath(
					'/Applications/Example.app/Contents/Resources/readme.txt',
					darwinOptions(),
				),
			).toBe(false)
		})
	})

	describe('Windows rules and path expressions', () => {
		it('expands a quoted USERPROFILE expression', () => {
			expect(
				isDangerousPath('"%USERPROFILE%\\.ssh\\id_rsa"', windowsOptions()),
			).toBe(true)
		})

		it('expands tilde with the Windows user profile', () => {
			expect(isDangerousPath('~\\.aws\\credentials', windowsOptions())).toBe(true)
		})

		it('expands APPDATA and LOCALAPPDATA case-insensitively', () => {
			expect(
				isDangerousPath(
					'%appdata%\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt',
					windowsOptions(),
				),
			).toBe(true)
			expect(
				isDangerousPath(
					'%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cookies',
					windowsOptions(),
				),
			).toBe(true)
		})

		it('normalizes relative paths, separators, case, trailing dots, and spaces', () => {
			expect(
				isDangerousPath(
					'..\\..\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies. ',
					windowsOptions(),
				),
			).toBe(true)
		})

		it.each([
			'\\\\.\\PhysicalDrive0',
			'\\\\server\\C$\\Windows\\System32\\config\\SAM',
			'C:\\safe\\notes.txt:secret',
			'C:\\PROGRA~1\\Example\\file.txt',
			'NUL',
		])('fails closed for Windows alias or device path %s', (filePath) => {
			expect(isDangerousPath(filePath, windowsOptions())).toBe(true)
		})

		it('protects non-system drives as dynamically mounted storage', () => {
			expect(isDangerousPath('D:\\private\\backup.zip', windowsOptions())).toBe(true)
		})

		it('allows an unrelated path on the system drive', () => {
			expect(
				isDangerousPath('C:\\Program Files\\Example\\readme.txt', windowsOptions()),
			).toBe(false)
		})

		it('fails closed for an unknown Windows environment variable', () => {
			expect(isDangerousPath('%UNKNOWN%\\readme.txt', windowsOptions())).toBe(true)
		})
	})

	describe('Linux rules', () => {
		it.each([
			'/etc/shadow',
			'/proc/123/environ',
			'/home/alice/.local/share/keyrings/login.keyring',
			'/home/alice/.config/google-chrome/Default/Cookies',
			'/mnt/backup/private.txt',
		])('rejects %s', (filePath) => {
			expect(isDangerousPath(filePath, linuxOptions())).toBe(true)
		})

		it('normalizes a relative system path', () => {
			expect(
				isDangerousPath('../../etc/shadow', linuxOptions({ cwd: '/tmp/work' })),
			).toBe(true)
		})

		it('allows an unrelated shared documentation path', () => {
			expect(isDangerousPath('/usr/share/doc/example/README', linuxOptions())).toBe(
				false,
			)
		})
	})

	it('fails closed on unsupported operating systems', () => {
		expect(
			isDangerousPath('/tmp/file.txt', {
				platform: 'freebsd',
				resolveRealPath: () => undefined,
			}),
		).toBe(true)
	})
})
