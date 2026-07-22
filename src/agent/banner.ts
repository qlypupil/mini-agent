import chalk from 'chalk'
import boxen from 'boxen'
import figlet from 'figlet'

type PackageMetadata = {
	name: string
	version: string
	description: string
	author?: string
	docs?: string
	homepage?: string
}

const packageMetadata = require('../../package.json') as PackageMetadata

function formatField(label: string, value: string): string {
	return `${chalk.cyan.bold(label.padEnd(12))}${value}`
}

/** 启动时打印品牌标题、包信息框与快捷键说明。 */
export function printStartupBanner(): void {
	const title = figlet.textSync(packageMetadata.name, {
		font: 'Standard',
		horizontalLayout: 'default',
	})
	console.log(chalk.cyan.bold(title))

	const docs = packageMetadata.docs || packageMetadata.homepage || '—'
	const author = packageMetadata.author?.trim() || '—'
	const info = [
		formatField('Version', packageMetadata.version),
		formatField('Description', packageMetadata.description),
		formatField('Author', author),
		formatField('Docs', docs),
	].join('\n')

	console.log(
		boxen(info, {
			padding: 1,
			margin: { top: 0, bottom: 1, left: 0, right: 0 },
			borderStyle: 'round',
			borderColor: 'cyan',
		}),
	)

	console.log(chalk.dim('使用说明'))
	console.log(chalk.dim('  ESC    取消当前 AI 请求'))
	console.log(chalk.dim('  exit   退出聊天'))
	console.log()
}
