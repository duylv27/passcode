import type { Model } from '@earendil-works/pi-ai'
import type { RepoSession } from '../agent/piSession'
import { appendUsageTelemetryRecord } from '../agent/usageTelemetry'
import type { SessionsRepository } from '../db/sessionsRepository'
import type { ReposRepository } from '../db/reposRepository'
import type { ProjectsRepository } from '../db/projectsRepository'
import type { BuildPromptTextOptions } from '../agent/promptBuilder'
import type {
  ChatEvent,
  CompactionThresholds,
  CreateProjectSessionError,
  CreateProjectSessionResult,
  Project,
  PromptOptions,
  Repo,
  SessionRecord,
  SessionStats,
  SessionWithScope,
  ThinkingInfo,
  ThinkingLevel,
  TokenUsage,
  UsageTelemetryConfig
} from '../../shared/types'

export type { ChatEvent }

export interface CreateSessionHandlersDeps {
  reposRepo: ReposRepository
  projectsRepo: ProjectsRepository
  sessionsRepo: SessionsRepository
  openRepoSession: (
    cwd: string,
    requestApproval: (toolName: string, input: unknown) => Promise<boolean>,
    uiPrompts: {
      requestSelect: (title: string, options: string[], timeoutMs?: number, signal?: AbortSignal) => Promise<string | undefined>
      requestConfirm: (title: string, message: string, timeoutMs?: number, signal?: AbortSignal) => Promise<boolean>
      requestInput: (
        title: string,
        placeholder: string | undefined,
        timeoutMs?: number,
        signal?: AbortSignal
      ) => Promise<string | undefined>
      notify: (message: string, level: 'info' | 'warning' | 'error') => void
    },
    resumeSessionFile?: string
  ) => Promise<{ repoSession: RepoSession; sessionId: string; sessionFile: string | undefined }>
  onEvent: (sessionId: string, event: ChatEvent) => void
  requestApproval: (sessionId: string, toolName: string, input: unknown) => Promise<boolean>
  requestSelect: (
    sessionId: string,
    title: string,
    options: string[],
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<string | undefined>
  requestConfirm: (
    sessionId: string,
    title: string,
    message: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<boolean>
  requestInput: (
    sessionId: string,
    title: string,
    placeholder: string | undefined,
    timeoutMs?: number,
    signal?: AbortSignal
  ) => Promise<string | undefined>
  findModel: (provider: string, modelId: string) => Model<any> | undefined
  buildPromptText: (text: string, options?: BuildPromptTextOptions) => Promise<string>
  /** Idempotently returns the hidden project+repo backing project-less
   * "general" sessions, creating them (and the repo's scratch directory on
   * disk) on first use. See appSettingsRepository.ts's GeneralRepoInfo. */
  ensureGeneralRepo: () => Promise<{ projectId: string; repoId: string }>
  /** Read fresh on every emitted usage record (not cached at session-open
   * time) so toggling the setting in a running app takes effect on the
   * very next inference call. Omitted entirely (rather than a default
   * config object) when the caller doesn't wire telemetry at all. */
  getUsageTelemetryConfig?: () => UsageTelemetryConfig
  /** Called once per real model call (same granularity as the usage
   * telemetry record above) so a Passport's totals reflect what's actually
   * been billed against it. Omitted entirely when the caller doesn't wire
   * Passport usage tracking at all. */
  recordPassportUsage?: (
    providerId: string,
    usage: { inputTokens: number; outputTokens: number; cost: number }
  ) => void
}

export interface SessionHandlers {
  listSessions(repoId: string): SessionRecord[]
  createSession(repoId: string, title?: string): SessionRecord
  listProjectSessions(projectId: string): SessionRecord[]
  createProjectSession(projectId: string, title?: string): CreateProjectSessionResult | CreateProjectSessionError
  createGeneralSession(title?: string): Promise<CreateProjectSessionResult | CreateProjectSessionError>
  setBookmarked(sessionId: string, bookmarked: boolean): void
  listAllSessions(): SessionWithScope[]
  renameSession(sessionId: string, title: string): void
  deleteSession(sessionId: string): Promise<void>
  openSession(sessionId: string): Promise<void>
  sendPrompt(sessionId: string, text: string, options?: PromptOptions): Promise<void>
  abortSession(sessionId: string): Promise<void>
  setSessionModel(sessionId: string, provider: string, modelId: string): Promise<void>
  compactSession(sessionId: string): Promise<void>
  getAutoCompactionEnabled(sessionId: string): Promise<boolean>
  setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void>
  getCompactionThresholds(sessionId: string): Promise<CompactionThresholds>
  setContextWindowOverride(sessionId: string, contextWindow: number | null): Promise<void>
  getSessionStats(sessionId: string): Promise<SessionStats>
  getThinkingInfo(sessionId: string): Promise<ThinkingInfo>
  setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void>
}

export function createSessionHandlers(deps: CreateSessionHandlersDeps): SessionHandlers {
  const openSessions = new Map<string, RepoSession>()
  // Sessions with a prompt currently in flight -- purely server-side state
  // the renderer has no other way to learn, since it clears its own busy
  // flag on every session switch/reopen.
  const busySessions = new Set<string>()

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
      async (toolName, input) => {
        const approved = await deps.requestApproval(sessionId, toolName, input)
        // Denying a tool call is a deliberate stop, not a silent no-op -- the
        // SDK's `terminate: true` hint (see piSession.ts's tool_call handler)
        // ends the turn, but says nothing on its own; without this, a user
        // who clicks Skip has no visible confirmation anything happened
        // beyond the composer going idle. 'tool_denied' (not 'error') so the
        // UI renders a quiet notice, not an alarming red error paragraph --
        // the user made a deliberate choice, nothing actually broke.
        if (!approved) {
          deps.onEvent(sessionId, { type: 'tool_denied', toolName, input })
        }
        return approved
      },
      {
        requestSelect: (title, options, timeoutMs, signal) =>
          deps.requestSelect(sessionId, title, options, timeoutMs, signal),
        requestConfirm: (title, message, timeoutMs, signal) =>
          deps.requestConfirm(sessionId, title, message, timeoutMs, signal),
        requestInput: (title, placeholder, timeoutMs, signal) =>
          deps.requestInput(sessionId, title, placeholder, timeoutMs, signal),
        notify: (message, level) => deps.onEvent(sessionId, { type: 'ui_notify', message, level })
      },
      resumeSessionFile
    )
    deps.sessionsRepo.setPiSessionId(sessionId, piSessionId)
    if (sessionFile) deps.sessionsRepo.setSessionFile(sessionId, sessionFile)

    let pendingActionUsage: TokenUsage | undefined
    repoSession.subscribe((event) => {
      const mapped = mapAgentEvent(event)
      if (!mapped) return
      // mapAgentEvent normally maps one SDK event to one ChatEvent, but a
      // failed compaction (compaction_end with errorMessage) needs to
      // surface both the terminal compaction_status (so the renderer clears
      // its "Compacting..." state) and a distinct error event -- so it may
      // return several ChatEvents for a single SDK event.
      const mappedEvents = Array.isArray(mapped) ? mapped : [mapped]
      for (const item of mappedEvents) {
        if (item.type === 'model_usage') {
          pendingActionUsage = item.usage
          if (deps.getUsageTelemetryConfig) {
            const model = repoSession.getModel()
            if (model) {
              appendUsageTelemetryRecord(deps.getUsageTelemetryConfig(), {
                model: { provider: model.provider, id: model.id, name: model.name },
                usage: item.usage,
                sessionId: piSessionId
              })
            }
          }
          if (deps.recordPassportUsage) {
            const model = repoSession.getModel()
            if (model) {
              // The SDK's own usage object already carries a real,
              // pre-computed dollar cost for this turn (message.usage.cost.total)
              // -- read it straight from the raw event rather than deriving
              // one ourselves from model pricing tables.
              const rawCost = (
                event as { message?: { usage?: { cost?: { total?: number } } } }
              )?.message?.usage?.cost?.total
              deps.recordPassportUsage(model.provider, {
                inputTokens: item.usage.input,
                outputTokens: item.usage.output,
                cost: typeof rawCost === 'number' ? rawCost : 0
              })
            }
          }
          continue
        }
        if (item.type === 'tool_start') {
          deps.onEvent(sessionId, { ...item, usage: pendingActionUsage })
          continue
        }
        if (item.type === 'turn_end') pendingActionUsage = undefined
        deps.onEvent(sessionId, item)
        // Context usage only actually changes at these two moments -- a real
        // response completing, or a compaction finishing -- so re-checking
        // here keeps the composer's badge live with no polling.
        if (item.type === 'turn_end' || (item.type === 'compaction_status' && item.status === 'end')) {
          const usage = repoSession.getContextUsage()
          if (usage) deps.onEvent(sessionId, { type: 'context_usage', usage })
        }
      }
    })

    openSessions.set(sessionId, repoSession)
    return repoSession
  }

