import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import dangerousPathConfig from './dangerous-path.json'

export type DangerousPathPlatform = 'darwin' | 'win32' | 'linux'

export interface DangerousPathOptions {
	platform?: NodeJS.Platform
	cwd?: string
	env?: Readonly<NodeJS.ProcessEnv>
	userHomes?: readonly string[]
	resolveRealPath?: (absolutePath: string) => string | undefined
}

export type DangerousPathStatus =
	| 'safe'
	| 'deny'
	| 'user_selection_required'
	| 'invalid'

export interface DangerousPathInspection {
	status: DangerousPathStatus
	requestedPath?: string
	resolvedPath?: string
	ruleIds: string[]
}

interface DangerousPathRule {
	id: string
	patterns: string[]
}

interface DynamicRule {
	id: string
	platforms: DangerousPathPlatform[]
	folders?: string[]
}

interface DangerousPathConfig {
	variables: Record<string, string>
	dynamic_rules: DynamicRule[]
	rules: Record<'common' | DangerousPathPlatform, DangerousPathRule[]>
}

interface RuntimeContext {
	platform: DangerousPathPlatform
	pathApi: typeof posix
	cwd: string
	primaryHome?: string
	systemDrive?: string
	inputVariable: (name: string) => string | undefined
	patternVariables: Map<string, string[]>
}

interface RulePattern {
	id: string
	pattern: string
}

interface RuleMatcher {
	id: string
	matcher: RegExp
}

const config = dangerousPathConfig as unknown as DangerousPathConfig
const supportedPlatforms = new Set<DangerousPathPlatform>([
	'darwin',
	'win32',
	'linux',
])

function isSupportedPlatform(platform: NodeJS.Platform): platform is DangerousPathPlatform {
	return supportedPlatforms.has(platform as DangerousPathPlatform)
}

function unwrapQuotedValue(
	value: string,
	preserveUnquotedWhitespace = false,
): string | undefined {
	const trimmed = value.trim()
	if (!trimmed) {
		return undefined
	}

	const first = trimmed[0]
	const last = trimmed.at(-1)
	const startsWithQuote = first === '"' || first === "'"
	const endsWithQuote = last === '"' || last === "'"

	if (startsWithQuote || endsWithQuote) {
		if (!startsWithQuote || first !== last) {
			return undefined
		}
		return trimmed.slice(1, -1) || undefined
	}

	return preserveUnquotedWhitespace ? value : trimmed
}

