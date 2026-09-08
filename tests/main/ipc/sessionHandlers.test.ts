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

const appendUsageTelemetryRecordMock = vi.fn()

vi.mock('../../../src/main/agent/usageTelemetry', () => ({
  appendUsageTelemetryRecord: appendUsageTelemetryRecordMock
}))

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
  let compactMock: ReturnType<typeof vi.fn>
  let getAutoCompactionEnabledMock: ReturnType<typeof vi.fn>
  let setAutoCompactionEnabledMock: ReturnType<typeof vi.fn>
  let getCompactionThresholdsMock: ReturnType<typeof vi.fn>
  let contextUsage: import('../../../src/shared/types').ContextUsage | undefined

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
    compactMock = vi.fn(async () => {})
    getAutoCompactionEnabledMock = vi.fn(() => false)
    setAutoCompactionEnabledMock = vi.fn()
    getCompactionThresholdsMock = vi.fn(() => ({ reserveTokens: 16384, keepRecentTokens: 20000 }))
    contextUsage = undefined
    const repoSession: RepoSession = {
      prompt: promptMock,
      subscribe: (listener) => {
        subscribeListener = listener
        return () => {}
      },
      abort: abortMock,
      getHistory: () => historyItems,
      getModel: () => currentModel,
      setModel: setModelMock,
      getContextUsage: () => contextUsage,
      compact: compactMock,
      getAutoCompactionEnabled: getAutoCompactionEnabledMock,
      setAutoCompactionEnabled: setAutoCompactionEnabledMock,
      getCompactionThresholds: getCompactionThresholdsMock
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
      findModel: findModelMock,
      buildPromptText: async (text) => text
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

  it('builds the prompt text via buildPromptText, passing options through, and sends the built text', async () => {
    const buildPromptText = vi.fn(async (text: string) => `built:${text}`)
    const localHandlers = createSessionHandlers({
      reposRepo: { getById: () => ({ id: repoId, projectId: 'p1', path: '/repo/path', name: 'demo-repo' }) } as never,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText
    })
    const session = localHandlers.createSession(repoId)
    const options = { skillFilePath: '/skills/foo/SKILL.md', skillName: 'foo' }

    await localHandlers.sendPrompt(session.id, 'hello', options)

    expect(buildPromptText).toHaveBeenCalledWith('hello', options)
    expect(promptMock).toHaveBeenCalledWith('built:hello')
  })

  it('converts PromptOptions.images into SDK ImageContent and forwards them to the underlying session', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    const options = { images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] }

    await handlers.sendPrompt(session.id, 'what is this?', options)

    expect(promptMock).toHaveBeenCalledWith('what is this?', [
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    ])
  })

  it('calls the underlying session prompt with a single argument when there are no images', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.sendPrompt(session.id, 'hello')

    expect(promptMock).toHaveBeenCalledWith('hello')
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

  it('extracts plain text from a raw AgentToolResult on tool_execution_end', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'grep',
      result: { content: [{ type: 'text', text: 'src/a.ts:1\nsrc/b.ts:9' }], details: { truncation: undefined } },
      isError: false
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: {
        type: 'tool_end',
        toolCallId: 'call-1',
        toolName: 'grep',
        isError: false,
        result: 'src/a.ts:1\nsrc/b.ts:9'
      }
    })
  })

  it('maps and forwards a thinking_end event, keyed by session id', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    subscribeListener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_end' }
    })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'thinking_end' }
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

  it('emits a usage telemetry record when a model_usage event arrives, using the current model and configured telemetry settings', async () => {
    appendUsageTelemetryRecordMock.mockClear()
    const telemetryConfig = { enabled: true, outputPath: '/fake/usage.jsonl' }
    // reposRepo itself is local to the outer beforeEach and not in scope
    // here -- follow the same fake-inline-repo workaround the existing
    // "builds the prompt text..." test above already uses.
    const localHandlers = createSessionHandlers({
      reposRepo: { getById: () => ({ id: repoId, projectId: 'p1', path: '/repo/path', name: 'demo-repo' }) } as never,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text,
      getUsageTelemetryConfig: () => telemetryConfig
    })
    const session = localHandlers.createSession(repoId)
    await localHandlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never

    subscribeListener?.({
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 500, output: 42 } }
    })

    expect(appendUsageTelemetryRecordMock).toHaveBeenCalledWith(telemetryConfig, {
      model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
      usage: { input: 500, output: 42 },
      sessionId: 'pi-session-1'
    })
  })

  it('does not emit a usage telemetry record when getUsageTelemetryConfig is not provided', async () => {
    appendUsageTelemetryRecordMock.mockClear()
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never

    subscribeListener?.({
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 500, output: 42 } }
    })

    expect(appendUsageTelemetryRecordMock).not.toHaveBeenCalled()
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

  it('emits busy:true when a prompt starts and busy:false when it finishes', async () => {
    const session = handlers.createSession(repoId)
    await handlers.sendPrompt(session.id, 'hello')

    const busyEvents = events.filter((e) => e.sessionId === session.id && e.event.type === 'busy')
    expect(busyEvents).toEqual([
      { sessionId: session.id, event: { type: 'busy', busy: true } },
      { sessionId: session.id, event: { type: 'busy', busy: false } }
    ])
  })

  it('emits busy:false when a prompt errors, via the finally block', async () => {
    promptMock.mockImplementationOnce(async () => {
      throw new Error('boom')
    })
    const session = handlers.createSession(repoId)
    await handlers.sendPrompt(session.id, 'hello')

    const busyEvents = events.filter((e) => e.sessionId === session.id && e.event.type === 'busy')
    expect(busyEvents).toEqual([
      { sessionId: session.id, event: { type: 'busy', busy: true } },
      { sessionId: session.id, event: { type: 'busy', busy: false } }
    ])
  })

  it('emits busy:false when a session is aborted mid-prompt', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    await handlers.abortSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'busy', busy: false }
    })
  })

  it("passes a per-session requestApproval wrapper to openRepoSession", async () => {
    const requestApproval = vi.fn(async () => true)
    const localHandlers = createSessionHandlers({
      reposRepo: { getById: () => ({ id: repoId, projectId: 'p1', path: '/repo/path', name: 'demo-repo' }) } as never,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval,
      findModel: findModelMock,
      buildPromptText: async (text) => text
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

  it('listAllSessions resolves repo and project for every session, most-recently-opened first', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const localSessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo Project').id
    const localRepoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    const localHandlers = createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo: localSessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text
    })

    const repoScoped = localHandlers.createSession(localRepoId, 'Repo scoped')
    const projectResult = localHandlers.createProjectSession(projectId, 'Project scoped')
    if (!projectResult.ok) throw new Error('setup failed: ' + projectResult.error)

    const all = localHandlers.listAllSessions()

    expect(all).toHaveLength(2)
    const repoEntry = all.find((s) => s.session.id === repoScoped.id)
    expect(repoEntry?.repo.id).toBe(localRepoId)
    expect(repoEntry?.project).toBe(null)
    const projectEntry = all.find((s) => s.session.id === projectResult.session.id)
    expect(projectEntry?.repo.id).toBe(localRepoId)
    expect(projectEntry?.project?.id).toBe(projectId)
  })

  it('listAllSessions skips a session whose repo no longer exists', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const localSessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo Project').id
    const localRepoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    const localHandlers = createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo: localSessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text
    })

    localHandlers.createSession(localRepoId, 'Orphaned-to-be')
    reposRepo.delete(localRepoId)

    expect(localHandlers.listAllSessions()).toEqual([])
  })

  it('emits context_usage on session open when the underlying session reports usage', async () => {
    contextUsage = { tokens: 500, contextWindow: 200000, percent: 0.25 }
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'context_usage', usage: { tokens: 500, contextWindow: 200000, percent: 0.25 } }
    })
  })

  it('does not emit context_usage on session open when the underlying session reports no usage yet', async () => {
    contextUsage = undefined
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events.find((e) => e.event.type === 'context_usage')).toBeUndefined()
  })

  it('emits the current auto-compaction setting on session open', async () => {
    getAutoCompactionEnabledMock.mockReturnValue(true)
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'auto_compaction', enabled: true }
    })
  })

  it('emits the current auto-compaction setting on session open even when disabled', async () => {
    getAutoCompactionEnabledMock.mockReturnValue(false)
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'auto_compaction', enabled: false }
    })
  })

  it('maps compaction_start/compaction_end SDK events to compaction_status', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    subscribeListener?.({ type: 'compaction_start', reason: 'manual' })
    subscribeListener?.({ type: 'compaction_end', reason: 'manual', result: {}, aborted: false, willRetry: false })

    expect(events).toContainEqual({ sessionId: session.id, event: { type: 'compaction_status', status: 'start' } })
    expect(events).toContainEqual({ sessionId: session.id, event: { type: 'compaction_status', status: 'end' } })
  })

  it('does not re-emit context_usage after compaction_start, only after compaction_end', async () => {
    contextUsage = { tokens: 100, contextWindow: 200000, percent: 0.05 }
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    subscribeListener?.({ type: 'compaction_start', reason: 'manual' })

    // No context_usage event should exist yet -- only compaction_status:start.
    expect(events.filter((e) => e.event.type === 'context_usage')).toHaveLength(0)

    subscribeListener?.({ type: 'compaction_end', reason: 'manual', result: {}, aborted: false, willRetry: false })

    // Exactly one context_usage event should now exist, emitted after compaction_end.
    const usageEvents = events.filter((e) => e.event.type === 'context_usage')
    expect(usageEvents).toEqual([
      {
        sessionId: session.id,
        event: { type: 'context_usage', usage: { tokens: 100, contextWindow: 200000, percent: 0.05 } }
      }
    ])
  })

  it('re-emits context_usage after a turn ends', async () => {
    contextUsage = { tokens: 42, contextWindow: 200000, percent: 0.02 }
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    subscribeListener?.({ type: 'turn_end' })

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'context_usage', usage: { tokens: 42, contextWindow: 200000, percent: 0.02 } }
    })
  })

  it('compacts a session via compactSession', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.compactSession(session.id)

    expect(compactMock).toHaveBeenCalled()
  })

  it('reports a compaction error via the error event rather than throwing', async () => {
    compactMock.mockRejectedValueOnce(new Error('compaction aborted'))
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.compactSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'error', message: 'compaction aborted' }
    })
  })

  it('reads and writes the auto-compaction setting', async () => {
    getAutoCompactionEnabledMock.mockReturnValue(true)
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    expect(await handlers.getAutoCompactionEnabled(session.id)).toBe(true)

    await handlers.setAutoCompactionEnabled(session.id, false)
    expect(setAutoCompactionEnabledMock).toHaveBeenCalledWith(false)
  })

  it('reads compaction thresholds', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    expect(await handlers.getCompactionThresholds(session.id)).toEqual({
      reserveTokens: 16384,
      keepRecentTokens: 20000
    })
  })
})
