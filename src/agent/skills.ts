import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import chalk from 'chalk'
import { parseDocument } from 'yaml'

export type Skill = {
	name: string
	description: string
	path: string
}

// ts-node 开发与 dist 运行时都从 agent 目录旁的 skills/ 扫描内置 SKILL.md。
const SKILLS_DIRECTORY = join(__dirname, 'skills')

function findSkillFiles(directory: string): string[] {
	if (!existsSync(directory)) {
		return []
	}

	const files: string[] = []
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name)
		if (entry.isDirectory()) {
			files.push(...findSkillFiles(entryPath))
		} else if (entry.isFile() && entry.name === 'SKILL.md') {
			files.push(entryPath)
		}
	}

	return files
}

function parseSkill(skillPath: string): Skill | undefined {
	try {
		const source = readFileSync(skillPath, 'utf8')
		const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
		if (!frontmatter) {
			throw new Error('SKILL.md must start with YAML frontmatter.')
		}

		const document = parseDocument(frontmatter[1])
		if (document.errors.length > 0) {
			throw new Error(document.errors[0].message)
		}

		const metadata = document.toJS()
		const name = metadata?.name
		const description = metadata?.description
		if (typeof name !== 'string' || !name || typeof description !== 'string' || !description) {
			throw new Error('name and description are required.')
		}

		return { name, description, path: skillPath }
	} catch (error) {
		console.warn(
			chalk.yellow(`[Skills] Skipped ${skillPath}: ${(error as Error).message}`),
		)
		return undefined
	}
}

export function discoverSkills(directory = SKILLS_DIRECTORY): Skill[] {
	const discovered = new Map<string, Skill>()

	for (const skillPath of findSkillFiles(directory)) {
		const skill = parseSkill(skillPath)
		if (!skill) continue

		if (discovered.has(skill.name)) {
			console.warn(
				chalk.yellow(
					`[Skills] Skipped duplicate skill: ${skill.name} (${skillPath})`,
				),
			)
			continue
		}

		if (basename(dirname(skillPath)) !== skill.name) {
			console.warn(
				chalk.yellow(`[Skills] Skill name does not match directory: ${skillPath}`),
			)
		}

		discovered.set(skill.name, skill)
	}

	return [...discovered.values()]
}

// Skill 元数据仅在启动时扫描一次，完整内容由 load_skill 按需读取。
export const skills = discoverSkills()
const skillsByName = new Map(skills.map((skill) => [skill.name, skill]))

export function getSkill(name: string): Skill | undefined {
	return skillsByName.get(name)
}
