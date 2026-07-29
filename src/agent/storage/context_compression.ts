import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { type ContextCompression } from '../runtime/context'

const CACHE_VERSION = 1

export const CONTEXT_COMPRESSION_CACHE_DIRECTORY = resolve(
	process.cwd(),
	'.data/context-compression',
)

interface StoredContextCompression extends ContextCompression {
	version: typeof CACHE_VERSION
}

function isStoredContextCompression(value: unknown): value is StoredContextCompression {
	if (typeof value !== 'object' || value === null) return false
	const candidate = value as Partial<StoredContextCompression>

	return (
		candidate.version === CACHE_VERSION &&
		typeof candidate.summary === 'string' &&
		candidate.summary.trim().length > 0 &&
		Array.isArray(candidate.compressedMessageIds) &&
		candidate.compressedMessageIds.every((id) => typeof id === 'string') &&
		typeof candidate.compressionCount === 'number' &&
		Number.isInteger(candidate.compressionCount) &&
		candidate.compressionCount >= 1 &&
		typeof candidate.updatedAt === 'string'
	)
}

function getCacheFileName(threadId: string): string {
	return `${createHash('sha256').update(threadId).digest('hex')}.json`
}

export class ContextCompressionStore {
	constructor(
		private readonly directory = CONTEXT_COMPRESSION_CACHE_DIRECTORY,
	) {}

	private getFilePath(threadId: string): string {
		return resolve(this.directory, getCacheFileName(threadId))
	}

	async get(threadId: string): Promise<ContextCompression | undefined> {
		try {
			const stored = JSON.parse(
				await readFile(this.getFilePath(threadId), 'utf8'),
			) as unknown
			if (!isStoredContextCompression(stored)) return undefined

			const { version: _version, ...compression } = stored
			return compression
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
			if (error instanceof SyntaxError) return undefined
			throw error
		}
	}

	async set(threadId: string, compression: ContextCompression): Promise<void> {
		await mkdir(this.directory, { recursive: true })
		const filePath = this.getFilePath(threadId)
		const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
		const stored: StoredContextCompression = {
			version: CACHE_VERSION,
			...compression,
		}

		try {
			await writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
			await rename(temporaryPath, filePath)
		} catch (error) {
			await unlink(temporaryPath).catch(() => {})
			throw error
		}
	}

	async clear(threadId: string): Promise<void> {
		try {
			await unlink(this.getFilePath(threadId))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		}
	}
}
