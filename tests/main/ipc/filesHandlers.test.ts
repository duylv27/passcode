import { describe, it, expect, vi } from 'vitest'
import { createFilesHandlers } from '../../../src/main/ipc/filesHandlers'

describe('filesHandlers', () => {
  it('returns the first selected path when a file is picked', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/repo/notes.txt', '/repo/other.txt'] }))
    const handlers = createFilesHandlers({ showOpenDialog })

    expect(await handlers.pickFile()).toBe('/repo/notes.txt')
  })

  it('returns null when the dialog is canceled', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }))
    const handlers = createFilesHandlers({ showOpenDialog })

    expect(await handlers.pickFile()).toBeNull()
  })

  it('returns null when no path is returned even though not canceled', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [] }))
    const handlers = createFilesHandlers({ showOpenDialog })

    expect(await handlers.pickFile()).toBeNull()
  })
})