  // Re-synced every time the UI switches to a session (not just on first
  // open), so returning to a session you already opened once still shows
  // its transcript -- the frontend clears its own state on every switch.
  function emitCurrentState(sessionId: string, repoSession: RepoSession): void {
    const history = repoSession.getHistory()
    // Always sent, even empty -- the renderer's loadingHistory flag (added
    // to stop the transcript's empty-state placeholder from flashing
    // before real history loads) waits specifically for this event to
    // know the initial sync is done. Skipping it for a brand-new session
    // (0 items) meant that flag never cleared, silently hiding the whole
    // transcript area -- including the user's own first message -- until
    // the session was reopened with actual history to report.
    deps.onEvent(sessionId, { type: 'history', items: history })

    const model = repoSession.getModel()
    if (model) deps.onEvent(sessionId, { type: 'model', provider: model.provider, id: model.id, name: model.name })

    const usage = repoSession.getContextUsage()
    if (usage) deps.onEvent(sessionId, { type: 'context_usage', usage })

    deps.onEvent(sessionId, { type: 'auto_compaction', enabled: repoSession.getAutoCompactionEnabled() })

    deps.onEvent(sessionId, { type: 'busy', busy: busySessions.has(sessionId) })
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
    listProjectSessions(projectId: string): SessionRecord[] {
      return deps.sessionsRepo.listByProject(projectId)
    },
    createProjectSession(
      projectId: string,
      title?: string
    ): CreateProjectSessionResult | CreateProjectSessionError {
      // The primary repo is just the cwd/session-file anchor -- the model
      // gets every repo's path via sendPrompt's projectRepos injection, not
      // just this one.
      const [primaryRepo] = deps.reposRepo.listByProject(projectId)
      if (!primaryRepo) return { ok: false, error: 'Add a repo to this project first' }
      const session = deps.sessionsRepo.create(
        primaryRepo.id,
        '',
        title?.trim() || 'New session',
        projectId
      )
      return { ok: true, session }
    },
    async createGeneralSession(title?: string): Promise<CreateProjectSessionResult | CreateProjectSessionError> {
      try {
        const { repoId } = await deps.ensureGeneralRepo()
        // projectId left null -- a general session isn't scoped to any
        // project, exactly like a pre-project-scoping repo session; the
        // scratch repo is just its cwd anchor, not a "project" the user sees.
        const session = deps.sessionsRepo.create(repoId, '', title?.trim() || 'New session')
        return { ok: true, session }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    listAllSessions(): SessionWithScope[] {
      const sessions = deps.sessionsRepo.listAll()
      const resolved: SessionWithScope[] = []
      for (const session of sessions) {
        const repo = deps.reposRepo.getById(session.repoId)
        if (!repo) continue
        const project = session.projectId ? (deps.projectsRepo.getById(session.projectId) ?? null) : null
        resolved.push({ session, repo, project })
      }
      return resolved
    },
    renameSession(sessionId: string, title: string): void {
      deps.sessionsRepo.rename(sessionId, title)
    },
    setBookmarked(sessionId: string, bookmarked: boolean): void {
      deps.sessionsRepo.setBookmarked(sessionId, bookmarked)
    },
    async deleteSession(sessionId: string): Promise<void> {
      const open = openSessions.get(sessionId)
      if (open) {
        openSessions.delete(sessionId)
        await open.abort()
      }
      busySessions.delete(sessionId)
      deps.sessionsRepo.delete(sessionId)
    },
    async openSession(sessionId: string): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        emitCurrentState(sessionId, session)
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async sendPrompt(sessionId: string, text: string, options?: PromptOptions): Promise<void> {
      // "Last opened" reflects real activity, not merely being viewed --
      // touching it here (rather than in openSession, which fires on every
      // click into a session regardless of whether anything happens) is
      // what keeps the recents list's sort order meaningful.
      deps.sessionsRepo.touchOpened(sessionId)
      // A prompt sent while the session is already busy steers the live
      // turn instead of starting a new one (RepoSession.prompt always
      // passes streamingBehavior: 'steer', which the SDK only consults
      // when a turn is actually in flight -- see piSession.ts). That
      // steer call resolves as soon as the message is queued, not when
      // the whole run finishes, so busySessions/the 'busy' event must
      // stay owned by whichever call actually started the run -- touching
      // them here too would send a premature busy:false the moment a
      // steer message is merely queued, while the original turn is still
      // actively running underneath.
      const isSteering = busySessions.has(sessionId)
      if (!isSteering) {
        busySessions.add(sessionId)
        deps.onEvent(sessionId, { type: 'busy', busy: true })
      }
      try {
        const session = await ensureSession(sessionId)
        const record = deps.sessionsRepo.getById(sessionId)
        const projectRepos = record?.projectId
          ? deps.reposRepo
              .listByProject(record.projectId)
              .map((r) => ({ name: r.name, path: r.path }))
          : undefined
        const promptText = await deps.buildPromptText(text, { ...options, projectRepos })
        // Images bypass buildPromptText entirely -- they're sent as real
        // multimodal content via the SDK's own `images` option, not spliced
        // into the prompt text. Only pass a second argument when there
        // actually are images, so a plain-text turn's call shape is
        // unchanged.
        if (options?.images && options.images.length > 0) {
          const images = options.images.map((img) => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType
          }))
          await session.prompt(promptText, images)
        } else {
          await session.prompt(promptText)
        }
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      } finally {
        if (!isSteering) {
          busySessions.delete(sessionId)
          deps.onEvent(sessionId, { type: 'busy', busy: false })
        }
      }
    },
    async abortSession(sessionId: string): Promise<void> {
      busySessions.delete(sessionId)
      deps.onEvent(sessionId, { type: 'busy', busy: false })
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
    },
    async compactSession(sessionId: string): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        await session.compact()
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async getAutoCompactionEnabled(sessionId: string): Promise<boolean> {
      const session = await ensureSession(sessionId)
      return session.getAutoCompactionEnabled()
    },
    async setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void> {
      const session = await ensureSession(sessionId)
      session.setAutoCompactionEnabled(enabled)
    },
    async getCompactionThresholds(sessionId: string): Promise<CompactionThresholds> {
      const session = await ensureSession(sessionId)
      return session.getCompactionThresholds()
    },
    async setContextWindowOverride(sessionId: string, contextWindow: number | null): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        const currentModel = session.getModel()
        if (!currentModel) return
        // null resets to the model's own registry default, not whatever the
        // last override happened to be -- re-resolving from the registry
        // (rather than caching the pristine value) keeps this correct even
        // if the model itself changed since the override was applied.
        const nextModel =
          contextWindow === null
            ? (deps.findModel(currentModel.provider, currentModel.id) ?? currentModel)
            : { ...currentModel, contextWindow }
        await session.setModel(nextModel)
        // setModel doesn't itself emit context_usage -- re-check and forward
        // it here so the badge reflects the new window immediately, rather
        // than waiting for the next turn_end/compaction to refresh it.
        const usage = session.getContextUsage()
        if (usage) deps.onEvent(sessionId, { type: 'context_usage', usage })
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async getSessionStats(sessionId: string): Promise<SessionStats> {
      const session = await ensureSession(sessionId)
      return session.getSessionStats()
    },
    async getThinkingInfo(sessionId: string): Promise<ThinkingInfo> {
      const session = await ensureSession(sessionId)
      return {
        supported: session.supportsThinking(),
        level: session.getThinkingLevel(),
        available: session.getAvailableThinkingLevels()
      }
    },
    async setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        session.setThinkingLevel(level)
        deps.onEvent(sessionId, { type: 'thinking_level', level })
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    }
  }
}

