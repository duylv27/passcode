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
  repoId: string
  piSessionId: string
  title: string
  createdAt: string
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
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result: unknown }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'history'; items: HistoryItem[] }
  | { type: 'model'; provider: string; id: string; name: string }

export interface ModelInfo {
  provider: string
  id: string
  name: string
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
    delete(id: string): Promise<void>
  }
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
  }
  session: {
    list(repoId: string): Promise<SessionRecord[]>
    create(repoId: string, title?: string): Promise<SessionRecord>
    rename(sessionId: string, title: string): Promise<void>
    delete(sessionId: string): Promise<void>
    open(sessionId: string): Promise<void>
    prompt(sessionId: string, text: string): Promise<void>
    abort(sessionId: string): Promise<void>
    setModel(sessionId: string, provider: string, modelId: string): Promise<void>
    onEvent(listener: (sessionId: string, event: ChatEvent) => void): () => void
  }
  models: {
    list(): Promise<ModelInfo[]>
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
}
