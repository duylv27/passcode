export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface Repo {
  id: string
  projectId: string
  path: string
  name: string
}

export interface SessionRecord {
  id: string
  /** The session's cwd/session-file-owning repo -- for a project-scoped
   * session (projectId set) this is just its "primary" repo, not the only
   * repo it can touch. */
  repoId: string
  /** Set when this session spans every repo in the project, not just repoId. */
  projectId: string | null
  piSessionId: string
  title: string
  createdAt: string
  /** Timestamp this session was last opened, or null if never reopened
   * since creation -- used to sort/bucket "recent activity" views by the
   * same timestamp the backend already sorts listAll() by. */
  lastOpenedAt: string | null
  /** A persistent favorite marker, distinct from a tab's "Pin" (which is
   * only in-memory and only means something while the tab stays open). */
  bookmarked: boolean
}

export interface CreateProjectSessionResult {
  ok: true
  session: SessionRecord
}

export interface CreateProjectSessionError {
  ok: false
  error: string
}

export type PassportAuthMethod = 'api_key' | 'oauth'
export type PassportStatus = 'connected' | 'error' | 'unknown'

export interface Passport {
  id: string
  providerId: string
  authMethod: PassportAuthMethod
  displayName: string
  isActive: boolean
  /** Only set for authMethod 'api_key' -- oauth Passports never store a
   * credential of our own, see docs/superpowers/specs/2026-09-10-passports-design.md. */
  apiKey: string | null
  status: PassportStatus
  lastValidatedAt: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalRequests: number
  lastUsedAt: string | null
  createdAt: string
}

/** A generic OAuth interaction prompt, covering both shapes the SDK's real
 * login() flows raise today: GitHub Copilot's device code (visit a URL,
 * type a short code) and Anthropic's browser + manual-code fallback (open
 * a URL, optionally paste back a code if the redirect doesn't complete). */
export type PassportOAuthPrompt =
  | { kind: 'device_code'; userCode: string; verificationUri: string }
  | { kind: 'browser'; url: string; instructions?: string }

export interface CopilotQuotaCategory {
  id: string
  unlimited: boolean
  remaining: number
  entitlement: number
  percentRemaining: number
  overageCount: number
  overagePermitted: boolean
}

export interface CopilotQuota {
  planName: string
  resetDate: string
  categories: CopilotQuotaCategory[]
}

export interface AddRepoResult {
  ok: true
  repo: Repo
}

export interface AddRepoError {
  ok: false
  error: string
}

export interface GitStatus {
  branch: string | null
  dirty: boolean
}

export interface SessionWithScope {
  session: SessionRecord
  repo: Repo
  project: Project | null
}

export interface TokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface CompactionThresholds {
  reserveTokens: number
  keepRecentTokens: number
}

/** Aggregated over ALL session entries, including history that was
 * compacted away -- unlike ContextUsage (a live snapshot of the current
 * window), this reflects what actually got billed across the whole
 * conversation. */
export interface SessionStats {
  userMessages: number
  assistantMessages: number
  toolCalls: number
  toolResults: number
  totalMessages: number
  tokens: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    total: number
  }
  cost: number
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** `available` is empty and `level` meaningless when !supported -- callers
 * should hide/disable the reasoning control entirely in that case rather
 * than showing a control with nothing to pick from. */
export interface ThinkingInfo {
  supported: boolean
  level: ThinkingLevel
  available: ThinkingLevel[]
}

export type HistoryItem =
  | { kind: 'user'; text: string; images?: { data: string; mimeType: string }[] }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | {
      kind: 'tool'
      toolCallId: string
      toolName: string
      input: unknown
      usage?: TokenUsage
      result?: unknown
      isError?: boolean
    }

export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'model_usage'; usage: TokenUsage }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown; usage?: TokenUsage }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result: unknown }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'error'; message: string }
  /** A tool call the user explicitly skipped (see approvalHandlers.ts) --
   * distinct from 'error' so the UI can render it as a quiet, neutral
   * "skipped" notice instead of an alarming red error paragraph; the user
   * made a deliberate choice, nothing actually broke. */
  | { type: 'tool_denied'; toolName: string; input: unknown }
  /** Raised by an extension's ctx.ui.notify() call -- shown as a toast,
   * scoped to the session it came from (see App.tsx). */
  | { type: 'ui_notify'; message: string; level: 'info' | 'warning' | 'error' }
  | { type: 'history'; items: HistoryItem[] }
  | { type: 'model'; provider: string; id: string; name: string }
  /** Sent when a session is (re)opened so the UI can restore the stop
   * button/busy indicator if a turn was already in flight -- e.g. after
   * switching tabs and back while the agent was still running. */
  | { type: 'busy'; busy: boolean }
  /** Sent whenever context usage can actually have changed -- after a
   * turn completes and after a compaction finishes -- not polled. */
  | { type: 'context_usage'; usage: ContextUsage }
  | { type: 'compaction_status'; status: 'start' | 'end' }
  /** Sent once per session open/switch, reflecting the session's current
   * (in-memory, not persisted) auto-compaction setting. */
  | { type: 'auto_compaction'; enabled: boolean }
  /** Sent after setThinkingLevel() changes the effective reasoning level. */
  | { type: 'thinking_level'; level: ThinkingLevel }

export interface ModelInfo {
  provider: string
  /** Friendly display name for `provider` (e.g. "Anthropic", "Google"),
   * from the SDK's own ModelRegistry.getProviderDisplayName(). */
  providerName: string
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  /** Dollars per million tokens. */
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }
}

/** Which of the scanned directories a skill was found in -- see
 * getAdditionalSkillPaths() and listSkillsForRepo() in main/agent/skills.ts
 * for the exact paths each of these corresponds to. */
