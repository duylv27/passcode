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

export interface GitStatus {
  branch: string
  changed: string[]
  added: string[]
  deleted: string[]
}

export interface AddRepoResult {
  ok: true
  repo: Repo
}

export interface AddRepoError {
  ok: false
  error: string
}

export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string }
  | { type: 'turn_end' }
  | { type: 'error'; message: string }

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
    open(repoId: string): Promise<void>
    prompt(repoId: string, text: string): Promise<void>
    onEvent(listener: (repoId: string, event: ChatEvent) => void): () => void
  }
}
