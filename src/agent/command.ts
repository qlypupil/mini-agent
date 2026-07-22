import { Command } from 'commander'

// CLI 的版本与描述始终跟随 package.json，避免在命令代码中重复维护元信息。
const packageMetadata = require('../../package.json') as {
	version: string
	description: string
}

export function createProgram(runChat: () => Promise<void>): Command {
	// 默认 action 保持无参数运行 termclaw 时直接进入交互聊天。
	return new Command()
		.name('termclaw')
		.description(packageMetadata.description)
		.version(packageMetadata.version)
		.action(runChat)
}
