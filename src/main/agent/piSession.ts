import type { AgentSessionEvent, ExtensionUIContext, ModelRuntime, Theme } from '@earendil-works/pi-coding-agent'
import type { ImageContent, Model } from '@earendil-works/pi-ai'
import type {
  CompactionThresholds,
  ContextUsage,
  HistoryItem,
  SessionStats,
  ThinkingLevel,
  TokenUsage
} from '../../shared/types'
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
  /** Aggregates over the whole session, including compacted-away history --
   * distinct from getContextUsage()'s live snapshot of the current window. */
  getSessionStats(): SessionStats
  supportsThinking(): boolean
  /** Empty when !supportsThinking(). */
  getAvailableThinkingLevels(): ThinkingLevel[]
  getThinkingLevel(): ThinkingLevel
  setThinkingLevel(level: ThinkingLevel): void
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
  /** Backs ctx.ui.select() for any extension that asks the user to pick
   * from a list -- e.g. @juicesharp/rpiv-ask-user-question. Resolves
   * `undefined` if the user cancels/times out. Optional: falls back to a
   * safe no-op (matching the SDK's own noOpUIContext) when not supplied. */
  requestSelect?: (title: string, options: string[], timeoutMs?: number, signal?: AbortSignal) => Promise<string | undefined>
  /** Backs ctx.ui.confirm(). Resolves `false` if the user cancels/times out. */
  requestConfirm?: (title: string, message: string, timeoutMs?: number, signal?: AbortSignal) => Promise<boolean>
  /** Backs ctx.ui.input(). Resolves `undefined` if the user cancels/times out. */
  requestInput?: (
    title: string,
    placeholder: string | undefined,
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<string | undefined>
  /** Backs ctx.ui.notify(). */
  notify?: (message: string, level: 'info' | 'warning' | 'error') => void
  /** Path to a previously saved session file to resume, if continuing past work. */
  resumeSessionFile?: string
}

/** Matches the SDK's own `noOpUIContext` (see runner.js) property for
 * property -- every method here is a pure-terminal concept (raw component
 * rendering, footer/header/widget swapping, editor-component swapping,
 * theme get/set) with no sensible Electron/React equivalent for several
 * of them. An extension that needs one of these degrades exactly as it
 * already does in any other non-interactive host, rather than crashing --
 * only select/confirm/input/notify (see createRepoSession below) get a
 * real implementation. */
const noOpUiContext: Omit<ExtensionUIContext, 'select' | 'confirm' | 'input' | 'notify'> = {
  onTerminalInput: () => () => {},
  setStatus: () => {},
  setWorkingMessage: () => {},
  setWorkingVisible: () => {},
  setWorkingIndicator: () => {},
  setHiddenThinkingLabel: () => {},
  setWidget: () => {},
  setFooter: () => {},
  setHeader: () => {},
  setTitle: () => {},
  // Cast needed: `custom<T>()` is generic and genuinely returns `Promise<T>`
  // (not `Promise<T | undefined>`), so a real no-op can't satisfy it
  // honestly for every T -- this matches the SDK's own noOpUIContext in
  // runner.js, which has the same shape (untyped there since it's already
  // compiled JS).
  custom: (async () => undefined) as unknown as ExtensionUIContext['custom'],
  pasteToEditor: () => {},
  setEditorText: () => {},
  getEditorText: () => '',
  editor: async () => undefined,
  addAutocompleteProvider: () => {},
  setEditorComponent: () => {},
  getEditorComponent: () => undefined,
  get theme(): Theme {
    return {} as Theme
  },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: 'UI not available' }),
  getToolsExpanded: () => false,
  setToolsExpanded: () => {}
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
          // `terminate: true` tells the agent to stop after this tool batch
          // instead of continuing the turn and trying to route around the
          // denial with a different tool/approach -- a denial is a deliberate
          // stop signal from the user, not a retryable error.
          return approved ? { block: false } : { block: true, reason: 'Denied by user', terminate: true }
        })
      }
    ]
  })

  // createAgentSession() only calls resourceLoader.reload() itself when it
  // builds its own default loader -- passing a custom loader (needed here so
  // the inline tool_call/approval extension above is registered at all)
  // means WE'RE responsible for reloading it first, per the SDK's own
  // createAgentSession() usage example. Skipping this silently no-ops the
  // loader: extensions (including our approval gate), skills, and prompts
  // never actually populate, so every tool call runs completely unchecked
  // regardless of the configured approval policy.
  await resourceLoader.reload()

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

  // 'rpc' is the same mode non-terminal hosts (VS Code pendant, Zed) bind
  // with -- it's what makes a well-behaved extension prefer these simple
  // generic primitives over trying to build its own terminal-only overlay
  // via ctx.ui.custom(). Only select/confirm/input/notify get a real
  // implementation; everything else falls back to noOpUiContext above.
  const uiContext: ExtensionUIContext = {
    ...noOpUiContext,
    select: (title, choices, opts) =>
      choices.length === 0 || !options.requestSelect
        ? Promise.resolve(undefined)
        : options.requestSelect(title, choices, opts?.timeout, opts?.signal),
    confirm: (title, message, opts) =>
      options.requestConfirm ? options.requestConfirm(title, message, opts?.timeout, opts?.signal) : Promise.resolve(false),
    input: (title, placeholder, opts) =>
      options.requestInput ? options.requestInput(title, placeholder, opts?.timeout, opts?.signal) : Promise.resolve(undefined),
    notify: (message, level) => options.notify?.(message, level ?? 'info')
  }
  await session.bindExtensions({ uiContext, mode: 'rpc' })

  // createAgentSession()'s `tools: [...AGENT_TOOLS]` above restricts the
  // active set to exactly those built-ins -- silently excluding any tool an
  // extension registers via pi.registerTool() (e.g. a real
  // ask-user-question package's own tool), no matter how many extensions
  // load. Re-activate the fixed built-ins plus whatever extension tools
  // actually got registered, so installed extensions' tools are genuinely
  // callable instead of just existing in the registry unused.
  const extensionToolNames = session
    .getAllTools()
    .map((tool) => tool.name)
    .filter((name) => !(AGENT_TOOLS as readonly string[]).includes(name))
  if (extensionToolNames.length > 0) {
    session.setActiveToolsByName([...AGENT_TOOLS, ...extensionToolNames])
  }

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
      }),
      getSessionStats: () => session.getSessionStats(),
      supportsThinking: () => session.supportsThinking(),
      getAvailableThinkingLevels: () => session.getAvailableThinkingLevels(),
      getThinkingLevel: () => session.thinkingLevel,
      setThinkingLevel: (level: ThinkingLevel) => session.setThinkingLevel(level)
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
