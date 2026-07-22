import type { Skill } from '../skills'

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[
			character
		] as string
	})
}

export function buildSkillsInstruction(skills: Skill[]): string {
	if (skills.length === 0) {
		return ''
	}

	const catalog = skills
		.map(
			(skill) =>
				`  <skill><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description></skill>`,
		)
		.join('\n')

	return `The following skills provide specialized instructions. When a task matches a skill description, call load_skill with its exact name before responding.\n<available_skills>\n${catalog}\n</available_skills>`
}
