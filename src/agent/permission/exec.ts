import { posix, win32 } from 'node:path'
import type { ToolAuthorization } from './index'
import {
	inspectDangerousPath,
	type DangerousPathOptions,
} from './is-dangerous-path'

export type LanguageExecution = 'python' | 'javascript' | 'other'
export type DangerousExecOperation =
	| 'privilege_escalation'
	| 'file_deletion'
	| 'file_modification'
	| 'permission_change'
	| 'process_service_control'
	| 'user_account_change'
	| 'sensitive_information_access'
	| 'network_remote_control'

type ExecPlatform = 'darwin' | 'linux' | 'win32'

interface CommandInvocation {
	token: string
	executable: string
	args: string[]
	wrappers: string[]
}

const DANGEROUS_OPERATION_ORDER: DangerousExecOperation[] = [
	'privilege_escalation',
	'file_deletion',
	'file_modification',
	'permission_change',
	'process_service_control',
	'user_account_change',
	'sensitive_information_access',
	'network_remote_control',
]

const COMMON_DANGEROUS_EXECUTABLES = {
	privilege_escalation: new Set(['sudo', 'su', 'doas', 'pkexec']),
	file_deletion: new Set(['rm', 'rmdir', 'unlink', 'shred']),
	file_modification: new Set([
		'cp',
		'mv',
		'mkdir',
		'touch',
		'ln',
		'install',
		'truncate',
		'dd',
		'tee',
		'patch',
		'rsync',
		'mktemp',
		'sponge',
		'zip',
		'gzip',
		'gunzip',
		'bzip2',
		'bunzip2',
		'xz',
		'unxz',
		'ed',
		'ex',
		'vi',
		'vim',
		'nvim',
		'nano',
		'emacs',
	]),
	permission_change: new Set([
		'chmod',
		'chown',
		'chgrp',
		'umask',
		'setfacl',
		'setcap',
	]),
	process_service_control: new Set([
		'kill',
		'killall',
		'pkill',
		'renice',
		'shutdown',
		'reboot',
		'halt',
		'poweroff',
		'at',
		'crontab',
	]),
	user_account_change: new Set(['passwd', 'chpasswd', 'chsh', 'chfn']),
	sensitive_information_access: new Set([
		'env',
		'printenv',
		'set',
		'id',
		'groups',
		'ps',
		'top',
		'lsof',
		'last',
		'w',
		'who',
		'logname',
		'uname',
		'hostname',
		'ssh-add',
		'finger',
		'history',
		'pass',
		'vault',
	]),
	network_remote_control: new Set([
		'curl',
		'wget',
		'ssh',
		'scp',
		'sftp',
		'telnet',
		'nc',
		'netcat',
		'ncat',
		'socat',
		'ftp',
		'tftp',
		'rlogin',
		'mosh',
		'ping',
		'traceroute',
		'tracepath',
		'dig',
		'nslookup',
		'host',
		'whois',
		'http',
		'httpie',
		'aria2c',
		'kubectl',
		'ansible',
		'ansible-playbook',
		'aws',
		'az',
		'gcloud',
		'gh',
		'glab',
		'helm',
		'mongosh',
		'mysql',
		'psql',
		'redis-cli',
		'terraform',
	]),
} satisfies Record<DangerousExecOperation, ReadonlySet<string>>

const PLATFORM_DANGEROUS_EXECUTABLES = {
	darwin: {
		file_deletion: new Set(['trash']),
		permission_change: new Set(['chflags', 'xattr']),
		process_service_control: new Set(['launchctl', 'open', 'osascript']),
		user_account_change: new Set([
			'dscl',
			'dseditgroup',
			'pwpolicy',
			'sysadminctl',
		]),
		sensitive_information_access: new Set([
			'profiles',
			'security',
			'system_profiler',
			'ioreg',
			'sysctl',
		]),
		network_remote_control: new Set([
			'airport',
			'arp',
			'ifconfig',
			'netstat',
			'networksetup',
			'route',
		]),
	},
	linux: {
		file_modification: new Set(['mount', 'umount']),
		permission_change: new Set(['chattr']),
		process_service_control: new Set([
			'init',
			'loginctl',
			'service',
			'systemctl',
			'telinit',
			'xdg-open',
		]),
		user_account_change: new Set([
			'adduser',
			'deluser',
			'groupadd',
			'groupdel',
			'groupmod',
			'useradd',
			'userdel',
			'usermod',
		]),
		sensitive_information_access: new Set([
			'dmesg',
			'journalctl',
			'secret-tool',
			'getent',
			'keyctl',
			'sysctl',
		]),
		network_remote_control: new Set([
			'arp',
			'ifconfig',
			'ip',
			'iw',
			'iwconfig',
			'netstat',
			'nmcli',
			'resolvectl',
			'route',
			'ss',
		]),
	},
	win32: {
		privilege_escalation: new Set(['runas']),
		file_deletion: new Set([
			'clear-recyclebin',
			'del',
			'diskpart',
			'erase',
			'format',
			'rd',
			'remove-item',
		]),
		file_modification: new Set([
			'add-content',
			'clear-content',
			'copy',
			'copy-item',
			'md',
			'move',
			'move-item',
			'new-item',
			'out-file',
			'ren',
			'rename',
			'rename-item',
			'robocopy',
			'set-content',
			'xcopy',
		]),
		permission_change: new Set([
			'attrib',
			'cacls',
			'icacls',
			'set-acl',
			'takeown',
		]),
		process_service_control: new Set([
			'restart-computer',
			'restart-service',
			'shutdown',
			'start-process',
			'start-service',
			'stop-computer',
			'stop-process',
			'stop-service',
			'suspend-service',
			'taskkill',
			'schtasks',
		]),
		user_account_change: new Set([
			'add-localgroupmember',
			'new-localgroup',
			'new-localuser',
			'remove-localgroup',
			'remove-localgroupmember',
			'remove-localuser',
			'set-localuser',
		]),
		sensitive_information_access: new Set([
			'cmdkey',
			'get-ciminstance',
			'get-computerinfo',
			'get-localgroup',
			'get-localgroupmember',
			'get-localuser',
			'get-process',
			'get-wmiobject',
			'quser',
			'qwinsta',
			'systeminfo',
			'tasklist',
			'wmic',
		]),
		network_remote_control: new Set([
			'enter-pssession',
			'ipconfig',
			'irm',
			'invoke-restmethod',
			'invoke-webrequest',
			'iwr',
			'mstsc',
			'netsh',
			'new-pssession',
			'pathping',
			'start-bitstransfer',
			'test-netconnection',
			'tracert',
			'winrm',
			'winrs',
		]),
	},
} satisfies Record<ExecPlatform, Partial<Record<DangerousExecOperation, ReadonlySet<string>>>>

