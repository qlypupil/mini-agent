import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const sourceRoot = resolve('src/agent/skills')
const destinationRoot = resolve('dist/agent/skills')

function copySkillFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const sourcePath = join(directory, entry.name)
		if (entry.isDirectory()) {
			copySkillFiles(sourcePath)
		} else if (entry.isFile() && entry.name === 'SKILL.md') {
			const destinationPath = join(destinationRoot, relative(sourceRoot, sourcePath))
			mkdirSync(dirname(destinationPath), { recursive: true })
			copyFileSync(sourcePath, destinationPath)
		}
	}
}

if (existsSync(sourceRoot)) {
	copySkillFiles(sourceRoot)
}

// npm link 的 bin 是指向此文件的软链接，构建后必须恢复可执行权限。
chmodSync(resolve('dist/agent/cli.js'), 0o755)
