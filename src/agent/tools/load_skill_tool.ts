import { readFileSync } from 'node:fs'
import { getSkill } from '../skills'

export function loadSkillTool(name: string): string {
	const skill = getSkill(name)
	if (!skill) {
		throw new Error(`Unknown skill: ${name}`)
	}

	try {
		return readFileSync(skill.path, 'utf8')
	} catch (error) {
		throw new Error(`Unable to load skill ${name}: ${(error as Error).message}`)
	}
}