const COMMON_SENSITIVE_PATH_READERS = new Set([
	'.',
	'ack',
	'ag',
	'base64',
	'cat',
	'cmp',
	'cut',
	'diff',
	'file',
	'find',
	'git',
	'grep',
	'head',
	'hexdump',
	'jq',
	'less',
	'ls',
	'more',
	'od',
	'openssl',
	'readlink',
	'realpath',
	'rg',
	'sed',
	'sort',
	'source',
	'sqlite3',
	'stat',
	'strings',
	'tail',
	'tar',
	'uniq',
	'wc',
	'xxd',
	'yq',
])

const WINDOWS_SENSITIVE_PATH_READERS = new Set([
	'dir',
	'findstr',
	'gc',
	'get-childitem',
	'get-content',
	'get-item',
	'select-string',
	'type',
	'where',
])

const PLATFORM_SENSITIVE_SYSTEM_PATHS = {
	darwin: new Set([
		'/etc/group',
		'/etc/passwd',
		'/private/etc/group',
		'/private/etc/passwd',
	]),
	linux: new Set(['/etc/group', '/etc/passwd']),
	win32: new Set<string>(),
} satisfies Record<ExecPlatform, ReadonlySet<string>>

const INLINE_POSIX_SHELLS = new Set([
	'ash',
	'bash',
	'csh',
	'dash',
	'fish',
	'ksh',
	'sh',
	'tcsh',
	'zsh',
])
const COMMON_SAFE_EXECUTABLES = new Set([
	'cat',
	'date',
	'echo',
	'find',
	'grep',
	'head',
	'ls',
	'pwd',
	'tail',
	'whoami',
])
const WINDOWS_SAFE_EXECUTABLES = new Set([
	'dir',
	'findstr',
	'get-childitem',
	'get-content',
	'get-date',
	'get-location',
	'select-string',
	'type',
	'where',
])
const SAFE_GIT_SUBCOMMANDS = new Set(['diff', 'log', 'status'])
const FIND_INDIRECT_EXECUTION_ACTIONS = new Set([
	'-exec',
	'-execdir',
	'-ok',
	'-okdir',
])
const FIND_FILE_OUTPUT_ACTIONS = new Set([
	'-fls',
	'-fprint',
	'-fprint0',
	'-fprintf',
])
const GIT_EXTERNAL_EXECUTION_OPTIONS = new Set([
	'--ext-diff',
	'--show-signature',
	'--textconv',
])
const GIT_DELETION_SUBCOMMANDS = new Set(['clean', 'rm'])
const GIT_MODIFICATION_SUBCOMMANDS = new Set([
	'add',
	'am',
	'apply',
	'checkout',
	'cherry-pick',
	'commit',
	'init',
	'merge',
	'mv',
	'rebase',
	'reset',
	'restore',
	'revert',
	'stash',
	'switch',
])
const GIT_NETWORK_SUBCOMMANDS = new Set([
	'clone',
	'fetch',
	'ls-remote',
	'pull',
	'push',
	'submodule',
])
const PACKAGE_MANAGERS = new Set([
	'composer',
	'gem',
	'npm',
	'pip',
	'pip3',
	'pnpm',
	'poetry',
	'uv',
	'yarn',
])
const PACKAGE_MODIFICATION_SUBCOMMANDS = new Set([
	'add',
	'dedupe',
	'import',
	'install',
	'link',
	'lock',
	'prune',
	'rebuild',
	'remove',
	'rm',
	'uninstall',
	'unlink',
	'update',
	'upgrade',
	'sync',
])
const PACKAGE_NETWORK_SUBCOMMANDS = new Set([
	'audit',
	'download',
	'info',
	'index',
	'login',
	'logout',
	'outdated',
	'ping',
	'publish',
	'search',
	'view',
	'whoami',
])
const SYSTEM_PACKAGE_MANAGERS = new Set([
	'apk',
	'apt',
	'apt-get',
	'brew',
	'choco',
	'dnf',
	'pacman',
	'port',
	'scoop',
	'winget',
	'yum',
	'zypper',
])
const SYSTEM_PACKAGE_MODIFICATION_SUBCOMMANDS = new Set([
	'add',
	'autoremove',
	'clean',
	'delete',
	'dist-upgrade',
	'erase',
	'install',
	'purge',
	'reinstall',
	'remove',
	'uninstall',
	'update',
	'upgrade',
])
const SYSTEM_PACKAGE_NETWORK_SUBCOMMANDS = new Set([
	'download',
	'info',
	'outdated',
	'search',
	'show',
])
const SHELL_SEARCH_EXECUTABLES = new Set([
	'ack',
	'ag',
	'grep',
	'jq',
	'rg',
	'sed',
	'findstr',
	'select-string',
	'yq',
])