function mapAgentEvent(event: unknown): ChatEvent | ChatEvent[] | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolCallId?: string
    toolName?: string
    args?: unknown
    result?: unknown
    isError?: boolean
    message?: {
      role?: string
      usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }
      stopReason?: string
      errorMessage?: string
    }
    errorMessage?: string
    reason?: 'manual' | 'threshold' | 'overflow'
  }
  if (e.type === 'compaction_start') {
    return { type: 'compaction_status', status: 'start' }
  }
  if (e.type === 'compaction_end') {
    // Manual compaction failures already surface via compactSession's own
    // catch (the awaited compact() call rejects, since it's the same error
    // the SDK both reports here and rethrows out of compact() -- see
    // AgentSession.compact()). Auto-compaction (reason 'threshold' or
    // 'overflow') runs entirely inside the SDK with nothing in our code
    // awaiting it, so this event is its only signal out; a failure there
    // must be forwarded as a real error here or it's silently swallowed
    // while the badge stays full. Checking the reason keeps a manual
    // failure from producing two error bubbles for the same failure.
    if (e.errorMessage && e.reason !== 'manual') {
      return [
        { type: 'error', message: e.errorMessage },
        { type: 'compaction_status', status: 'end' }
      ]
    }
    return { type: 'compaction_status', status: 'end' }
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    return { type: 'text_delta', delta: e.assistantMessageEvent.delta ?? '' }
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'thinking_delta') {
    return { type: 'thinking_delta', delta: e.assistantMessageEvent.delta ?? '' }
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'thinking_end') {
    return { type: 'thinking_end' }
  }
  // A failed model call (bad credentials, no credit balance, rate limit,
  // content policy, etc.) still arrives as a normal message_end with a
  // real (if all-zero) `usage` object -- checking for errorMessage first
  // is what stops this from being silently absorbed into a model_usage
  // event with nothing shown to the user.
  if (e.type === 'message_end' && e.message?.role === 'assistant' && e.message.errorMessage) {
    return { type: 'error', message: e.message.errorMessage }
  }
  if (e.type === 'message_end' && e.message?.role === 'assistant' && e.message.usage) {
    return {
      type: 'model_usage',
      usage: {
        input: e.message.usage.input,
        output: e.message.usage.output,
        cacheRead: e.message.usage.cacheRead,
        cacheWrite: e.message.usage.cacheWrite
      }
    }
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
      // The raw SDK result is { content: TextContent[], details, usage } --
      // extract the plain text so the renderer gets the same shape whether
      // a tool call arrives live or is reconstructed from resumed history.
      result: extractResultText(e.result)
    }
  }
  if (e.type === 'turn_end') {
    // The turn's assistant message carries real per-turn token usage from the
    // provider. Tool calls don't carry their own usage (they don't call an
    // LLM), so this is reported per-turn, not per-action.
    const usage =
      e.message?.role === 'assistant' && e.message.usage
        ? {
            input: e.message.usage.input,
            output: e.message.usage.output,
            cacheRead: e.message.usage.cacheRead,
            cacheWrite: e.message.usage.cacheWrite
          }
        : undefined
    return { type: 'turn_end', usage }
  }
  return null
}

function extractResultText(result: unknown): unknown {
  const r = result as { content?: unknown } | undefined
  if (r && Array.isArray(r.content)) {
    const text = r.content
      .filter((part): part is { type: string; text: string } => (part as { type?: string })?.type === 'text')
      .map((part) => part.text)
      .join('')
    if (text) return text
  }
  return result
}