function uniqueValues(values: Array<string | undefined>): string[] {
	return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function createEnvironmentLookup(
	env: Readonly<NodeJS.ProcessEnv>,
	platform: DangerousPathPlatform,
): (name: string) => string | undefined {
	const exact = new Map<string, string>()
	const uppercase = new Map<string, string>()

	for (const [name, rawValue] of Object.entries(env)) {
		if (rawValue === undefined) {
			continue
		}
		const value = unwrapQuotedValue(rawValue)
		if (value !== undefined) {
			exact.set(name, value)
			uppercase.set(name.toUpperCase(), value)
		}
	}

	return (name: string) =>
		platform === 'win32'
			? uppercase.get(name.toUpperCase())
			: exact.get(name) ?? uppercase.get(name.toUpperCase())
}

function addPatternValues(
	variables: Map<string, string[]>,
	name: string,
	values: Array<string | undefined>,
): void {
	const existing = variables.get(name) ?? []
	variables.set(name, uniqueValues([...existing, ...values]))
}

function createRuntimeContext(
	platform: DangerousPathPlatform,
	options: DangerousPathOptions,
): RuntimeContext {
	const pathApi = platform === 'win32' ? win32 : posix
	const env = options.env ?? process.env
	const environmentValue = createEnvironmentLookup(env, platform)
	const platformHome =
		platform === process.platform ? unwrapQuotedValue(homedir()) : undefined
	const windowsEnvironmentHome =
		platform === 'win32'
			? environmentValue('USERPROFILE') ??
				(environmentValue('HOMEDRIVE') && environmentValue('HOMEPATH')
					? `${environmentValue('HOMEDRIVE')}${environmentValue('HOMEPATH')}`
					: undefined)
			: undefined
	const environmentHome =
		platform === 'win32' ? windowsEnvironmentHome : environmentValue('HOME')
	const configuredHomes =
		options.userHomes
			?.map((home) => unwrapQuotedValue(home))
			.filter((home): home is string => Boolean(home)) ??
		[]
	const concreteHomes = uniqueValues([
		...configuredHomes,
		platformHome,
		environmentHome,
	])
	const primaryHome = concreteHomes[0]

	const systemRootFromEnvironment = environmentValue('SYSTEMROOT') ?? environmentValue('WINDIR')
	const detectedDrive =
		environmentValue('SYSTEMDRIVE') ??
		systemRootFromEnvironment?.match(/^[A-Za-z]:/)?.[0] ??
		primaryHome?.match(/^[A-Za-z]:/)?.[0]
	const systemDrive = platform === 'win32' ? detectedDrive ?? 'C:' : undefined
	const systemRoot =
		platform === 'win32'
			? systemRootFromEnvironment ?? `${systemDrive}\\Windows`
			: undefined
	const programData =
		platform === 'win32'
			? environmentValue('PROGRAMDATA') ?? `${systemDrive}\\ProgramData`
			: undefined
	const appData =
		platform === 'win32'
			? environmentValue('APPDATA') ??
				(primaryHome ? win32.join(primaryHome, 'AppData', 'Roaming') : undefined)
			: undefined
	const localAppData =
		platform === 'win32'
			? environmentValue('LOCALAPPDATA') ??
				(primaryHome ? win32.join(primaryHome, 'AppData', 'Local') : undefined)
			: undefined
	const defaultRoot = platform === 'win32' ? `${systemDrive}\\` : '/'
	const cwd = pathApi.resolve(
		options.cwd ?? (platform === process.platform ? process.cwd() : primaryHome ?? defaultRoot),
	)

	const computedInputVariables = new Map<string, string>()
	const setInputVariable = (name: string, value: string | undefined): void => {
		if (value !== undefined) {
			computedInputVariables.set(name, value)
		}
	}

	setInputVariable('HOME', primaryHome)
	setInputVariable('USER_HOME', primaryHome)
	setInputVariable('USERPROFILE', windowsEnvironmentHome ?? primaryHome)
	setInputVariable('SYSTEMDRIVE', systemDrive)
	setInputVariable('SYSTEMROOT', systemRoot)
	setInputVariable('WINDIR', systemRoot)
	setInputVariable('PROGRAMDATA', programData)
	setInputVariable('APPDATA', appData)
	setInputVariable('LOCALAPPDATA', localAppData)

	const inputVariable = (name: string): string | undefined => {
		const normalizedName = platform === 'win32' ? name.toUpperCase() : name
		return (
			computedInputVariables.get(normalizedName) ??
			environmentValue(name) ??
			computedInputVariables.get(name.toUpperCase())
		)
	}

	const patternVariables = new Map<string, string[]>()
	// 通配标准用户目录，同时保留系统 API 或调用方提供的非标准 Home。
	const standardUserHomes =
		platform === 'win32'
			? [`${systemDrive}\\Users\\*`]
			: platform === 'darwin'
				? ['/Users/*', '/var/root']
				: ['/home/*', '/root']
	addPatternValues(patternVariables, 'USER_HOME', [
		...concreteHomes,
		...standardUserHomes,
	])
	addPatternValues(patternVariables, 'SYSTEMDRIVE', [systemDrive])
	addPatternValues(patternVariables, 'SYSTEMROOT', [systemRoot])
	addPatternValues(patternVariables, 'PROGRAMDATA', [programData])
	addPatternValues(patternVariables, 'APPDATA', [
		appData,
		...concreteHomes.map((home) =>
			platform === 'win32' ? win32.join(home, 'AppData', 'Roaming') : undefined,
		),
	])
	addPatternValues(patternVariables, 'LOCALAPPDATA', [
		localAppData,
		...concreteHomes.map((home) =>
			platform === 'win32' ? win32.join(home, 'AppData', 'Local') : undefined,
		),
	])
	addPatternValues(patternVariables, 'XDG_CONFIG_HOME', [
		environmentValue('XDG_CONFIG_HOME'),
		...concreteHomes.map((home) => pathApi.join(home, '.config')),
	])
	addPatternValues(patternVariables, 'XDG_DATA_HOME', [
		environmentValue('XDG_DATA_HOME'),
		...concreteHomes.map((home) => pathApi.join(home, '.local', 'share')),
	])
	addPatternValues(patternVariables, 'XDG_STATE_HOME', [
		environmentValue('XDG_STATE_HOME'),
		...concreteHomes.map((home) => pathApi.join(home, '.local', 'state')),
	])
	addPatternValues(patternVariables, 'XDG_RUNTIME_DIR', [
		environmentValue('XDG_RUNTIME_DIR'),
	])

	for (const variableName of Object.keys(config.variables)) {
		if (variableName === 'KUBECONFIG') {
			addPatternValues(
				patternVariables,
				variableName,
				environmentValue(variableName)?.split(pathApi.delimiter) ?? [],
			)
		} else {
			addPatternValues(patternVariables, variableName, [
				inputVariable(variableName),
			])
		}
	}

	return {
		platform,
		pathApi,
		cwd,
		primaryHome,
		systemDrive,
		inputVariable,
		patternVariables,
	}
}

function expandInputPath(filePath: string, context: RuntimeContext): string | undefined {
	let expanded = unwrapQuotedValue(filePath, true)
	if (expanded === undefined || expanded.includes('\0')) {
		return undefined
	}

	if (/^~(?=$|[\\/])/.test(expanded)) {
		if (!context.primaryHome) {
			return undefined
		}
		expanded = `${context.primaryHome}${expanded.slice(1)}`
	} else if (expanded.startsWith('~')) {
		return undefined
	}

	for (let pass = 0; pass < 10; pass += 1) {
		let unresolved = false
		let changed = false
		const replaceVariable = (match: string, name: string): string => {
			const value = context.inputVariable(name)
			if (value === undefined) {
				unresolved = true
				return match
			}
			changed = changed || value !== match
			return value
		}

		expanded = expanded.replace(/%([^%]+)%/g, replaceVariable)
		expanded = expanded.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, replaceVariable)
		if (context.platform !== 'win32') {
			expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, replaceVariable)
		}

		if (unresolved) {
			return undefined
		}
		if (!changed) {
			return expanded
		}
	}

	return undefined
}

