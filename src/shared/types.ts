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
}
