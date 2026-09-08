import type { AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ImageContent, Model } from '@earendil-works/pi-ai'
import type { CompactionThresholds, ContextUsage, HistoryItem, TokenUsage } from '../../shared/types'
import { getAdditionalSkillPaths } from './skills'
import { PROMPT_CONTEXT_DELIMITER } from './promptBuilder'

export interface RepoSession {
  prompt(text: string, images?: ImageContent[]): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
  /** The conversation loaded so far -- empty for a brand-new session, populated when resumed. */
  getHistory(): HistoryItem[]
  getModel(): Model<any> | undefined
  setModel(model: Model<any>): Promise<void>
  getContextUsage(): ContextUsage | undefined
  /** Result discarded -- the caller learns completion via the
   * 'compaction_status' event forwarded from the same subscription,
   * not this call's own resolution. */
  compact(): Promise<void>
  getAutoCompactionEnabled(): boolean
  setAutoCompactionEnabled(enabled: boolean): void
  getCompactionThresholds(): CompactionThresholds
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
      // "steer" interrupts an in-flight turn with this message rather than
      // requiring the caller to wait or queue -- streamingBehavior is only
      // consulted when a turn is actually in flight, so this is a no-op
      // otherwise and safe to always pass.
      prompt: (text: string, images?: ImageContent[]) =>
        session.prompt(text, { images, streamingBehavior: 'steer' }),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort(),
      getHistory: () => buildHistory(session.agent.state.messages),
      getModel: () => session.model,
      setModel: (model: Model<any>) => session.setModel(model),
      getContextUsage: () => session.getContextUsage(),
      compact: async () => {
        await session.compact()
      },
      getAutoCompactionEnabled: () => session.autoCompactionEnabled,
      setAutoCompactionEnabled: (enabled: boolean) => session.setAutoCompactionEnabled(enabled),
      getCompactionThresholds: () => ({
        reserveTokens: session.settingsManager.getCompactionReserveTokens(),
        keepRecentTokens: session.settingsManager.getCompactionKeepRecentTokens()
      })
    }
  }
}

function buildHistory(messages: readonly unknown[]): HistoryItem[] {
  const items: HistoryItem[] = []

  for (const raw of messages) {
    const message = raw as {
      role?: string
      content?: unknown
      toolCallId?: string
      isError?: boolean
      usage?: TokenUsage
    }

    if (message.role === 'user') {
      // Everything after the delimiter is context injected for the model
      // (a skill's instructions, an attached file's content) -- the
      // transcript only ever shows the short label ahead of it.
      const text = extractText(message.content).split(PROMPT_CONTEXT_DELIMITER)[0]
      const images = extractImages(message.content)
      if (text || images.length > 0) items.push({ kind: 'user', text, ...(images.length > 0 ? { images } : {}) })
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
            input: part.arguments,
            usage: message.usage
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

function extractImages(content: unknown): { data: string; mimeType: string }[] {
  if (!Array.isArray(content)) return []
  return content
    .filter(
      (part): part is { type: string; data: string; mimeType: string } =>
        (part as { type?: string })?.type === 'image'
    )
    .map((part) => ({ data: part.data, mimeType: part.mimeType }))
}
