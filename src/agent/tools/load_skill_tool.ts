import { readFileSync } from 'node:fs'
import chalk from 'chalk'
import { getSkill } from '../skills'

export function loadSkillTool(name: string): string {
	const skill = getSkill(name)
	if (!skill) {
		return `Error: Unknown skill: ${name}`
	}

	try {
		console.log(chalk.magenta.dim(`[Skill] ${skill.name} loaded.`))
		return readFileSync(skill.path, 'utf8')
	} catch (error) {
		return `Error: Unable to load skill ${name}: ${(error as Error).message}`
	}
}
