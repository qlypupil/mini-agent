import { readFileSync } from 'node:fs'
import { getSkill } from '../skills'

export function loadSkillTool(name: string): string {
	const skill = getSkill(name)
	if (!skill) {
		return `Error: Unknown skill: ${name}`
	}

	try {
		console.log(`[Skill] ${skill.name} loaded.`)
		return readFileSync(skill.path, 'utf8')
	} catch (error) {
		return `Error: Unable to load skill ${name}: ${(error as Error).message}`
	}
}
