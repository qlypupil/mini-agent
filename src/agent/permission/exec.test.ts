import {
	authorizeExec,
	detectDangerousOperation,
	detectLanguageExecution,
	isChangingDirectory,
	isSafeExecCommand,
} from './exec'

const darwinOptions = {
	platform: 'darwin' as const,
	cwd: '/Users/pupil/Documents/project',
	env: { HOME: '/Users/pupil' },
	userHomes: ['/Users/pupil'],
	resolveRealPath: (filePath: string) => filePath,
}

const linuxOptions = {
	platform: 'linux' as const,
	cwd: '/home/pupil/project',
	env: { HOME: '/home/pupil' },
	userHomes: ['/home/pupil'],
	resolveRealPath: (filePath: string) => filePath,
}

const windowsOptions = {
	platform: 'win32' as const,
	cwd: 'C:\\Users\\Pupil\\Documents\\project',
	env: {
		USERPROFILE: 'C:\\Users\\Pupil',
		APPDATA: 'C:\\Users\\Pupil\\AppData\\Roaming',
		LOCALAPPDATA: 'C:\\Users\\Pupil\\AppData\\Local',
	},
	userHomes: ['C:\\Users\\Pupil'],
	resolveRealPath: (filePath: string) => filePath,
}

describe('isChangingDirectory', () => {
	it.each([
		'cd /tmp',
		'pwd && cd ..',
		'pwd; chdir /tmp',
		'printf x | pushd /tmp',
		'POPD',
		'pwd\ncd /tmp',
	])('detects %s', (command) => {
		expect(isChangingDirectory(command)).toBe(true)
	})

	it.each([
		'pwd',
		'printf cdrom',
		'git -C /tmp status',
		'echo hello > ~/Desktop/a.txt',
		'node -e "process.chdir(\'/tmp\')"',
	])('does not detect %s', (command) => {
		expect(isChangingDirectory(command)).toBe(false)
	})

	it('conservatively detects a standalone keyword used as an argument', () => {
		expect(isChangingDirectory('echo cd')).toBe(true)
	})
})

describe('detectLanguageExecution', () => {
	it.each([
		'python script.py',
		'python3.12 -c "print(1)"',
		'/usr/bin/pypy3 script.py',
		'"C:\\Python312\\python.exe" script.py',
		'env PYTHONPATH=. python3 script.py',
		'printf ready | python -c "print(1)"',
		'./scripts/task.py',
	])('classifies Python execution in %s', (command) => {
		expect(detectLanguageExecution(command)).toBe('python')
	})

	it.each([
		'node app.js',
		'/usr/local/bin/node20 app.js',
		'deno run app.ts',
		'bun app.ts',
		'npx --yes tsx app.ts',
		'pnpm exec ts-node app.ts',
		'./scripts/task.ts',
	])('classifies JavaScript or TypeScript execution in %s', (command) => {
		expect(detectLanguageExecution(command)).toBe('javascript')
	})

	it.each([
		'java -jar app.jar',
		'dotnet run',
		'go run main.go',
		'ruby3.2 script.rb',
		'cargo run',
		'clang++ main.cpp',
		'php script.php',
		'./main.go',
	])('classifies other language execution in %s', (command) => {
		expect(detectLanguageExecution(command)).toBe('other')
	})

	it.each([
		'bash scripts/check.sh',
		'sh -c "python script.py"',
		'echo python',
		'rg node README.md',
		'cat app.py',
		'pnpm test',
		'npm run build',
		'make',
		'gradle test',
		'command -v python',
	])('does not classify %s', (command) => {
		expect(detectLanguageExecution(command)).toBeUndefined()
	})
})

