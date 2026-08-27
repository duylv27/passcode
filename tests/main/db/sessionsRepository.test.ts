import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository, type SessionsRepository } from '../../../src/main/db/sessionsRepository'

describe('SessionsRepository', () => {
  let sessions: SessionsRepository
  let repoId: string

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = createReposRepository(db).create(projectId, '/path/a', 'a').id
    sessions = createSessionsRepository(db)
  })

  it('creates a session and finds it by repo id', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'a')
    expect(sessions.getByRepoId(repoId)?.id).toBe(created.id)
  })

  it('returns undefined when no session exists for a repo', () => {
    expect(sessions.getByRepoId('missing')).toBeUndefined()
  })

  it('returns the most recently created session for a repo', () => {
    sessions.create(repoId, 'pi-session-1', 'a')
    const second = sessions.create(repoId, 'pi-session-2', 'a')
    expect(sessions.getByRepoId(repoId)?.id).toBe(second.id)
  })

  it('deletes a session', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'a')
    sessions.delete(created.id)
    expect(sessions.getByRepoId(repoId)).toBeUndefined()
  })
})
