import { buildSkillsInstruction } from './prompt'

describe('buildSkillsInstruction', () => {
	it('includes every skill name and description in the model catalog', () => {
		const instruction = buildSkillsInstruction([
			{
				name: 'planner',
				description: 'Create task plans.',
				path: '/skills/planner/SKILL.md',
			},
			{
				name: 'programmer-resume',
				description: 'Write programmer resumes.',
				path: '/skills/programmer-resume/SKILL.md',
			},
		])

		expect(instruction).toContain('call load_skill with its exact name')
		expect(instruction).toContain('<name>planner</name>')
		expect(instruction).toContain('<description>Create task plans.</description>')
		expect(instruction).toContain('<name>programmer-resume</name>')
		expect(instruction).toContain('Write programmer resumes.')
	})

	it('omits the catalog when no skills are available', () => {
		expect(buildSkillsInstruction([])).toBe('')
	})
})