const COMMAND_BOUNDARIES = new Set([';', '|', '&', '(', ')', '{', '}', '`'])
const COMMAND_PREFIXES = new Set([
	'!',
	'if',
	'then',
	'elif',
	'else',
	'while',
	'until',
	'do',
])
const SIMPLE_WRAPPERS = new Set([
	'exec',
	'nice',
	'nohup',
	'stdbuf',
	'time',
	'timeout',
])
const PYTHON_SCRIPT_EXTENSIONS = ['.py', '.pyw']
const JAVASCRIPT_SCRIPT_EXTENSIONS = [
	'.js',
	'.jsx',
	'.mjs',
	'.cjs',
	'.ts',
	'.tsx',
	'.mts',
	'.cts',
]
const OTHER_SCRIPT_EXTENSIONS = [
	'.java',
	'.cs',
	'.go',
	'.rb',
	'.rs',
	'.c',
	'.cc',
	'.cpp',
	'.cxx',
	'.php',
	'.pl',
	'.pm',
	'.lua',
	'.swift',
	'.kt',
	'.kts',
	'.scala',
	'.r',
	'.jl',
	'.ex',
	'.exs',
	'.erl',
]
const OTHER_LANGUAGE_EXECUTABLES = [
	/^(?:java|javac|jshell)$/,
	/^(?:dotnet|dotnet-script|csi|csc|mcs|mono|msbuild)$/,
	/^go(?:\d+(?:\.\d+)*)?$/,
	/^(?:ruby|irb)(?:\d+(?:\.\d+)*)?$/,
	/^(?:rustc|cargo)$/,
	/^(?:cc|c\+\+|gcc|g\+\+|clang|clang\+\+|tcc)(?:-\d+(?:\.\d+)*)?$/,
	/^(?:awk|gawk|mawk|php|perl|lua|swift|kotlinc|kotlin|scala|scalac|r|rscript|julia)$/,
	/^(?:elixir|iex|erl|escript|ghc|runghc|dart)$/,
]

function splitCommandSegments(command: string): string[][] {
	const segments: string[][] = []
	let words: string[] = []
	let word = ''
	let quote: "'" | '"' | undefined

	const pushWord = () => {
		if (word.length === 0) return
		words.push(word)
		word = ''
	}
	const pushSegment = () => {
		pushWord()
		if (words.length === 0) return
		segments.push(words)
		words = []
	}

	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!
		if (quote) {
			if (character === quote) {
				quote = undefined
			} else if (character === '\\' && index + 1 < command.length) {
				word += character + command[index + 1]!
				index += 1
			} else {
				word += character
			}
			continue
		}

		if (character === "'" || character === '"') {
			quote = character
			continue
		}
		if (character === '\\' && index + 1 < command.length) {
			word += character + command[index + 1]!
			index += 1
			continue
		}
		if (/\s/.test(character)) {
			pushWord()
			if (character === '\n') pushSegment()
			continue
		}
		if (COMMAND_BOUNDARIES.has(character)) {
			pushSegment()
			continue
		}

		word += character
	}

	pushSegment()
	return segments
}

function normalizeExecutable(token: string): string {
	const basename = token.replaceAll('\\', '/').split('/').at(-1) ?? token
	return basename.toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/i, '')
}

