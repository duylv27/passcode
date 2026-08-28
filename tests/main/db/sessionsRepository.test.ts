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

  it('creates a session and finds it by id', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'First session')
    expect(sessions.getById(created.id)).toEqual(created)
  })

  it('returns undefined for an unknown session id', () => {
    expect(sessions.getById('missing')).toBeUndefined()
  })

  it('lists all sessions for a repo, in creation order', () => {
    const first = sessions.create(repoId, 'pi-session-1', 'First')
    const second = sessions.create(repoId, 'pi-session-2', 'Second')
    expect(sessions.listByRepo(repoId).map((s) => s.id)).toEqual([first.id, second.id])
  })

  it('returns an empty list for a repo with no sessions', () => {
    expect(sessions.listByRepo('missing')).toEqual([])
  })

  it('renames a session', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'Old title')
    sessions.rename(created.id, 'New title')
    expect(sessions.getById(created.id)?.title).toBe('New title')
  })

  it('records the real Pi session id once a session is opened', () => {
    const created = sessions.create(repoId, '', 'New session')
    sessions.setPiSessionId(created.id, 'pi-session-real-id')
    expect(sessions.getById(created.id)?.piSessionId).toBe('pi-session-real-id')
  })

  it('returns undefined for the session file of a session that has never been opened', () => {
    const created = sessions.create(repoId, '', 'New session')
    expect(sessions.getSessionFile(created.id)).toBeUndefined()
  })

  it('persists and retrieves the session file once a session has been opened', () => {
    const created = sessions.create(repoId, '', 'New session')
    sessions.setSessionFile(created.id, '/home/user/.pi/agent/sessions/abc/def.jsonl')
    expect(sessions.getSessionFile(created.id)).toBe('/home/user/.pi/agent/sessions/abc/def.jsonl')
  })

  it('deletes a session', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'a')
    sessions.delete(created.id)
    expect(sessions.getById(created.id)).toBeUndefined()
  })
})
