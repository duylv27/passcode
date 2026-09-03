import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord } from '../../../shared/types'
import { ChevronIcon, EditIcon, PlusIcon, RepoIcon, TrashIcon } from './icons'

interface Props {
  project: Project
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

function collapsedStorageKey(projectId: string): string {
  return `passcode-session-groups-${projectId}`
}

function readCollapsed(projectId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(collapsedStorageKey(projectId))
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** Renders one project's full session tree: each repo as a collapsible
 * group of its own (repo-scoped) sessions, plus any project-scoped
 * sessions (spanning every repo) in a small unboxed section above them. */
export function SessionList({
  project,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [repoSessions, setRepoSessions] = useState<Record<string, SessionRecord[]>>({})
  const [projectSessions, setProjectSessions] = useState<SessionRecord[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function refresh(): Promise<void> {
    const [repoList, projSessions] = await Promise.all([
      window.api.repos.list(project.id),
      window.api.session.listByProject(project.id)
    ])
    setRepos(repoList)
    setProjectSessions(projSessions)
    const sessionEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.session.list(r.id)] as const)
    )
    setRepoSessions(Object.fromEntries(sessionEntries))
    const statusEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const)
    )
    setGitStatuses(Object.fromEntries(statusEntries))
  }

  useEffect(() => {
    refresh()
    setCollapsed(readCollapsed(project.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    return window.api.session.onEvent((sessionId, event) => {
      if (event.type !== 'busy') return
      setBusySessionIds((prev) => {
        const next = new Set(prev)
        if (event.busy) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    })
  }, [])

  function toggleGroup(repoId: string): void {
    setCollapsed((prev) => {
      const next = { ...prev, [repoId]: !prev[repoId] }
      try {
        localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  async function handleCreateRepoSession(repo: Repo): Promise<void> {
    const created = await window.api.session.create(repo.id)
    setRepoSessions((prev) => ({ ...prev, [repo.id]: [...(prev[repo.id] ?? []), created] }))
    onOpenSession(created, repo, null)
  }

  async function handleDelete(session: SessionRecord): Promise<void> {
    await window.api.session.delete(session.id)
    onSessionDeleted(session)
    await refresh()
  }

  function startRename(session: SessionRecord): void {
    setEditingId(session.id)
    setEditValue(session.title)
  }

  async function commitRename(session: SessionRecord): Promise<void> {
    const title = editValue.trim()
    setEditingId(null)
    if (!title || title === session.title) return
    await window.api.session.rename(session.id, title)
    setRepoSessions((prev) => {
      const next: Record<string, SessionRecord[]> = {}
      for (const [repoId, list] of Object.entries(prev)) {
        next[repoId] = list.map((s) => (s.id === session.id ? { ...s, title } : s))
      }
      return next
    })
    setProjectSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title } : s)))
    onSessionRenamed({ ...session, title })
  }

  function renderSessionRow(s: SessionRecord, sessionProject: Project | null): JSX.Element {
    if (editingId === s.id) {
      return (
        <div key={s.id} className="session-row is-editing">
          <input
            className="field session-row-edit-field"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitRename(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setEditingId(null)
            }}
          />
        </div>
      )
    }
    return (
      <div key={s.id} className={`session-row${activeSessionId === s.id ? ' is-active' : ''}`}>
        <button
          className="session-row-select"
          onClick={() => {
            const repo = repos.find((r) => r.id === s.repoId)
            if (repo) onOpenSession(s, repo, sessionProject)
          }}
        >
          <span className={`session-row-status-dot${busySessionIds.has(s.id) ? ' is-busy' : ''}`} />
          <span className="session-row-title">{s.title}</span>
        </button>
        <button className="session-row-edit" onClick={() => startRename(s)} title="Rename session">
          <EditIcon />
        </button>
        <button className="session-row-delete" onClick={() => handleDelete(s)} title="Delete session">
          <TrashIcon />
        </button>
      </div>
    )
  }

  return (
    <div className="tree-sessions">
      {projectSessions.length > 0 && (
        <>
          <div className="project-sessions-label">Project</div>
          {projectSessions.map((s) => renderSessionRow(s, project))}
        </>
      )}
      {repos.map((repo) => {
        const status = gitStatuses[repo.id]
        const sessionsForRepo = repoSessions[repo.id] ?? []
        return (
          <div key={repo.id} className="session-group">
            <div className="session-group-header">
              <button className="session-group-toggle" onClick={() => toggleGroup(repo.id)}>
                <ChevronIcon className={`session-group-chevron${collapsed[repo.id] ? '' : ' is-open'}`} />
                <RepoIcon className="row-icon is-repo" />
                <span className="session-group-label">{repo.name}</span>
                {status && (
                  <span
                    className={`repo-status-dot${status.dirty ? ' is-dirty' : ''}`}
                    title={status.branch ?? undefined}
                  />
                )}
              </button>
              <button
                className="session-group-add"
                onClick={() => handleCreateRepoSession(repo)}
                title="New session in this repo"
              >
                <PlusIcon />
              </button>
            </div>
            {!collapsed[repo.id] && sessionsForRepo.map((s) => renderSessionRow(s, null))}
          </div>
        )
      })}
      {repos.length === 0 && projectSessions.length === 0 && (
        <div className="sidebar-empty">No repos yet. Add one below.</div>
      )}
    </div>
  )
}