function isAssignment(token: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

function skipOptions(words: string[], startIndex: number): number {
	let index = startIndex
	while (index < words.length && words[index]!.startsWith('-')) {
		index += 1
	}
	return index
}

function createInvocation(
	words: string[],
	index: number,
	wrappers: string[],
): CommandInvocation {
	const token = words[index]!
	return {
		token,
		executable: normalizeExecutable(token),
		args: words.slice(index + 1),
		wrappers,
	}
}

function findCommandInvocation(words: string[]): CommandInvocation | undefined {
	let index = 0
	const wrappers: string[] = []
	while (index < words.length) {
		const token = words[index]!
		const executable = normalizeExecutable(token)

		if (isAssignment(token) || COMMAND_PREFIXES.has(executable)) {
			index += 1
			continue
		}
		if (executable === 'env') {
			const wrapperIndex = index
			wrappers.push('env')
			index = skipOptions(words, index + 1)
			while (index < words.length && isAssignment(words[index]!)) index += 1
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}
		if (executable === 'command') {
			const option = words[index + 1]
			if (option === '-v' || option === '-V') {
				return createInvocation(words, index, wrappers)
			}
			const wrapperIndex = index
			wrappers.push('command')
			index = skipOptions(words, index + 1)
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}
		if (SIMPLE_WRAPPERS.has(executable)) {
			const wrapperIndex = index
			wrappers.push(executable)
			index = skipOptions(words, index + 1)
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}
		if (executable === 'npx') {
			const wrapperIndex = index
			wrappers.push('npx')
			index = skipOptions(words, index + 1)
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}
		if (executable === 'npm' || executable === 'pnpm' || executable === 'yarn') {
			const subcommandIndex = skipOptions(words, index + 1)
			const subcommand = normalizeExecutable(words[subcommandIndex] ?? '')
			if (!['dlx', 'exec', 'x'].includes(subcommand)) {
				return createInvocation(words, index, wrappers)
			}
			const wrapperIndex = index
			wrappers.push(`${executable}:${subcommand}`)
			index = skipOptions(words, subcommandIndex + 1)
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}
		if (executable === 'uv') {
			const subcommandIndex = skipOptions(words, index + 1)
			if (normalizeExecutable(words[subcommandIndex] ?? '') !== 'run') {
				return createInvocation(words, index, wrappers)
			}
			const wrapperIndex = index
			wrappers.push('uv:run')
			index = skipOptions(words, subcommandIndex + 1)
			if (index >= words.length) return createInvocation(words, wrapperIndex, [])
			continue
		}

		return createInvocation(words, index, wrappers)
	}

	return undefined
}

function hasExtension(executable: string, extensions: string[]): boolean {
	return extensions.some((extension) => executable.endsWith(extension))
}

function classifyExecutable(token: string): LanguageExecution | undefined {
	const executable = normalizeExecutable(token)
	if (
		/^(?:pythonw?|pypy)(?:\d+(?:\.\d+)*)?$/.test(executable)
		|| executable === 'py'
		|| hasExtension(executable, PYTHON_SCRIPT_EXTENSIONS)
	) {
		return 'python'
	}
	if (
		/^(?:node(?:js)?(?:\d+(?:\.\d+)*)?|deno|bun|bunx|tsx|ts-node(?:-esm)?)$/.test(executable)
		|| hasExtension(executable, JAVASCRIPT_SCRIPT_EXTENSIONS)
	) {
		return 'javascript'
	}
	if (
		OTHER_LANGUAGE_EXECUTABLES.some((pattern) => pattern.test(executable))
		|| hasExtension(executable, OTHER_SCRIPT_EXTENSIONS)
	) {
		return 'other'
	}

	return undefined
}

function getExecPlatform(options: DangerousPathOptions): ExecPlatform | undefined {
	const platform = options.platform ?? process.platform
	return platform === 'darwin' || platform === 'linux' || platform === 'win32'
		? platform
		: undefined
}

function normalizeArgument(argument: string): string {
	return argument.toLowerCase()
}

function firstPositionalArgument(args: string[]): string | undefined {
	return args.find((argument) => argument !== '--' && !argument.startsWith('-'))
}

function parseGitInvocation(args: string[]): {
	globalArgs: string[]
	subcommand: string
	subcommandArgs: string[]
} {
	const optionsWithValues = new Set([
		'-c',
		'-C',
		'--exec-path',
		'--git-dir',
		'--namespace',
		'--super-prefix',
		'--work-tree',
	])
	let index = 0
	while (index < args.length) {
		const argument = args[index]!
		if (argument === '--') {
			index += 1
			break
		}
		if (optionsWithValues.has(argument)) {
			index += 2
			continue
		}
		if (argument.startsWith('-')) {
			index += 1
			continue
		}
		break
	}

	return {
		globalArgs: args.slice(0, index),
		subcommand: normalizeArgument(args[index] ?? ''),
		subcommandArgs: args.slice(index + 1),
	}
}

function classifyGitInvocation(args: string[]): DangerousExecOperation | undefined {
	const { subcommand, subcommandArgs } = parseGitInvocation(args)
	if (GIT_DELETION_SUBCOMMANDS.has(subcommand)) return 'file_deletion'
	if (GIT_MODIFICATION_SUBCOMMANDS.has(subcommand)) return 'file_modification'
	if (GIT_NETWORK_SUBCOMMANDS.has(subcommand)) return 'network_remote_control'
	if (
		subcommandArgs.some((argument) =>
			argument === '--output'
			|| argument.startsWith('--output='),
		)
	) {
		return 'file_modification'
	}
	if (
		subcommandArgs.some((argument) =>
			GIT_EXTERNAL_EXECUTION_OPTIONS.has(normalizeArgument(argument)),
		)
	) {
		return 'process_service_control'
	}

	if (subcommand === 'branch' || subcommand === 'tag') {
		const mutatingFlags = new Set([
			'-c',
			'-C',
			'-d',
			'-D',
			'-f',
			'-m',
			'-M',
			'--create-reflog',
			'--delete',
			'--edit-description',
			'--force',
			'--move',
		])
		if (subcommandArgs.some((argument) => mutatingFlags.has(argument))) {
			return 'file_modification'
		}
		if (subcommandArgs.some((argument) => !argument.startsWith('-'))) {
			return 'file_modification'
		}
	}
	if (subcommand === 'config') {
		const mutatingFlags = new Set([
			'--add',
			'--remove-section',
			'--rename-section',
			'--replace-all',
			'--unset',
			'--unset-all',
		])
		if (subcommandArgs.some((argument) => mutatingFlags.has(argument))) {
			return 'file_modification'
		}
		const values = subcommandArgs.filter((argument) => !argument.startsWith('-'))
		if (values.length > 1) return 'file_modification'
	}
	if (subcommand === 'remote') {
		const action = normalizeArgument(firstPositionalArgument(subcommandArgs) ?? '')
		if (action === 'update') return 'network_remote_control'
		if (['add', 'remove', 'rename', 'set-branches', 'set-head', 'set-url'].includes(action)) {
			return 'file_modification'
		}
	}

	return undefined
}

function classifyPackageManagerInvocation(
	executable: string,
	args: string[],
): DangerousExecOperation | undefined {
	if (executable === 'npx') return 'network_remote_control'
	let subcommand = normalizeArgument(firstPositionalArgument(args) ?? '')
	if (executable === 'uv' && subcommand === 'pip') {
		const pipIndex = args.findIndex((argument) => normalizeArgument(argument) === 'pip')
		subcommand = normalizeArgument(firstPositionalArgument(args.slice(pipIndex + 1)) ?? '')
	}
	if (PACKAGE_MODIFICATION_SUBCOMMANDS.has(subcommand)) return 'file_modification'
	if (PACKAGE_NETWORK_SUBCOMMANDS.has(subcommand)) return 'network_remote_control'
	return undefined
}

function classifySystemPackageManagerInvocation(
	args: string[],
): DangerousExecOperation | undefined {
	const subcommand = normalizeArgument(firstPositionalArgument(args) ?? '')
	if (SYSTEM_PACKAGE_MODIFICATION_SUBCOMMANDS.has(subcommand)) {
		return 'file_modification'
	}
	if (SYSTEM_PACKAGE_NETWORK_SUBCOMMANDS.has(subcommand)) {
		return 'network_remote_control'
	}
	return undefined
}

function operationForExecutable(
	executable: string,
	platform: ExecPlatform | undefined,
): DangerousExecOperation | undefined {
	const platformRules: Partial<
		Record<DangerousExecOperation, ReadonlySet<string>>
	> | undefined = platform
		? PLATFORM_DANGEROUS_EXECUTABLES[platform]
		: undefined
	for (const operation of DANGEROUS_OPERATION_ORDER) {
		if (COMMON_DANGEROUS_EXECUTABLES[operation].has(executable)) {
			return operation
		}
		if (platformRules?.[operation]?.has(executable)) {
			return operation
		}
	}
	return undefined
}

function classifyNestedExecutable(
	args: string[],
	marker: string,
	platform: ExecPlatform | undefined,
): DangerousExecOperation | undefined {
	const markerIndex = args.findIndex((argument) => normalizeArgument(argument) === marker)
	if (markerIndex < 0) return undefined
	const nestedToken = args.slice(markerIndex + 1).find((argument) => !argument.startsWith('-'))
	return nestedToken
		? operationForExecutable(normalizeExecutable(nestedToken), platform)
		: undefined
}

function classifyContextualInvocation(
	invocation: CommandInvocation,
	platform: ExecPlatform | undefined,
): DangerousExecOperation | undefined {
	const { executable, args, wrappers } = invocation
	if (
		wrappers.includes('npx')
		|| wrappers.some((wrapper) => wrapper.endsWith(':dlx'))
	) {
		return 'network_remote_control'
	}
	if (executable === 'git') return classifyGitInvocation(args)
	if (PACKAGE_MANAGERS.has(executable) || executable === 'npx') {
		return classifyPackageManagerInvocation(executable, args)
	}
	if (SYSTEM_PACKAGE_MANAGERS.has(executable)) {
		return classifySystemPackageManagerInvocation(args)
	}
	if (executable.startsWith('mkfs')) return 'file_deletion'
	if (executable === 'find') {
		const normalizedArgs = args.map(normalizeArgument)
		if (normalizedArgs.includes('-delete')) {
			return 'file_deletion'
		}
		if (normalizedArgs.some((argument) => FIND_FILE_OUTPUT_ACTIONS.has(argument))) {
			return 'file_modification'
		}
		for (const marker of FIND_INDIRECT_EXECUTION_ACTIONS) {
			const nestedOperation = classifyNestedExecutable(args, marker, platform)
			if (nestedOperation) return nestedOperation
		}
		if (
			normalizedArgs.some((argument) =>
				FIND_INDIRECT_EXECUTION_ACTIONS.has(argument),
			)
		) {
			return 'process_service_control'
		}
		return undefined
	}
	if (executable === 'xargs') {
		const nestedToken = firstPositionalArgument(args)
		return nestedToken
			? operationForExecutable(normalizeExecutable(nestedToken), platform)
			: undefined
	}
	if (executable === 'sed') {
		return args.some((argument) =>
			argument === '--in-place' || /^-i(?:$|[^A-Za-z])/.test(argument),
		)
			? 'file_modification'
			: undefined
	}
	if (executable === 'tar') {
		return args.some((argument) =>
			argument === '--extract'
			|| argument === '--get'
			|| argument === '--create'
			|| (
				/^-[^-]/.test(argument)
				&& (argument.includes('x') || argument.includes('c'))
			),
		)
			? 'file_modification'
			: undefined
	}
	if (executable === 'unzip') {
		return args.some((argument) => ['-l', '-p', '-t', '-v'].includes(argument))
			? undefined
			: 'file_modification'
	}
	if (executable === '7z' || executable === '7za') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (['d'].includes(action)) return 'file_deletion'
		if (['a', 'e', 'rn', 'u', 'x'].includes(action)) return 'file_modification'
	}
	if (executable === 'diskutil') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (action.startsWith('erase')) return 'file_deletion'
		if (['mount', 'mountdisk', 'partitiondisk', 'unmount', 'unmountdisk'].includes(action)) {
			return 'file_modification'
		}
	}
	if (executable === 'defaults') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (action === 'delete') return 'file_deletion'
		if (action === 'write' || action === 'import' || action === 'rename') {
			return 'file_modification'
		}
		if (action === 'read' || action === 'read-type' || action === 'find') {
			return 'sensitive_information_access'
		}
	}
	if (executable === 'plutil') {
		return args.some((argument) =>
			['-insert', '-remove', '-replace', '-convert'].includes(argument),
		)
			? 'file_modification'
			: undefined
	}
	if (executable === 'reg') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (action === 'query') return 'sensitive_information_access'
		if (action === 'delete') return 'file_deletion'
		if (['add', 'copy', 'import', 'load', 'restore', 'save', 'unload'].includes(action)) {
			return 'file_modification'
		}
	}
	if (executable === 'net') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (action === 'user' || action === 'localgroup') return 'user_account_change'
		if (['continue', 'pause', 'start', 'stop'].includes(action)) {
			return 'process_service_control'
		}
		if (['session', 'share', 'use', 'view'].includes(action)) {
			return 'network_remote_control'
		}
	}
	if (executable === 'sc') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (['config', 'continue', 'create', 'delete', 'failure', 'pause', 'start', 'stop'].includes(action)) {
			return 'process_service_control'
		}
	}
	if (executable === 'start-process') {
		const runAsIndex = args.findIndex((argument) => normalizeArgument(argument) === '-verb')
		if (normalizeArgument(args[runAsIndex + 1] ?? '') === 'runas') {
			return 'privilege_escalation'
		}
	}
	if (executable === 'gpg' || executable === 'gpg2') {
		if (args.some((argument) =>
			[
				'--export-secret-key',
				'--export-secret-keys',
				'--export-secret-subkeys',
				'--list-secret-key',
				'--list-secret-keys',
			].includes(argument),
		)) {
			return 'sensitive_information_access'
		}
	}
	if (executable === 'openssl' && normalizeArgument(args[0] ?? '') === 's_client') {
		return 'network_remote_control'
	}
	if (executable === 'export' && args.includes('-p')) {
		return 'sensitive_information_access'
	}
	if (executable === 'docker' || executable === 'podman') {
		const action = normalizeArgument(firstPositionalArgument(args) ?? '')
		if (['rm', 'rmi'].includes(action)) return 'file_deletion'
		if (['attach', 'exec', 'kill', 'pause', 'restart', 'run', 'start', 'stop', 'unpause'].includes(action)) {
			return 'process_service_control'
		}
		if (['login', 'logout', 'pull', 'push'].includes(action)) {
			return 'network_remote_control'
		}
	}

	return undefined
}