function normalizeForMatch(value: string, platform: DangerousPathPlatform): string {
	let normalized = value.replace(/\\/g, '/').normalize('NFC')

	if (platform === 'win32' && !normalized.startsWith('//?/')) {
		// Win32 会折叠普通路径段末尾的空格和点，先按同样规则处理以阻止别名绕过。
		normalized = normalized
			.split('/')
			.map((segment, index) =>
				index === 0 || /^[A-Za-z]:$/.test(segment)
					? segment
					: segment.replace(/[ .]+$/g, ''),
			)
			.join('/')
	}

	if (
		normalized.length > 1 &&
		normalized.endsWith('/') &&
		!/^([A-Za-z]:)?\/$/.test(normalized)
	) {
		normalized = normalized.replace(/\/+$/, '')
	}

	return normalized
}

function normalizeCandidate(
	expandedPath: string,
	context: RuntimeContext,
): string | undefined {
	if (
		context.platform === 'win32' &&
		/^[A-Za-z]:(?:$|[^\\/])/.test(expandedPath)
	) {
		return undefined
	}

	try {
		return normalizeForMatch(
			context.pathApi.resolve(context.cwd, expandedPath),
			context.platform,
		)
	} catch {
		return undefined
	}
}

function hasDangerousWindowsSyntax(candidate: string): boolean {
	const lowercase = candidate.toLowerCase()
	if (
		lowercase.startsWith('//') ||
		lowercase.startsWith('/device/') ||
		lowercase.startsWith('/??/') ||
		lowercase.startsWith('/global??/')
	) {
		return true
	}

	const withoutDrive = candidate.replace(/^[A-Za-z]:/, '')
	if (withoutDrive.includes(':')) {
		return true
	}

	return candidate.split('/').some((segment) => {
		const baseName = segment.split('.')[0]?.toLowerCase()
		return (
			/^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/.test(baseName) ||
			/~\d+(?:\.|$)/.test(segment)
		)
	})
}

