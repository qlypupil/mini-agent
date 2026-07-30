import { loadSkillTool } from './load_skill_tool'

describe('loadSkillTool', () => {
	it('loads the complete SKILL.md', () => {
		const content = loadSkillTool('planner')

		expect(content).toContain('name: planner')
		expect(content).toContain('# Planner')
	})

	it('rejects unknown skills', () => {
		expect(() => loadSkillTool('unknown-skill')).toThrow(
			'Unknown skill: unknown-skill',
		)
	})
})
