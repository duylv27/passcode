import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository } from '../../../src/main/db/sessionsRepository'
import {
  createSessionHandlers,
  type ChatEvent,
  type SessionHandlers
} from '../../../src/main/ipc/sessionHandlers'
import type { RepoSession } from '../../../src/main/agent/piSession'

describe('sessionHandlers', () => {
  let repoId: string
  let events: Array<{ repoId: string; event: ChatEvent }>
  let promptMock: ReturnType<typeof vi.fn>
  let subscribeListener: ((event: unknown) => void) | undefined
  let handlers: SessionHandlers

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const sessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    events = []
    promptMock = vi.fn(async () => {})
    subscribeListener = undefined
    const repoSession: RepoSession = {
      prompt: promptMock,
      subscribe: (listener) => {
        subscribeListener = listener
        return () => {}
      },
      abort: vi.fn(async () => {})
    }

    handlers = createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: async () => ({ repoSession, sessionId: 'pi-session-1' }),
      onEvent: (id, event) => events.push({ repoId: id, event })
    })
  })

  it('opens a session, persists it, and forwards prompt', async () => {
    await handlers.openSession(repoId)
    await handlers.sendPrompt(repoId, 'hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
  })

  it('maps and forwards a text_delta event to onEvent', async () => {
    await handlers.openSession(repoId)
    subscribeListener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hi' }
    })
    expect(events).toContainEqual({ repoId, event: { type: 'text_delta', delta: 'Hi' } })
  })

  it('reuses the same session on a second prompt rather than recreating it', async () => {
    await handlers.sendPrompt(repoId, 'first')
    await handlers.sendPrompt(repoId, 'second')
    expect(promptMock).toHaveBeenCalledTimes(2)
  })
})
