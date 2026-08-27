import type { RepoSession } from '../agent/piSession'
import type { SessionsRepository } from '../db/sessionsRepository'
import type { ReposRepository } from '../db/reposRepository'
import type { ChatEvent } from '../../shared/types'

export type { ChatEvent }

export interface CreateSessionHandlersDeps {
  reposRepo: ReposRepository
  sessionsRepo: SessionsRepository
  openRepoSession: (repoId: string, cwd: string) => Promise<{ repoSession: RepoSession; sessionId: string }>
  onEvent: (repoId: string, event: ChatEvent) => void
}

export interface SessionHandlers {
  openSession(repoId: string): Promise<void>
  sendPrompt(repoId: string, text: string): Promise<void>
}

export function createSessionHandlers(deps: CreateSessionHandlersDeps): SessionHandlers {
  const openSessions = new Map<string, RepoSession>()

  async function ensureSession(repoId: string): Promise<RepoSession> {
    const existing = openSessions.get(repoId)
    if (existing) return existing

    const repo = deps.reposRepo.getById(repoId)
    if (!repo) throw new Error(`Unknown repo: ${repoId}`)

    const { repoSession, sessionId } = await deps.openRepoSession(repoId, repo.path)

    if (!deps.sessionsRepo.getByRepoId(repoId)) {
      deps.sessionsRepo.create(repoId, sessionId, repo.name)
    }

    repoSession.subscribe((event) => {
      const mapped = mapAgentEvent(event)
      if (mapped) deps.onEvent(repoId, mapped)
    })

    openSessions.set(repoId, repoSession)
    return repoSession
  }

  return {
    async openSession(repoId: string): Promise<void> {
      await ensureSession(repoId)
    },
    async sendPrompt(repoId: string, text: string): Promise<void> {
      const session = await ensureSession(repoId)
      try {
        await session.prompt(text)
      } catch (err) {
        deps.onEvent(repoId, { type: 'error', message: (err as Error).message })
      }
    }
  }
}

function mapAgentEvent(event: unknown): ChatEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolName?: string
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    return { type: 'text_delta', delta: e.assistantMessageEvent.delta ?? '' }
  }
  if (e.type === 'tool_execution_start') {
    return { type: 'tool_start', toolName: e.toolName ?? 'unknown' }
  }
  if (e.type === 'tool_execution_end') {
    return { type: 'tool_end', toolName: e.toolName ?? 'unknown' }
  }
  if (e.type === 'turn_end') {
    return { type: 'turn_end' }
  }
  return null
}
