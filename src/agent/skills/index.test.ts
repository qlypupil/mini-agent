import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSkills } from './index'

describe('discoverSkills', () => {
	it('discovers valid nested skills and skips malformed metadata', () => {
		const root = mkdtempSync(join(tmpdir(), 'miniagent-skills-'))
		const validDirectory = join(root, 'nested', 'valid-skill')
		const invalidDirectory = join(root, 'invalid-skill')
		mkdirSync(validDirectory, { recursive: true })
		mkdirSync(invalidDirectory)
		writeFileSync(
			join(validDirectory, 'SKILL.md'),
			'---\nname: valid-skill\ndescription: >\n  A valid skill\n  with multiple lines.\n---\n\n# Valid Skill\n',
		)
		writeFileSync(join(invalidDirectory, 'SKILL.md'), '---\nname: invalid-skill\n---\n')
		const warning = jest.spyOn(console, 'warn').mockImplementation()

		const skills = discoverSkills(root)

		expect(skills).toEqual([
			expect.objectContaining({
				name: 'valid-skill',
				description: 'A valid skill with multiple lines.\n',
			}),
		])
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('invalid-skill'),
		)
		warning.mockRestore()
	})
})