function hasFileOutputRedirection(command: string): boolean {
	let quote: "'" | '"' | undefined
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!
		if (quote) {
			if (character === quote) {
				quote = undefined
			} else if (character === '\\') {
				index += 1
			}
			continue
		}
		if (character === "'" || character === '"') {
			quote = character
			continue
		}
		if (character === '\\') {
			index += 1
			continue
		}
		if (character !== '>') continue

		const nextCharacter = command[index + 1]
		const descriptorTarget = command[index + 2]
		if (nextCharacter === '&' && descriptorTarget && /[\d-]/.test(descriptorTarget)) {
			index += 2
			while (index + 1 < command.length && /\d/.test(command[index + 1]!)) {
				index += 1
			}
			continue
		}
		return true
	}

	return false
}

function isOptionArgument(argument: string, platform: ExecPlatform | undefined): boolean {
	return (
		argument.startsWith('-')
		|| (platform === 'win32' && /^\/[A-Za-z?]+$/.test(argument))
	)
}

function sensitivePathArguments(
	invocation: CommandInvocation,
	platform: ExecPlatform | undefined,
): string[] {
	const normalizedArgs = invocation.args
		.map((argument) => argument.replace(/^\d*<+/, ''))
		.filter((argument) =>
			argument
			&& argument !== '--'
			&& !isOptionArgument(argument, platform),
		)

	if (SHELL_SEARCH_EXECUTABLES.has(invocation.executable)) {
		return normalizedArgs.slice(1)
	}
	if (invocation.executable === 'find') {
		const paths: string[] = []
		for (const argument of invocation.args) {
			if (argument === '!' || argument === '(' || argument.startsWith('-')) break
			paths.push(argument)
		}
		return paths
	}

	return normalizedArgs
}

