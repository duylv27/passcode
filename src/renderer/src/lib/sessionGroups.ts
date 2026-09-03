import type { Repo, SessionRecord } from '../../../shared/types'

export interface SessionGroup {
  repo: Repo
  sessions: SessionRecord[]
}

export function groupSessionsByRepo(sessions: SessionRecord[], repos: Repo[]): SessionGroup[] {
  return repos
    .map((repo) => ({ repo, sessions: sessions.filter((s) => s.repoId === repo.id) }))
    .filter((group) => group.sessions.length > 0)
}
