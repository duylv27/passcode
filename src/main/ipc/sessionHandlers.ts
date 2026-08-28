import type { Model } from '@earendil-works/pi-ai'
import type { RepoSession } from '../agent/piSession'
import type { SessionsRepository } from '../db/sessionsRepository'
import type { ReposRepository } from '../db/reposRepository'
import type { ChatEvent, SessionRecord } from '../../shared/types'

export type { ChatEvent }

export interface CreateSessionHandlersDeps {
  reposRepo: ReposRepository
  sessionsRepo: SessionsRepository
  openRepoSession: (
    cwd: string,
    requestApproval: (toolName: string, input: unknown) => Promise<boolean>,
    resumeSessionFile?: string
  ) => Promise<{ repoSession: RepoSession; sessionId: string; sessionFile: string | undefined }>
  onEvent: (sessionId: string, event: ChatEvent) => void
  requestApproval: (sessionId: string, toolName: string, input: unknown) => Promise<boolean>
  findModel: (provider: string, modelId: string) => Model<any> | undefined
}

export interface SessionHandlers {
  listSessions(repoId: string): SessionRecord[]
  createSession(repoId: string, title?: string): SessionRecord
  renameSession(sessionId: string, title: string): void
  deleteSession(sessionId: string): Promise<void>
  openSession(sessionId: string): Promise<void>
  sendPrompt(sessionId: string, text: string): Promise<void>
  abortSession(sessionId: string): Promise<void>
  setSessionModel(sessionId: string, provider: string, modelId: string): Promise<void>
}

export function createSessionHandlers(deps: CreateSessionHandlersDeps): SessionHandlers {
  const openSessions = new Map<string, RepoSession>()

  async function ensureSession(sessionId: string): Promise<RepoSession> {
    const existing = openSessions.get(sessionId)
    if (existing) return existing

    const record = deps.sessionsRepo.getById(sessionId)
    if (!record) throw new Error(`Unknown session: ${sessionId}`)

    const repo = deps.reposRepo.getById(record.repoId)
    if (!repo) throw new Error(`Unknown repo: ${record.repoId}`)

    const resumeSessionFile = deps.sessionsRepo.getSessionFile(sessionId)

    const {
      repoSession,
      sessionId: piSessionId,
      sessionFile
    } = await deps.openRepoSession(
      repo.path,
      (toolName, input) => deps.requestApproval(sessionId, toolName, input),
      resumeSessionFile
    )
    deps.sessionsRepo.setPiSessionId(sessionId, piSessionId)
    if (sessionFile) deps.sessionsRepo.setSessionFile(sessionId, sessionFile)

    repoSession.subscribe((event) => {
      const mapped = mapAgentEvent(event)
      if (mapped) deps.onEvent(sessionId, mapped)
    })

    const history = repoSession.getHistory()
    if (history.length > 0) deps.onEvent(sessionId, { type: 'history', items: history })

    const model = repoSession.getModel()
    if (model) deps.onEvent(sessionId, { type: 'model', provider: model.provider, id: model.id, name: model.name })

    openSessions.set(sessionId, repoSession)
    return repoSession
  }

  return {
    listSessions(repoId: string): SessionRecord[] {
      return deps.sessionsRepo.listByRepo(repoId)
    },
    createSession(repoId: string, title?: string): SessionRecord {
      // pi_session_id is populated once the session is actually opened for the
      // first time (createRepoSession returns the real Pi SDK session id then).
      return deps.sessionsRepo.create(repoId, '', title?.trim() || 'New session')
    },
    renameSession(sessionId: string, title: string): void {
      deps.sessionsRepo.rename(sessionId, title)
    },
    async deleteSession(sessionId: string): Promise<void> {
      const open = openSessions.get(sessionId)
      if (open) {
        openSessions.delete(sessionId)
        await open.abort()
      }
      deps.sessionsRepo.delete(sessionId)
    },
    async openSession(sessionId: string): Promise<void> {
      try {
        await ensureSession(sessionId)
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async sendPrompt(sessionId: string, text: string): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        await session.prompt(text)
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async abortSession(sessionId: string): Promise<void> {
      const open = openSessions.get(sessionId)
      if (open) await open.abort()
    },
    async setSessionModel(sessionId: string, provider: string, modelId: string): Promise<void> {
      const model = deps.findModel(provider, modelId)
      if (!model) {
        deps.onEvent(sessionId, { type: 'error', message: `Unknown model: ${provider}/${modelId}` })
        return
      }
      try {
        const session = await ensureSession(sessionId)
        await session.setModel(model)
        deps.onEvent(sessionId, { type: 'model', provider: model.provider, id: model.id, name: model.name })
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    }
  }
}

function mapAgentEvent(event: unknown): ChatEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolCallId?: string
    toolName?: string
    args?: unknown
    result?: unknown
    isError?: boolean
    message?: { role?: string; usage?: { input: number; output: number } }
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    return { type: 'text_delta', delta: e.assistantMessageEvent.delta ?? '' }
  }
  if (e.type === 'tool_execution_start') {
    return {
      type: 'tool_start',
      toolCallId: e.toolCallId ?? '',
      toolName: e.toolName ?? 'unknown',
      args: e.args
    }
  }
  if (e.type === 'tool_execution_end') {
    return {
      type: 'tool_end',
      toolCallId: e.toolCallId ?? '',
      toolName: e.toolName ?? 'unknown',
      isError: e.isError ?? false,
      result: e.result
    }
  }
  if (e.type === 'turn_end') {
    // The turn's assistant message carries real per-turn token usage from the
    // provider. Tool calls don't carry their own usage (they don't call an
    // LLM), so this is reported per-turn, not per-action.
    const usage =
      e.message?.role === 'assistant' && e.message.usage
        ? { input: e.message.usage.input, output: e.message.usage.output }
        : undefined
    return { type: 'turn_end', usage }
  }
  return null
}