function isPathInProject(
	filePath: string,
	options: DangerousPathOptions,
): boolean {
	const platform = getExecPlatform(options)
	const pathApi = platform === 'win32' ? win32 : posix
	const defaultRoot = platform === process.platform
		? process.cwd()
		: platform === 'win32'
			? 'C:\\'
			: '/'
	const projectRoot = pathApi.resolve(options.cwd ?? defaultRoot)
	const relativePath = pathApi.relative(projectRoot, filePath)
	return (
		relativePath === ''
		|| (!relativePath.startsWith(`..${pathApi.sep}`)
			&& relativePath !== '..'
			&& !pathApi.isAbsolute(relativePath))
	)
}

function readsSensitivePath(
	invocation: CommandInvocation,
	platform: ExecPlatform | undefined,
	options: DangerousPathOptions,
): boolean {
	const isReader =
		COMMON_SENSITIVE_PATH_READERS.has(invocation.executable)
		|| (platform === 'win32' && WINDOWS_SENSITIVE_PATH_READERS.has(invocation.executable))
	if (!isReader) return false

	for (const filePath of sensitivePathArguments(invocation, platform)) {
		if (platform === 'win32' && normalizeArgument(filePath).startsWith('env:')) {
			return true
		}
		const inspection = inspectDangerousPath(filePath, options)
		if (
			platform
			&& [inspection.requestedPath, inspection.resolvedPath].some((candidate) =>
				candidate
					? PLATFORM_SENSITIVE_SYSTEM_PATHS[platform].has(
						candidate.replaceAll('\\', '/').toLowerCase(),
					)
					: false,
			)
		) {
			return true
		}
		if (inspection.status === 'deny') return true
		if (
			inspection.status === 'user_selection_required'
			&& (
				!inspection.requestedPath
				|| !inspection.resolvedPath
				|| !isPathInProject(inspection.requestedPath, options)
				|| !isPathInProject(inspection.resolvedPath, options)
			)
		) {
			return true
		}
	}

	return false
}

function inlineShellCommand(invocation: CommandInvocation): string | undefined {
	let markerIndex = -1
	if (INLINE_POSIX_SHELLS.has(invocation.executable)) {
		markerIndex = invocation.args.findIndex((argument) =>
			/^-\w*c\w*$/.test(argument),
		)
	} else if (invocation.executable === 'cmd') {
		markerIndex = invocation.args.findIndex((argument) =>
			['/c', '/k'].includes(normalizeArgument(argument)),
		)
	} else if (invocation.executable === 'powershell' || invocation.executable === 'pwsh') {
		markerIndex = invocation.args.findIndex((argument) =>
			['-c', '-command'].includes(normalizeArgument(argument)),
		)
	}

	if (markerIndex < 0 || markerIndex + 1 >= invocation.args.length) return undefined
	return invocation.args.slice(markerIndex + 1).join(' ')
}

