import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import {
  createSessionsRepository,
  type SessionsRepository
} from '../../../src/main/db/sessionsRepository'
import {
  createSessionHandlers,
  type ChatEvent,
  type SessionHandlers
} from '../../../src/main/ipc/sessionHandlers'
import type { RepoSession } from '../../../src/main/agent/piSession'
import type { HistoryItem } from '../../../src/shared/types'
import type { Model } from '@earendil-works/pi-ai'

describe('sessionHandlers', () => {
  let repoId: string
  let events: Array<{ sessionId: string; event: ChatEvent }>
  let promptMock: ReturnType<typeof vi.fn>
  let abortMock: ReturnType<typeof vi.fn>
  let setModelMock: ReturnType<typeof vi.fn>
  let historyItems: HistoryItem[]
  let currentModel: Model<any> | undefined
  let subscribeListener: ((event: unknown) => void) | undefined
  let handlers: SessionHandlers
  let sessionsRepo: SessionsRepository
  let openRepoSessionMock: ReturnType<typeof vi.fn>
  let findModelMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    sessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    events = []
    promptMock = vi.fn(async () => {})
    abortMock = vi.fn(async () => {})
    setModelMock = vi.fn(async (model: Model<any>) => {
      currentModel = model
    })
    historyItems = []
    currentModel = undefined
    subscribeListener = undefined
    const repoSession: RepoSession = {
      prompt: promptMock,
      subscribe: (listener) => {
        subscribeListener = listener
        return () => {}
      },
      abort: abortMock,
      getHistory: () => historyItems,
      getModel: () => currentModel,
      setModel: setModelMock
    }

    openRepoSessionMock = vi.fn(async () => ({
      repoSession,
      sessionId: 'pi-session-1',
      sessionFile: '/fake/session/file.jsonl'
    }))

    findModelMock = vi.fn(
      (provider: string, modelId: string) =>
        ({ provider, id: modelId, name: `${provider}/${modelId}` }) as Model<any>
    )

    handlers = createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: (id, event) => events.push({ sessionId: id, event }),
      requestApproval: async () => true,
      findModel: findModelMock
    })
  })

  it('creates a session for a repo with a default title', () => {
    const session = handlers.createSession(repoId)
    expect(session.title).toBe('New session')
    expect(session.repoId).toBe(repoId)
  })

  it('creates a session with a custom title', () => {
    const session = handlers.createSession(repoId, 'Fix login bug')
    expect(session.title).toBe('Fix login bug')
  })

  it('lists sessions for a repo', () => {
    const first = handlers.createSession(repoId, 'First')
    const second = handlers.createSession(repoId, 'Second')
    expect(handlers.listSessions(repoId).map((s) => s.id)).toEqual([first.id, second.id])
  })

  it('renames a session', () => {
    const session = handlers.createSession(repoId, 'Old')
    handlers.renameSession(session.id, 'New')
    expect(sessionsRepo.getById(session.id)?.title).toBe('New')
  })

  it('opens a session, persists the real Pi session id, and forwards prompt', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    await handlers.sendPrompt(session.id, 'hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
    expect(sessionsRepo.getById(session.id)?.piSessionId).toBe('pi-session-1')
  })

  it('maps and forwards a text_delta event, keyed by session id', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hi' }
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'text_delta', delta: 'Hi' }
    })
  })

  it('maps and forwards a thinking_delta event, keyed by session id', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: 'Checking the stack trace' }
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'thinking_delta', delta: 'Checking the stack trace' }
    })
  })

  it('maps a tool_execution_start event with its args', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'bash',
      args: { command: 'npm test' }
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: {
        type: 'tool_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'npm test' }
      }
    })
  })

  it('maps a tool_execution_end event including its result and isError', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'bash',
      result: 'tests passed',
      isError: true
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: {
        type: 'tool_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        isError: true,
        result: 'tests passed'
      }
    })
  })

  it('extracts token usage from an assistant turn_end event', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'turn_end',
      message: { role: 'assistant', usage: { input: 120, output: 45 } }
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'turn_end', usage: { input: 120, output: 45 } }
    })
  })

  it('reports turn_end with no usage when the message has none', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({ type: 'turn_end', message: { role: 'assistant' } })
    expect(events).toContainEqual({ sessionId: session.id, event: { type: 'turn_end', usage: undefined } })
  })

  it('reuses the same underlying repo session across two prompts to the same session', async () => {
    const session = handlers.createSession(repoId)
    await handlers.sendPrompt(session.id, 'first')
    await handlers.sendPrompt(session.id, 'second')
    expect(promptMock).toHaveBeenCalledTimes(2)
    expect(openRepoSessionMock).toHaveBeenCalledTimes(1)
  })

  it('opens independent underlying sessions for two different sessions on the same repo', async () => {
    const sessionA = handlers.createSession(repoId, 'A')
    const sessionB = handlers.createSession(repoId, 'B')
    await handlers.sendPrompt(sessionA.id, 'a')
    await handlers.sendPrompt(sessionB.id, 'b')
    expect(openRepoSessionMock).toHaveBeenCalledTimes(2)
  })

  it('reports an error via onEvent for an unknown session id instead of throwing', async () => {
    await handlers.openSession('missing')
    expect(events).toEqual([{ sessionId: 'missing', event: { type: 'error', message: 'Unknown session: missing' } }])
  })

  it('deletes a session, aborting its open repo session and removing the DB record', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    await handlers.deleteSession(session.id)
    expect(abortMock).toHaveBeenCalled()
    expect(sessionsRepo.getById(session.id)).toBeUndefined()
  })

  it('deletes a session that was never opened without error', async () => {
    const session = handlers.createSession(repoId)
    await handlers.deleteSession(session.id)
    expect(abortMock).not.toHaveBeenCalled()
    expect(sessionsRepo.getById(session.id)).toBeUndefined()
  })

  it('aborts an open session without deleting it', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    await handlers.abortSession(session.id)
    expect(abortMock).toHaveBeenCalled()
    expect(sessionsRepo.getById(session.id)).toBeDefined()
  })

  it('does nothing when aborting a session that was never opened', async () => {
    const session = handlers.createSession(repoId)
    await handlers.abortSession(session.id)
    expect(abortMock).not.toHaveBeenCalled()
  })

  it("passes a per-session requestApproval wrapper to openRepoSession", async () => {
    const requestApproval = vi.fn(async () => true)
    const localHandlers = createSessionHandlers({
      reposRepo: { getById: () => ({ id: repoId, projectId: 'p1', path: '/repo/path', name: 'demo-repo' }) } as never,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval,
      findModel: findModelMock
    })

    const session = localHandlers.createSession(repoId)
    await localHandlers.openSession(session.id)

    const [, approvalWrapper] = openRepoSessionMock.mock.calls[0]
    await approvalWrapper('bash', { command: 'ls' })
    expect(requestApproval).toHaveBeenCalledWith(session.id, 'bash', { command: 'ls' })
  })

  it('persists the real session file after opening, for future resume', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    expect(sessionsRepo.getSessionFile(session.id)).toBe('/fake/session/file.jsonl')
  })

  it('passes the saved session file as the resume target on a later open', async () => {
    const session = handlers.createSession(repoId)
    sessionsRepo.setSessionFile(session.id, '/saved/from/before.jsonl')

    await handlers.openSession(session.id)

    const [, , resumeSessionFile] = openRepoSessionMock.mock.calls[0]
    expect(resumeSessionFile).toBe('/saved/from/before.jsonl')
  })

  it('emits a history event when the resumed session has prior messages', async () => {
    historyItems = [{ kind: 'user', text: 'earlier message' }]
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'history', items: [{ kind: 'user', text: 'earlier message' }] }
    })
  })

  it('does not emit a history event for a brand-new session with no prior messages', async () => {
    historyItems = []
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events.some((e) => e.event.type === 'history')).toBe(false)
  })

  it('re-emits history on a second open of an already-open session, so switching back to it repopulates the transcript', async () => {
    historyItems = [{ kind: 'user', text: 'earlier message' }]
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)
    events.length = 0
    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'history', items: [{ kind: 'user', text: 'earlier message' }] }
    })
    expect(openRepoSessionMock).toHaveBeenCalledTimes(1)
  })

  it('emits a model event on open when the resumed session already has a model', async () => {
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as Model<any>
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'model', provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }
    })
  })

  it('does not emit a model event on open when no model has been selected yet', async () => {
    currentModel = undefined
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events.some((e) => e.event.type === 'model')).toBe(false)
  })

  it('sets the model on the underlying session and emits a model event', async () => {
    const session = handlers.createSession(repoId)

    await handlers.setSessionModel(session.id, 'openai', 'gpt-5')

    expect(findModelMock).toHaveBeenCalledWith('openai', 'gpt-5')
    expect(setModelMock).toHaveBeenCalledWith({ provider: 'openai', id: 'gpt-5', name: 'openai/gpt-5' })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'model', provider: 'openai', id: 'gpt-5', name: 'openai/gpt-5' }
    })
  })

  it('reports an error via onEvent when setting an unknown model', async () => {
    findModelMock.mockReturnValueOnce(undefined)
    const session = handlers.createSession(repoId)

    await handlers.setSessionModel(session.id, 'bogus', 'nope')

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'error', message: 'Unknown model: bogus/nope' }
    })
    expect(setModelMock).not.toHaveBeenCalled()
  })
})
