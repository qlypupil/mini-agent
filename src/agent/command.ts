import { Command } from 'commander'

const packageMetadata = require('../../package.json') as {
	version: string
	description: string
}

export function createProgram(runChat: () => Promise<void>): Command {
	return new Command()
		.name('miniagent')
		.description(packageMetadata.description)
		.version(packageMetadata.version)
		.action(runChat)
}