describe('detectDangerousOperation', () => {
	it.each([
		['sudo ls', darwinOptions],
		['doas id', linuxOptions],
		['runas /user:Administrator cmd', windowsOptions],
		['Start-Process powershell -Verb RunAs', windowsOptions],
	] as const)('detects privilege escalation in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('privilege_escalation')
	})

	it.each([
		['rm -rf build', darwinOptions],
		['find . -delete', linuxOptions],
		['git clean -fd', darwinOptions],
		['mkfs.ext4 /dev/sdb1', linuxOptions],
		['del /q build.txt', windowsOptions],
		['powershell -Command "Remove-Item build.txt"', windowsOptions],
	] as const)('detects file deletion in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('file_deletion')
	})

	it.each([
		['cp source.txt target.txt', darwinOptions],
		['mkdir build', linuxOptions],
		['echo hello > output.txt', darwinOptions],
		['sed -i.bak s/a/b/ notes.txt', darwinOptions],
		['git add src/index.ts', linuxOptions],
		['pnpm install', darwinOptions],
		['pip install requests', linuxOptions],
		['uv sync', darwinOptions],
		['tar -czf archive.tar.gz src', linuxOptions],
		['find . -fprint results.txt', linuxOptions],
		['git diff --output=changes.patch', darwinOptions],
		['cmd /c "copy source.txt target.txt"', windowsOptions],
		['Set-Content notes.txt hello', windowsOptions],
	] as const)('detects file modification in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('file_modification')
	})

	it.each([
		['chmod 600 secret.txt', linuxOptions],
		['chflags hidden secret.txt', darwinOptions],
		['icacls secret.txt /grant User:F', windowsOptions],
	] as const)('detects permission changes in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('permission_change')
	})

	it.each([
		['kill -9 123', darwinOptions],
		['systemctl restart nginx', linuxOptions],
		['launchctl stop com.example.service', darwinOptions],
		['taskkill /PID 123 /F', windowsOptions],
		['sc stop ExampleService', windowsOptions],
	] as const)('detects process or service control in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('process_service_control')
	})

	it.each([
		['find . -exec echo {} \\;', linuxOptions],
		['find . -ok echo {} \\;', darwinOptions],
		['git diff --ext-diff', linuxOptions],
		['git diff --textconv', darwinOptions],
		['git log --show-signature', linuxOptions],
	] as const)('blocks indirect process execution in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe(
			'process_service_control',
		)
	})

	it.each([
		['usermod -aG wheel pupil', linuxOptions],
		['dscl . -create /Users/pupil', darwinOptions],
		['net user pupil password', windowsOptions],
		['New-LocalUser pupil', windowsOptions],
	] as const)('detects user account changes in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('user_account_change')
	})

	it.each([
		['printenv', linuxOptions],
		['security find-generic-password -a pupil', darwinOptions],
		['secret-tool search service example', linuxOptions],
		['systeminfo', windowsOptions],
		['gpg --list-secret-keys', linuxOptions],
		['cat /etc/passwd', darwinOptions],
		['cat .env', darwinOptions],
		['cat ../private.txt', darwinOptions],
		['type %APPDATA%\\Microsoft\\Credentials\\secret', windowsOptions],
	] as const)('detects sensitive information access in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe(
			'sensitive_information_access',
		)
	})

	it.each([
		['curl https://example.com', darwinOptions],
		['networksetup -getinfo Wi-Fi', darwinOptions],
		['ip address', linuxOptions],
		['Invoke-WebRequest https://example.com', windowsOptions],
		['git push origin main', linuxOptions],
		['aws s3 ls', linuxOptions],
		['pip download requests', darwinOptions],
		['npx eslint .', darwinOptions],
		['pnpm dlx cowsay hello', linuxOptions],
	] as const)('detects network or remote control in %s', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBe('network_remote_control')
	})

	it.each([
		['cat README.md', darwinOptions],
		['ls src', darwinOptions],
		['rg password README.md', linuxOptions],
		['git -C /tmp status', darwinOptions],
		['git diff', linuxOptions],
		['git log -1', darwinOptions],
		['git branch --show-current', linuxOptions],
		['pnpm test', darwinOptions],
		['npm run build', linuxOptions],
		['pip list', linuxOptions],
		['bash scripts/check.sh', darwinOptions],
		['bash -c "echo hello"', linuxOptions],
		['echo hello 2>&1', darwinOptions],
		['echo hello 1>&2', linuxOptions],
		['echo "a > b"', darwinOptions],
		['whoami', linuxOptions],
		['command -v sudo', linuxOptions],
		['taskkill', darwinOptions],
	] as const)('does not classify %s as dangerous', (command, options) => {
		expect(detectDangerousOperation(command, options)).toBeUndefined()
	})

	it.each([
		['bash -c "rm build.txt"', darwinOptions, 'file_deletion'],
		['cmd /c "del build.txt"', windowsOptions, 'file_deletion'],
		[
			'pwsh -Command "Set-Content notes.txt hello"',
			windowsOptions,
			'file_modification',
		],
	] as const)('recursively checks inline shell command %s', (command, options, operation) => {
		expect(detectDangerousOperation(command, options)).toBe(operation)
	})
})

