import { resolve } from 'node:path'
import { isInProjectDir } from './util'

describe('isInProjectDir', () => {
	const projectDir = resolve('/tmp/termclaw-project')

	it('accepts the project root and its descendants', () => {
		expect(isInProjectDir(projectDir, projectDir)).toBe(true)
		expect(isInProjectDir(resolve(projectDir, 'src/index.ts'), projectDir)).toBe(
			true,
		)
	})

	it('rejects parent and similarly prefixed sibling paths', () => {
		expect(isInProjectDir(resolve(projectDir, '..'), projectDir)).toBe(false)
		expect(
			isInProjectDir(resolve(`${projectDir}-other`, 'file.txt'), projectDir),
		).toBe(false)
	})
})
