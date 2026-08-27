import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'

vi.mock('../../../src/main/git/gitStatus', () => ({
  getGitStatus: vi.fn(async () => ({ branch: 'main', changed: ['a.ts'], added: [], deleted: [] }))
}))

import { createGitHandlers } from '../../../src/main/ipc/gitHandlers'
import { getGitStatus } from '../../../src/main/git/gitStatus'

describe('gitHandlers', () => {
  let repoId: string
  let handlers: ReturnType<typeof createGitHandlers>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const reposRepo = createReposRepository(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo').id
    handlers = createGitHandlers(reposRepo)
  })

  it('returns git status for a known repo', async () => {
    const status = await handlers.status(repoId)
    expect(status.branch).toBe('main')
    expect(getGitStatus).toHaveBeenCalledWith('/repo/path')
  })

  it('throws for an unknown repo', async () => {
    await expect(handlers.status('missing')).rejects.toThrow('Unknown repo: missing')
  })
})
