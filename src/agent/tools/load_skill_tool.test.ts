import { loadSkillTool } from './load_skill_tool'

describe('loadSkillTool', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('loads the complete SKILL.md and prints the skill name', () => {
		const log = jest.spyOn(console, 'log').mockImplementation()

		const content = loadSkillTool('planner')

		expect(content).toContain('name: planner')
		expect(content).toContain('# Planner')
		expect(log).toHaveBeenCalledWith('[Skill] planner loaded.')
	})

	it('rejects unknown skills', () => {
		expect(loadSkillTool('unknown-skill')).toBe('Error: Unknown skill: unknown-skill')
	})
})
