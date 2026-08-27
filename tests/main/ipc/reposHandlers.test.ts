import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createReposHandlers, type ReposHandlers } from '../../../src/main/ipc/reposHandlers'

describe('reposHandlers', () => {
  let handlers: ReposHandlers
  let projectId: string
  let isGitRepoMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    projectId = createProjectsRepository(db).create('Demo').id
    isGitRepoMock = vi.fn(async () => true)
    handlers = createReposHandlers(createReposRepository(db), isGitRepoMock)
  })

  it('adds a repo when the path is a valid git repo', async () => {
    const result = await handlers.addRepo(projectId, '/tmp/my-repo')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repo.name).toBe('my-repo')
      expect(result.repo.projectId).toBe(projectId)
    }
    expect(handlers.listRepos(projectId)).toHaveLength(1)
  })

  it('rejects a path that is not a git repo', async () => {
    isGitRepoMock.mockResolvedValueOnce(false)
    const result = await handlers.addRepo(projectId, '/tmp/not-a-repo')
    expect(result.ok).toBe(false)
    expect(handlers.listRepos(projectId)).toHaveLength(0)
  })
})