describe('isSafeExecCommand', () => {
	it.each([
		['ls -la src', darwinOptions],
		['/bin/pwd', linuxOptions],
		['cat README.md | head -n 5', darwinOptions],
		['tail -n 10 README.md', linuxOptions],
		['grep profile README.md', linuxOptions],
		["find src -name '*.ts'", darwinOptions],
		['echo hello && date +%F', linuxOptions],
		['whoami', darwinOptions],
		['git status --short', linuxOptions],
		['git diff --stat', darwinOptions],
		['git --no-pager log -1', linuxOptions],
		['bash -c "cat README.md | head -n 1"', darwinOptions],
	] as const)('allows the complete safe command %s', (command, options) => {
		expect(isSafeExecCommand(command, options)).toBe(true)
	})

	it.each([
		'dir',
		'type README.md',
		'findstr profile README.md',
		'where node',
		'Get-ChildItem .',
		'Get-Location',
		'Get-Content README.md',
		'Select-String profile README.md',
		'Get-Date',
		'date /T',
		'cmd /c "dir"',
		'powershell -Command "Get-Date"',
	])('allows the Windows read command %s', (command) => {
		expect(isSafeExecCommand(command, windowsOptions)).toBe(true)
	})

	it.each([
		['echo $(date)', linuxOptions],
		['echo `date`', darwinOptions],
		['echo $HOME', linuxOptions],
		['echo %TEMP%', windowsOptions],
		["echo '%TEMP%'", windowsOptions],
		['ls *.ts', darwinOptions],
		['find src -name *.ts', linuxOptions],
		['echo {a,b}', darwinOptions],
		['pwd & echo done', linuxOptions],
		['cat <(echo hello)', darwinOptions],
		["Get-Content '*.txt'", windowsOptions],
	] as const)('does not auto-allow dynamic shell syntax in %s', (command, options) => {
		expect(isSafeExecCommand(command, options)).toBe(false)
	})

	it.each([
		['cat .env', darwinOptions],
		['find . -delete', linuxOptions],
		['find . -exec echo {} \\;', linuxOptions],
		['find . -fprint results.txt', darwinOptions],
		['git diff --output changes.patch', linuxOptions],
		['git diff --ext-diff', darwinOptions],
		['git diff --no-index README.md ../private.txt', linuxOptions],
		['echo hello > output.txt', darwinOptions],
		['whoami /all', windowsOptions],
		['date --set=2026-08-04', linuxOptions],
		['date --reference=.env', linuxOptions],
		['grep -R profile .', linuxOptions],
		['grep -f patterns.txt README.md', darwinOptions],
		['find -L . -name notes.txt', linuxOptions],
		['find -files0-from paths.txt', linuxOptions],
		['ls -RL .', darwinOptions],
		['dir /S', windowsOptions],
		['findstr /G:patterns.txt README.md', windowsOptions],
		['Get-ChildItem -FollowSymlink .', windowsOptions],
		['where /R C:\\Windows cmd.exe', windowsOptions],
		['cmd /k "dir"', windowsOptions],
		[
			'powershell -Command "Get-ChildItem -Recurse | Get-Content"',
			windowsOptions,
		],
	] as const)('does not auto-allow unsafe arguments in %s', (command, options) => {
		expect(isSafeExecCommand(command, options)).toBe(false)
	})

	it.each([
		['rg profile README.md', linuxOptions],
		['git show HEAD', darwinOptions],
		['git -C . status', linuxOptions],
		['pnpm test', darwinOptions],
		['bash scripts/check.sh', linuxOptions],
		['pwd | sort', darwinOptions],
		['LC_ALL=C ls', linuxOptions],
		['time ls', darwinOptions],
	] as const)('keeps unknown or opaque commands out of the safe set: %s', (command, options) => {
		expect(isSafeExecCommand(command, options)).toBe(false)
	})
})

describe('authorizeExec', () => {
	it('denies an explicit directory-changing command', () => {
		expect(authorizeExec({ command: 'cd /tmp && pwd' })).toEqual({
			action: 'deny',
			reason: 'directory_change',
		})
	})

	it('allows a command that belongs to the complete safe set', () => {
		expect(authorizeExec({ command: 'pwd' })).toEqual({ action: 'allow' })
	})

	it.each([
		['python script.py', 'python_execution'],
		['node app.js', 'javascript_execution'],
		['go run main.go', 'other_language_execution'],
	] as const)('denies %s with reason %s', (command, reason) => {
		expect(authorizeExec({ command })).toEqual({
			action: 'deny',
			reason,
		})
	})

	it('keeps directory changes ahead of language execution', () => {
		expect(authorizeExec({ command: 'cd /tmp && python script.py' })).toEqual({
			action: 'deny',
			reason: 'directory_change',
		})
	})

	it.each([
		['sudo ls', 'privilege_escalation'],
		['rm notes.txt', 'file_deletion'],
		['cp source.txt target.txt', 'file_modification'],
		['chmod 600 notes.txt', 'permission_change'],
		['kill 123', 'process_service_control'],
		['passwd pupil', 'user_account_change'],
		['printenv', 'sensitive_information_access'],
		['curl https://example.com', 'network_remote_control'],
	] as const)('denies dangerous command %s with reason %s', (command, reason) => {
		expect(authorizeExec({ command })).toEqual({ action: 'deny', reason })
	})

	it('asks when a tool has no string command argument', () => {
		expect(authorizeExec({ code: 'console.log(1)' })).toEqual({ action: 'ask' })
		expect(authorizeExec({ command: 123 })).toEqual({ action: 'ask' })
	})

	it.each([
		'rg profile README.md',
		'git show HEAD',
		'pnpm test',
		'bash scripts/check.sh',
		'echo $HOME',
	])('asks for a command that cannot be statically proven safe: %s', (command) => {
		expect(authorizeExec({ command })).toEqual({ action: 'ask' })
	})

	it('keeps dangerous rules ahead of the safe executable set', () => {
		expect(authorizeExec({ command: 'cat .env' }, darwinOptions)).toEqual({
			action: 'deny',
			reason: 'sensitive_information_access',
		})
		expect(authorizeExec({ command: 'find . -delete' }, linuxOptions)).toEqual({
			action: 'deny',
			reason: 'file_deletion',
		})
	})
})
