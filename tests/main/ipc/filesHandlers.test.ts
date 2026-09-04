import { describe, it, expect, vi } from 'vitest'
import { createFilesHandlers } from '../../../src/main/ipc/filesHandlers'

function makeHandlers(overrides: { filePaths?: string[]; canceled?: boolean } = {}) {
  const showOpenDialog = vi.fn(async () => ({
    canceled: overrides.canceled ?? false,
    filePaths: overrides.filePaths ?? []
  }))
  const showOpenFolderDialog = vi.fn(async () => ({
    canceled: overrides.canceled ?? false,
    filePaths: overrides.filePaths ?? []
  }))
  return { handlers: createFilesHandlers({ showOpenDialog, showOpenFolderDialog }), showOpenDialog, showOpenFolderDialog }
}

describe('filesHandlers', () => {
  it('returns the first selected path when a file is picked', async () => {
    const { handlers } = makeHandlers({ filePaths: ['/repo/notes.txt', '/repo/other.txt'] })
    expect(await handlers.pickFile()).toBe('/repo/notes.txt')
  })

  it('returns null when the file dialog is canceled', async () => {
    const { handlers } = makeHandlers({ canceled: true })
    expect(await handlers.pickFile()).toBeNull()
  })

  it('returns null when no file path is returned even though not canceled', async () => {
    const { handlers } = makeHandlers({ filePaths: [] })
    expect(await handlers.pickFile()).toBeNull()
  })

  it('returns the first selected path when a folder is picked', async () => {
    const { handlers, showOpenFolderDialog } = makeHandlers({ filePaths: ['/repos/passcode-desktop'] })
    expect(await handlers.pickFolder()).toBe('/repos/passcode-desktop')
    expect(showOpenFolderDialog).toHaveBeenCalledTimes(1)
  })

  it('returns null when the folder dialog is canceled', async () => {
    const { handlers } = makeHandlers({ canceled: true })
    expect(await handlers.pickFolder()).toBeNull()
  })

  it('returns null when no folder path is returned even though not canceled', async () => {
    const { handlers } = makeHandlers({ filePaths: [] })
    expect(await handlers.pickFolder()).toBeNull()
  })

  it('does not call the folder dialog when picking a file', async () => {
    const { handlers, showOpenFolderDialog } = makeHandlers({ filePaths: ['/repo/notes.txt'] })
    await handlers.pickFile()
    expect(showOpenFolderDialog).not.toHaveBeenCalled()
  })
})
