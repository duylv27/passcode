import { randomUUID } from 'node:crypto'
import type { AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent'

export interface RepoSession {
  prompt(text: string): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
}

export interface CreateRepoSessionOptions {
  cwd: string
  modelRuntime: ModelRuntime
}

const AGENT_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export async function createRepoSession(
  options: CreateRepoSessionOptions
): Promise<{ repoSession: RepoSession; sessionId: string }> {
  const { createAgentSession } = await import('@earendil-works/pi-coding-agent')
  const { session } = await createAgentSession({
    cwd: options.cwd,
    modelRuntime: options.modelRuntime,
    tools: [...AGENT_TOOLS]
  })

  return {
    sessionId: randomUUID(),
    repoSession: {
      prompt: (text: string) => session.prompt(text),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort()
    }
  }
}