function expandPattern(pattern: string, context: RuntimeContext): string[] {
	const names = [
		...new Set(
			[...pattern.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((match) => match[1]),
		),
	]
	let expandedPatterns = [pattern]

	for (const name of names) {
		const values = context.patternVariables.get(name)
		if (!values?.length) {
			return []
		}
		expandedPatterns = expandedPatterns.flatMap((currentPattern) =>
			values.map((value) => currentPattern.replaceAll(`\${${name}}`, value)),
		)
	}

	return expandedPatterns
}

function dynamicPatterns(context: RuntimeContext): RulePattern[] {
	const patterns: RulePattern[] = []
	const userHomes = context.patternVariables.get('USER_HOME') ?? []
	const addPattern = (id: string, pattern: string): void => {
		patterns.push({ id, pattern })
	}

	for (const rule of config.dynamic_rules) {
		if (!rule.platforms.includes(context.platform)) {
			continue
		}

		if (rule.id === 'personal-known-folders') {
			for (const home of userHomes) {
				for (const folder of rule.folders ?? []) {
					addPattern(rule.id, context.pathApi.join(home, folder, '**'))
					if (folder === 'CloudStorage' && context.platform === 'darwin') {
						addPattern(
							rule.id,
							context.pathApi.join(home, 'Library', 'CloudStorage', '**'),
						)
					}
					if (folder === 'OneDrive') {
						addPattern(rule.id, context.pathApi.join(home, 'OneDrive*', '**'))
					}
				}
			}

			for (const variableName of ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer']) {
				const value = context.inputVariable(variableName)
				if (value) {
					addPattern(rule.id, context.pathApi.join(value, '**'))
				}
			}
		}

		if (rule.id === 'removable-network-and-cloud-volumes') {
			if (context.platform === 'darwin') {
				addPattern(rule.id, '/Volumes/**')
			} else if (context.platform === 'linux') {
				for (const pattern of ['/media/**', '/mnt/**', '/run/media/**']) {
					addPattern(rule.id, pattern)
				}
			} else {
				addPattern(rule.id, '//*/**')
				const systemDriveLetter = context.systemDrive?.[0]?.toUpperCase()
				for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
					const driveLetter = String.fromCharCode(code)
					if (driveLetter !== systemDriveLetter) {
						addPattern(rule.id, `${driveLetter}:/**`)
					}
				}
			}
		}
	}

	return patterns
}

function normalizePattern(pattern: string, context: RuntimeContext): string {
	let normalized = normalizeForMatch(pattern, context.platform)
	if (!normalized.startsWith('**') && !context.pathApi.isAbsolute(normalized)) {
		normalized = normalizeForMatch(
			context.pathApi.resolve(context.cwd, normalized),
			context.platform,
		)
	}
	return normalized
}

function globToRegExp(pattern: string, caseSensitive: boolean): RegExp {
	let source = '^'

	for (let index = 0; index < pattern.length; index += 1) {
		if (pattern.startsWith('/**', index) && index + 3 === pattern.length) {
			source += '(?:/.*)?'
			index += 2
		} else if (pattern.startsWith('**/', index)) {
			source += '(?:.*/)?'
			index += 2
		} else if (pattern.startsWith('**', index)) {
			source += '.*'
			index += 1
		} else if (pattern[index] === '*') {
			source += '[^/]*'
		} else {
			const character = pattern[index]
			source += '\\^$+?.()|{}[]'.includes(character) ? `\\${character}` : character
		}
	}

	return new RegExp(`${source}$`, caseSensitive ? '' : 'i')
}

function createRuleMatchers(
	patterns: RulePattern[],
	context: RuntimeContext,
): RuleMatcher[] {
	const caseSensitive = context.platform === 'linux'
	const uniquePatterns = new Map<string, RulePattern>()

	for (const pattern of patterns) {
		const normalizedPattern = normalizePattern(pattern.pattern, context)
		uniquePatterns.set(`${pattern.id}\0${normalizedPattern}`, {
			id: pattern.id,
			pattern: normalizedPattern,
		})
	}

	return [...uniquePatterns.values()].map(({ id, pattern }) => ({
		id,
		matcher: globToRegExp(pattern, caseSensitive),
	}))
}

function createMatchers(context: RuntimeContext): {
	staticMatchers: RuleMatcher[]
	dynamicMatchers: RuleMatcher[]
} {
	const configuredRules = [
		...config.rules.common,
		...config.rules[context.platform],
	]
	const staticPatterns = configuredRules.flatMap((rule) =>
		rule.patterns.flatMap((pattern) =>
			expandPattern(pattern, context).map((expandedPattern) => ({
				id: rule.id,
				pattern: expandedPattern,
			})),
		),
	)

	return {
		staticMatchers: createRuleMatchers(staticPatterns, context),
		dynamicMatchers: createRuleMatchers(dynamicPatterns(context), context),
	}
}