function hasDynamicShellSyntax(
	command: string,
	platform: ExecPlatform | undefined,
): boolean {
	if (
		platform === 'win32'
		&& (
			/%[A-Za-z_][A-Za-z0-9_]*%/.test(command)
			|| /![A-Za-z_][A-Za-z0-9_]*!/.test(command)
			|| /[?*\[]/.test(command)
		)
	) {
		return true
	}
	let quote: "'" | '"' | undefined
	for (let index = 0; index < command.length; index += 1) {
		const character = command[index]!
		if (quote === "'") {
			if (character === quote) quote = undefined
			continue
		}
		if (quote === '"') {
			if (character === quote) {
				quote = undefined
				continue
			}
			if (character === '\\' && platform !== 'win32') {
				index += 1
				continue
			}
			if (character === '$' || character === '`') return true
			if (
				platform === 'win32'
				&& (
					/^%[A-Za-z_][A-Za-z0-9_]*%/.test(command.slice(index))
					|| /^![A-Za-z_][A-Za-z0-9_]*!/.test(command.slice(index))
				)
			) {
				return true
			}
			continue
		}

		if (character === "'" || character === '"') {
			quote = character
			continue
		}
		if (character === '\\' && platform !== 'win32') {
			index += 1
			continue
		}
		if (character === '$' || character === '`') return true
		if (
			(character === '<' || character === '>')
			&& command[index + 1] === '('
		) {
			return true
		}
		if (['*', '?', '[', '{', '}'].includes(character)) return true
		if (
			platform === 'win32'
			&& (
				/^%[A-Za-z_][A-Za-z0-9_]*%/.test(command.slice(index))
				|| /^![A-Za-z_][A-Za-z0-9_]*!/.test(command.slice(index))
			)
		) {
			return true
		}
		if (character === '&') {
			if (command[index + 1] === '&') {
				index += 1
				continue
			}
			if (command[index - 1] === '>' || command[index - 1] === '<') {
				continue
			}
			return true
		}
	}

	return quote !== undefined
}

function isSafeDateInvocation(
	args: string[],
	platform: ExecPlatform | undefined,
): boolean {
	if (platform === 'win32') {
		return args.length === 1 && normalizeArgument(args[0]!) === '/t'
	}
	const safeOptions = new Set([
		'-R',
		'-u',
		'--help',
		'--resolution',
		'--rfc-email',
		'--universal',
		'--utc',
		'--version',
	])
	return args.every((argument) =>
		argument.startsWith('+')
		|| safeOptions.has(argument)
		|| /^-I(?:date|hours|minutes|seconds|ns)?$/.test(argument)
		|| /^--iso-8601(?:=(?:date|hours|minutes|seconds|ns))?$/.test(argument)
		|| /^--rfc-3339=(?:date|seconds|ns)$/.test(argument),
	)
}

function isSafeGitInvocation(args: string[]): boolean {
	const { globalArgs, subcommand, subcommandArgs } = parseGitInvocation(args)
	if (!SAFE_GIT_SUBCOMMANDS.has(subcommand)) return false
	if (globalArgs.some((argument) => argument !== '--no-pager')) return false
	return !subcommandArgs.some((argument) => {
		const normalizedArgument = normalizeArgument(argument)
		return (
			normalizedArgument === '--no-index'
			|| normalizedArgument === '--output'
			|| normalizedArgument.startsWith('--output=')
			|| GIT_EXTERNAL_EXECUTION_OPTIONS.has(normalizedArgument)
		)
	})
}

function isSafeFindInvocation(args: string[]): boolean {
	return !args.some((argument) => {
		const normalizedArgument = normalizeArgument(argument)
		return (
			argument === '-H'
			|| argument === '-L'
			|| normalizedArgument === '-delete'
			|| normalizedArgument === '-follow'
			|| normalizedArgument === '-files0-from'
			|| normalizedArgument === '--files0-from'
			|| normalizedArgument === '-anewer'
			|| normalizedArgument === '-cnewer'
			|| normalizedArgument === '-samefile'
			|| normalizedArgument.startsWith('-newer')
			|| FIND_INDIRECT_EXECUTION_ACTIONS.has(normalizedArgument)
			|| FIND_FILE_OUTPUT_ACTIONS.has(normalizedArgument)
		)
	})
}

function isSafeGrepInvocation(args: string[]): boolean {
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index]!
		const normalizedArgument = normalizeArgument(argument)
		if (
			normalizedArgument === '--recursive'
			|| normalizedArgument === '--dereference-recursive'
			|| normalizedArgument === '--file'
			|| normalizedArgument.startsWith('--file=')
			|| normalizedArgument === '--exclude-from'
			|| normalizedArgument.startsWith('--exclude-from=')
			|| normalizedArgument === '--directories=recurse'
			|| /^-[^-]*[rR]/.test(argument)
			|| /^-[^-]*f/.test(argument)
		) {
			return false
		}
		if (
			(normalizedArgument === '-d' || normalizedArgument === '--directories')
			&& normalizeArgument(args[index + 1] ?? '') === 'recurse'
		) {
			return false
		}
	}

	return true
}

function isSafeLsInvocation(args: string[]): boolean {
	return !args.some((argument) =>
		argument === '--dereference'
		|| argument.startsWith('--dereference-command-line')
		|| (/^-[^-]/.test(argument) && /[HL]/.test(argument.slice(1))),
	)
}

function isSafeWindowsInvocation(invocation: CommandInvocation): boolean {
	if (invocation.executable === 'dir') {
		return !invocation.args.some((argument) =>
			normalizeArgument(argument).startsWith('/s'),
		)
	}
	if (invocation.executable === 'findstr') {
		return !invocation.args.some((argument) => {
			const normalizedArgument = normalizeArgument(argument)
			return (
				normalizedArgument.startsWith('/f:')
				|| normalizedArgument.startsWith('/g:')
				|| /^\/[a-z]*s[a-z]*$/.test(normalizedArgument)
			)
		})
	}
	if (invocation.executable === 'get-childitem') {
		return !invocation.args.some((argument) =>
			normalizeArgument(argument) === '-followsymlink',
		)
	}
	if (invocation.executable === 'where') {
		return !invocation.args.some((argument) =>
			normalizeArgument(argument) === '/r',
		)
	}

	return true
}

