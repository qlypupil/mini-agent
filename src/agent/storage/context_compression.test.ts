import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextCompressionStore } from './context_compression'

describe('ContextCompressionStore', () => {
	it('persists compression state independently for each thread', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'termclaw-context-compression-'))
		const firstStore = new ContextCompressionStore(directory)
		const compression = {
			summary: 'saved summary',
			compressedMessageIds: ['message-1', 'message-2'],
			compressionCount: 3,
			updatedAt: '2026-07-29T00:00:00.000Z',
		}

		await firstStore.set('thread-1', compression)
		const restored = await new ContextCompressionStore(directory).get('thread-1')

		expect(restored).toEqual(compression)
		expect(await firstStore.get('thread-2')).toBeUndefined()
	})

	it('clears one thread without affecting another thread', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'termclaw-context-compression-'))
		const store = new ContextCompressionStore(directory)
		const compression = {
			summary: 'saved summary',
			compressedMessageIds: ['message-1'],
			compressionCount: 1,
			updatedAt: '2026-07-29T00:00:00.000Z',
		}
		await store.set('thread-1', compression)
		await store.set('thread-2', compression)

		await store.clear('thread-1')

		expect(await store.get('thread-1')).toBeUndefined()
		expect(await store.get('thread-2')).toEqual(compression)
	})

	it('ignores malformed cache data so chat history remains usable', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'termclaw-context-compression-'))
		const store = new ContextCompressionStore(directory)
		await store.set('thread-1', {
			summary: 'saved summary',
			compressedMessageIds: ['message-1'],
			compressionCount: 1,
			updatedAt: '2026-07-29T00:00:00.000Z',
		})
		const [cacheFile] = readdirSync(directory)
		writeFileSync(join(directory, cacheFile), '{invalid', 'utf8')

		await expect(store.get('thread-1')).resolves.toBeUndefined()
	})
})
