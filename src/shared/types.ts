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
}

export interface CreateProjectSessionResult {
  ok: true
  session: SessionRecord
}

export interface CreateProjectSessionError {
  ok: false
  error: string
}

export interface AuthStatus {
  anthropic: boolean
  copilot: boolean
}

export interface DeviceCodeChallenge {
  userCode: string
  verificationUri: string
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
}

export type HistoryItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; toolCallId: string; toolName: string; input: unknown; result?: unknown; isError?: boolean }

export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result: unknown }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'history'; items: HistoryItem[] }
  | { type: 'model'; provider: string; id: string; name: string }
  /** Sent when a session is (re)opened so the UI can restore the stop
   * button/busy indicator if a turn was already in flight -- e.g. after
   * switching tabs and back while the agent was still running. */
  | { type: 'busy'; busy: boolean }

export interface ModelInfo {
  provider: string
  id: string
  name: string
}

export interface SkillInfo {
  name: string
  description: string
  filePath: string
}

export interface PromptOptions {
  /** Absolute path to the SKILL.md (or skill .md) file, when the user
   * explicitly picked a skill for this turn rather than leaving discovery
   * to the model. */
  skillFilePath?: string
  skillName?: string
  /** Absolute path to a file the user attached as context for this turn. */
  attachedFilePath?: string
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

export interface ApprovalRequest {
  requestId: string
  sessionId: string
  toolName: string
  input: unknown
}

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
    getMostRecent(): Promise<{ session: SessionRecord; repo: Repo; project: Project | null } | null>
    listAll(): Promise<SessionWithScope[]>
    rename(sessionId: string, title: string): Promise<void>
    delete(sessionId: string): Promise<void>
    open(sessionId: string): Promise<void>
    prompt(sessionId: string, text: string, options?: PromptOptions): Promise<void>
    abort(sessionId: string): Promise<void>
    setModel(sessionId: string, provider: string, modelId: string): Promise<void>
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
  }
  settings: {
    setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
    getAuthStatus(): Promise<AuthStatus>
    loginCopilot(): Promise<{ ok: true } | { ok: false; error: string }>
    onCopilotChallenge(listener: (challenge: DeviceCodeChallenge) => void): () => void
  }
  approvals: {
    getPolicy(): Promise<ToolApprovalPolicy>
    setPolicy(policy: ToolApprovalPolicy): Promise<void>
    respond(requestId: string, approved: boolean): Promise<void>
    onRequest(listener: (request: ApprovalRequest) => void): () => void
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
