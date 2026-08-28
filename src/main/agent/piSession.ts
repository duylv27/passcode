import type { AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai'
import type { HistoryItem } from '../../shared/types'
import { getAdditionalSkillPaths } from './skills'

export interface RepoSession {
  prompt(text: string): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
  /** The conversation loaded so far -- empty for a brand-new session, populated when resumed. */
  getHistory(): HistoryItem[]
  getModel(): Model<any> | undefined
  setModel(model: Model<any>): Promise<void>
}

export interface CreateRepoSessionOptions {
  cwd: string
  modelRuntime: ModelRuntime
  /**
   * Called before each tool executes; resolve true to let it run, false to
   * block it. The SDK's `tool_call` extension hook fires before execution
   * and can block -- this is what lets the app pause and ask the user.
   */
  requestApproval: (toolName: string, input: unknown) => Promise<boolean>
  /** Path to a previously saved session file to resume, if continuing past work. */
  resumeSessionFile?: string
}

const AGENT_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export async function createRepoSession(
  options: CreateRepoSessionOptions
): Promise<{ repoSession: RepoSession; sessionId: string; sessionFile: string | undefined }> {
  const { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } = await import(
    '@earendil-works/pi-coding-agent'
  )

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: getAdditionalSkillPaths(),
    extensionFactories: [
      (pi) => {
        pi.on('tool_call', async (event) => {
          const approved = await options.requestApproval(event.toolName, event.input)
          return approved ? { block: false } : { block: true, reason: 'Denied by user' }
        })
      }
    ]
  })

  const sessionManager = options.resumeSessionFile
    ? SessionManager.open(options.resumeSessionFile)
    : undefined

  const { session } = await createAgentSession({
    cwd: options.cwd,
    modelRuntime: options.modelRuntime,
    tools: [...AGENT_TOOLS],
    resourceLoader,
    ...(sessionManager ? { sessionManager } : {})
  })

  return {
    sessionId: session.sessionId,
    sessionFile: session.sessionManager.getSessionFile(),
    repoSession: {
      prompt: (text: string) => session.prompt(text),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort(),
      getHistory: () => buildHistory(session.agent.state.messages),
      getModel: () => session.model,
      setModel: (model: Model<any>) => session.setModel(model)
    }
  }
}

function buildHistory(messages: readonly unknown[]): HistoryItem[] {
  const items: HistoryItem[] = []

  for (const raw of messages) {
    const message = raw as { role?: string; content?: unknown; toolCallId?: string; isError?: boolean }

    if (message.role === 'user') {
      const text = extractText(message.content)
      if (text) items.push({ kind: 'user', text })
    } else if (message.role === 'assistant') {
      const parts = Array.isArray(message.content) ? message.content : []
      for (const raw2 of parts) {
        const part = raw2 as {
          type?: string
          text?: string
          thinking?: string
          id?: string
          name?: string
          arguments?: unknown
        }
        if (part.type === 'text' && part.text) {
          items.push({ kind: 'text', text: part.text })
        } else if (part.type === 'thinking' && part.thinking) {
          items.push({ kind: 'thinking', text: part.thinking })
        } else if (part.type === 'toolCall') {
          items.push({
            kind: 'tool',
            toolCallId: part.id ?? '',
            toolName: part.name ?? 'unknown',
            input: part.arguments
          })
        }
      }
    } else if (message.role === 'toolResult') {
      const target = items.find(
        (item): item is Extract<HistoryItem, { kind: 'tool' }> =>
          item.kind === 'tool' && item.toolCallId === message.toolCallId
      )
      if (target) {
        target.result = extractText(message.content) || message.content
        target.isError = message.isError
      }
    }
  }

  return items
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text: string } => (part as { type?: string })?.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  return ''
}