export type SkillSource = 'pi' | 'project' | 'claude' | 'copilot' | 'other'

export interface SkillInfo {
  name: string
  description: string
  filePath: string
  source: SkillSource
}

export interface PromptOptions {
  /** Absolute path to the SKILL.md (or skill .md) file, when the user
   * explicitly picked a skill for this turn rather than leaving discovery
   * to the model. */
  skillFilePath?: string
  skillName?: string
  /** Paths to files the user attached as context for this turn -- may be
   * absolute (native file-picker) or repo-relative (the @-mention fuzzy
   * picker); promptBuilder.ts resolves relative ones against the repo's
   * cwd. */
  attachedFilePaths?: string[]
  /** Images pasted into the composer, sent as real multimodal content via
   * the SDK's own `images` prompt option -- not spliced into prompt text. */
  images?: { data: string; mimeType: string }[]
}

/** Known built-in tool names an approval policy can key on. Any other
 * (e.g. custom) tool name defaults to requiring approval. */
export const KNOWN_TOOL_NAMES = [
  'read',
  'grep',
  'find',
  'ls',
  'bash',
  'powershell',
  'edit',
  'write'
] as const

export interface ToolApprovalPolicy {
  autoApprove: Record<string, boolean>
}

export interface UsageTelemetryConfig {
  enabled: boolean
  outputPath: string
}

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  toolName: string
  input: unknown
}

/** A prompt raised by an extension via the SDK's ExtensionUIContext
 * (select/confirm/input), routed through PassCode's per-session UI hooks
 * -- see piSession.ts's bindExtensions() call. */
export type UiPromptRequest =
  | { requestId: string; sessionId: string; kind: 'select'; title: string; options: string[] }
  | { requestId: string; sessionId: string; kind: 'confirm'; title: string; message: string }
  | { requestId: string; sessionId: string; kind: 'input'; title: string; placeholder?: string }

export interface Api {
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
    gitStatus(id: string): Promise<GitStatus | null>
  }
  session: {
    list(repoId: string): Promise<SessionRecord[]>
    create(repoId: string, title?: string): Promise<SessionRecord>
    listByProject(projectId: string): Promise<SessionRecord[]>
    createProjectSession(
      projectId: string,
      title?: string
    ): Promise<CreateProjectSessionResult | CreateProjectSessionError>
    /** Creates a session not scoped to any project -- its repoId anchors to
     * a hidden, app-managed scratch directory, created on first use. */
    createGeneralSession(title?: string): Promise<CreateProjectSessionResult | CreateProjectSessionError>
    setBookmarked(sessionId: string, bookmarked: boolean): Promise<void>
    listAll(): Promise<SessionWithScope[]>
    rename(sessionId: string, title: string): Promise<void>
    delete(sessionId: string): Promise<void>
    open(sessionId: string): Promise<void>
    prompt(sessionId: string, text: string, options?: PromptOptions): Promise<void>
    abort(sessionId: string): Promise<void>
    setModel(sessionId: string, provider: string, modelId: string): Promise<void>
    compact(sessionId: string): Promise<void>
    getAutoCompactionEnabled(sessionId: string): Promise<boolean>
    setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void>
    getCompactionThresholds(sessionId: string): Promise<CompactionThresholds>
    /** `null` resets to the model's own default context window. */
    setContextWindowOverride(sessionId: string, contextWindow: number | null): Promise<void>
    getSessionStats(sessionId: string): Promise<SessionStats>
    getThinkingInfo(sessionId: string): Promise<ThinkingInfo>
    setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void>
    onEvent(listener: (sessionId: string, event: ChatEvent) => void): () => void
  }
  models: {
    list(): Promise<ModelInfo[]>
  }
  skills: {
    list(repoId: string): Promise<SkillInfo[]>
  }
  files: {
    pickFile(): Promise<string | null>
    pickFolder(): Promise<string | null>
    /** Repo-relative paths, tracked + untracked-but-not-gitignored, for the
     * @-mention fuzzy file picker. */
    listRepoFiles(repoId: string): Promise<string[]>
  }
  settings: {
    getCopilotQuota(): Promise<CopilotQuota | null>
    getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
    setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<{ ok: true } | { ok: false; error: string }>
  }
  passports: {
    list(): Promise<Passport[]>
    createApiKey(
      providerId: string,
      displayName: string,
      apiKey: string
    ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
    createOAuth(
      providerId: string,
      displayName: string
    ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
    onOAuthPrompt(listener: (prompt: PassportOAuthPrompt) => void): () => void
    submitOAuthCode(code: string): Promise<void>
    cancelOAuth(): Promise<void>
    setActive(id: string): Promise<void>
    rename(id: string, displayName: string): Promise<void>
    remove(id: string): Promise<void>
  }
  approvals: {
    getPolicy(): Promise<ToolApprovalPolicy>
    setPolicy(policy: ToolApprovalPolicy): Promise<void>
    respond(requestId: string, approved: boolean): Promise<void>
    onRequest(listener: (request: ApprovalRequest) => void): () => void
  }
  uiPrompts: {
    respond(requestId: string, value: string | boolean | undefined): Promise<void>
    onRequest(listener: (request: UiPromptRequest) => void): () => void
    /** Fired when a pending request is no longer relevant (timeout or the
     * underlying signal aborted) -- the renderer should drop it from its
     * queue without treating it as a user response. */
    onCancel(listener: (requestId: string) => void): () => void
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(listener: (maximized: boolean) => void): () => void
  }
  app: {
    getVersion(): Promise<string>
  }
  sessionPreview: {
    /** A short excerpt of the most recent user/assistant message in this
     * session, or null if it has never been opened or has no messages yet. */
    get(sessionId: string): Promise<string | null>
  }
}
