import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository, type SessionsRepository } from '../../../src/main/db/sessionsRepository'

describe('SessionsRepository', () => {
  let sessions: SessionsRepository
  let repoId: string
  let dbRef: Database

  beforeEach(() => {
    const db = new Database(':memory:')
    dbRef = db
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

  it('lists sessions from every repo, most-recently-opened first', () => {
    const first = sessions.create(repoId, 'pi-1', 'First')
    const second = sessions.create(repoId, 'pi-2', 'Second')
    const third = sessions.create(repoId, 'pi-3', 'Third')
    sessions.touchOpened(first.id)

    const all = sessions.listAll()

    expect(all.map((s) => s.id)).toEqual([first.id, third.id, second.id])
  })

  it('includes sessions from every repo across every project', () => {
    const projectId2 = createProjectsRepository(dbRef).create('Second project').id
    const repoId2 = createReposRepository(dbRef).create(projectId2, '/path/b', 'repo-b').id
    const otherRepoSession = sessions.create(repoId2, 'pi-x', 'Other repo session')
    const sameRepoSession = sessions.create(repoId, 'pi-y', 'Same repo session')

    const ids = sessions.listAll().map((s) => s.id)

    expect(ids).toContain(otherRepoSession.id)
    expect(ids).toContain(sameRepoSession.id)
  })

  it('returns an empty list when there are no sessions', () => {
    expect(sessions.listAll()).toEqual([])
  })
})