function resolveExistingPath(absolutePath: string, pathApi: typeof posix): string | undefined {
	let currentPath = pathApi.normalize(absolutePath)
	const missingSegments: string[] = []

	// 目标尚不存在时解析最近的现存父目录，仍能识别父目录中的 symlink 或 junction。
	while (true) {
		try {
			return pathApi.resolve(realpathSync.native(currentPath), ...missingSegments)
		} catch (error) {
			const code =
				typeof error === 'object' && error !== null && 'code' in error
					? String(error.code)
					: undefined
			if (code !== 'ENOENT' && code !== 'ENOTDIR') {
				throw error
			}

			const parent = pathApi.dirname(currentPath)
			if (parent === currentPath) {
				return undefined
			}
			missingSegments.unshift(pathApi.basename(currentPath))
			currentPath = parent
		}
	}
}

function matchingRuleIds(candidate: string, matchers: RuleMatcher[]): string[] {
	return [
		...new Set(
			matchers
				.filter(({ matcher }) => matcher.test(candidate))
				.map(({ id }) => id),
		),
	]
}

function inspectPath(
	filePath: string,
	options: DangerousPathOptions,
): DangerousPathInspection {
	const platform = options.platform ?? process.platform
	if (!isSupportedPlatform(platform)) {
		return { status: 'invalid', ruleIds: [] }
	}

	const context = createRuntimeContext(platform, options)
	const expandedPath = expandInputPath(filePath, context)
	if (expandedPath === undefined) {
		return { status: 'invalid', ruleIds: [] }
	}

	const candidate = normalizeCandidate(expandedPath, context)
	if (candidate === undefined) {
		return { status: 'invalid', ruleIds: [] }
	}
	if (platform === 'win32' && hasDangerousWindowsSyntax(candidate)) {
		return {
			status: 'deny',
			requestedPath: candidate,
			ruleIds: ['win32-special-path'],
		}
	}

	const { staticMatchers, dynamicMatchers } = createMatchers(context)
	let staticRuleIds = matchingRuleIds(candidate, staticMatchers)
	let dynamicRuleIds = matchingRuleIds(candidate, dynamicMatchers)

	const realPathResolver =
		options.resolveRealPath ??
		(platform === process.platform
			? (absolutePath: string) => resolveExistingPath(absolutePath, context.pathApi)
			: undefined)
	let resolvedPath = candidate

	if (realPathResolver) {
		try {
			const realPath = realPathResolver(candidate)
			if (realPath !== undefined) {
				const normalizedResolvedPath = normalizeCandidate(realPath, context)
				if (normalizedResolvedPath === undefined) {
					return {
						status: 'invalid',
						requestedPath: candidate,
						ruleIds: [],
					}
				}
				resolvedPath = normalizedResolvedPath
			}
		} catch {
			if (staticRuleIds.length > 0) {
				return {
					status: 'deny',
					requestedPath: candidate,
					ruleIds: staticRuleIds,
				}
			}
			return {
				status: 'invalid',
				requestedPath: candidate,
				ruleIds: [],
			}
		}
	}

	if (platform === 'win32' && hasDangerousWindowsSyntax(resolvedPath)) {
		return {
			status: 'deny',
			requestedPath: candidate,
			resolvedPath,
			ruleIds: ['win32-special-path'],
		}
	}

	staticRuleIds = [
		...new Set([...staticRuleIds, ...matchingRuleIds(resolvedPath, staticMatchers)]),
	]
	dynamicRuleIds = [
		...new Set([
			...dynamicRuleIds,
			...matchingRuleIds(resolvedPath, dynamicMatchers),
		]),
	]
	const ruleIds = [...staticRuleIds, ...dynamicRuleIds]

	if (staticRuleIds.length > 0) {
		return {
			status: 'deny',
			requestedPath: candidate,
			resolvedPath,
			ruleIds,
		}
	}
	if (dynamicRuleIds.length > 0) {
		return {
			status: 'user_selection_required',
			requestedPath: candidate,
			resolvedPath,
			ruleIds,
		}
	}

	return {
		status: 'safe',
		requestedPath: candidate,
		resolvedPath,
		ruleIds: [],
	}
}

export function inspectDangerousPath(
	filePath: string,
	options: DangerousPathOptions = {},
): DangerousPathInspection {
	if (typeof filePath !== 'string') {
		return { status: 'invalid', ruleIds: [] }
	}

	try {
		return inspectPath(filePath, options)
	} catch {
		return { status: 'invalid', ruleIds: [] }
	}
}

export function isDangerousPath(
	filePath: string,
	options: DangerousPathOptions = {},
): boolean {
	if (typeof filePath !== 'string') {
		return true
	}

	return inspectDangerousPath(filePath, options).status !== 'safe'
}