function isSafeInvocation(
	invocation: CommandInvocation,
	options: DangerousPathOptions,
	depth: number,
): boolean {
	const platform = getExecPlatform(options)
	const inlineCommand = inlineShellCommand(invocation)
	if (inlineCommand !== undefined) {
		if (depth >= 3) return false
		if (
			invocation.executable === 'cmd'
			&& !invocation.args.some((argument) => normalizeArgument(argument) === '/c')
		) {
			return false
		}
		if (
			(invocation.executable === 'powershell' || invocation.executable === 'pwsh')
			&& splitCommandSegments(inlineCommand).length !== 1
		) {
			return false
		}
		return isSafeExecCommandInternal(inlineCommand, options, depth + 1)
	}
	if (invocation.wrappers.length > 0) return false
	if (invocation.executable === 'git') {
		return isSafeGitInvocation(invocation.args)
	}
	if (
		platform === 'win32'
		&& WINDOWS_SAFE_EXECUTABLES.has(invocation.executable)
	) {
		return isSafeWindowsInvocation(invocation)
	}
	if (!COMMON_SAFE_EXECUTABLES.has(invocation.executable)) return false
	if (invocation.executable === 'date') {
		return isSafeDateInvocation(invocation.args, platform)
	}
	if (invocation.executable === 'find') {
		return isSafeFindInvocation(invocation.args)
	}
	if (invocation.executable === 'grep') {
		return isSafeGrepInvocation(invocation.args)
	}
	if (invocation.executable === 'ls') {
		return isSafeLsInvocation(invocation.args)
	}
	if (invocation.executable === 'pwd') {
		return invocation.args.every((argument) =>
			['-L', '-P', '--help', '--version'].includes(argument),
		)
	}
	if (invocation.executable === 'whoami') {
		return invocation.args.every((argument) =>
			['--help', '--version'].includes(argument),
		)
	}

	return true
}

function isSafeExecCommandInternal(
	command: string,
	options: DangerousPathOptions,
	depth: number,
): boolean {
	const platform = getExecPlatform(options)
	if (command.trim() === '' || hasDynamicShellSyntax(command, platform)) {
		return false
	}

	const segments = splitCommandSegments(command)
	return segments.length > 0 && segments.every((words) => {
		if (words.some(isAssignment)) return false
		const invocation = findCommandInvocation(words)
		return invocation !== undefined
			&& isSafeInvocation(invocation, options, depth)
	})
}

function detectDangerousOperationInternal(
	command: string,
	options: DangerousPathOptions,
	depth: number,
): DangerousExecOperation | undefined {
	const platform = getExecPlatform(options)
	for (const words of splitCommandSegments(command)) {
		const invocation = findCommandInvocation(words)
		if (!invocation) continue

		const contextualOperation = classifyContextualInvocation(invocation, platform)
		if (contextualOperation) return contextualOperation

		const executableOperation = operationForExecutable(invocation.executable, platform)
		if (executableOperation) return executableOperation

		if (readsSensitivePath(invocation, platform, options)) {
			return 'sensitive_information_access'
		}

		if (depth < 3) {
			const inlineCommand = inlineShellCommand(invocation)
			if (inlineCommand) {
				const inlineOperation = detectDangerousOperationInternal(
					inlineCommand,
					options,
					depth + 1,
				)
				if (inlineOperation) return inlineOperation
			}
		}
	}

	return hasFileOutputRedirection(command) ? 'file_modification' : undefined
}

export function detectDangerousOperation(
	command: string,
	options: DangerousPathOptions = {},
): DangerousExecOperation | undefined {
	return detectDangerousOperationInternal(command, options, 0)
}

export function isChangingDirectory(command: string): boolean {
	return /(?:^|[\s;|&])(?:cd|chdir|pushd|popd)(?:\s|$)/i.test(command)
}

export function detectLanguageExecution(
	command: string,
): LanguageExecution | undefined {
	for (const words of splitCommandSegments(command)) {
		const invocation = findCommandInvocation(words)
		if (!invocation) continue

		const language = classifyExecutable(invocation.token)
		if (language) return language
	}

	return undefined
}

export function isSafeExecCommand(
	command: string,
	options: DangerousPathOptions = {},
): boolean {
	if (isChangingDirectory(command)) return false
	if (detectLanguageExecution(command)) return false
	if (detectDangerousOperation(command, options)) return false
	return isSafeExecCommandInternal(command, options, 0)
}

export function authorizeExec(
	args: Record<string, unknown>,
	options: DangerousPathOptions = {},
): ToolAuthorization {
	const command = args.command
	if (typeof command !== 'string') return { action: 'ask' }
	if (isChangingDirectory(command)) {
		return { action: 'deny', reason: 'directory_change' }
	}

	const language = detectLanguageExecution(command)
	if (language === 'python') {
		return { action: 'deny', reason: 'python_execution' }
	}
	if (language === 'javascript') {
		return { action: 'deny', reason: 'javascript_execution' }
	}
	if (language === 'other') {
		return { action: 'deny', reason: 'other_language_execution' }
	}

	const dangerousOperation = detectDangerousOperation(command, options)
	if (dangerousOperation) {
		return { action: 'deny', reason: dangerousOperation }
	}
	if (isSafeExecCommandInternal(command, options, 0)) {
		return { action: 'allow' }
	}

	return { action: 'ask' }
}
