import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord } from '../../../shared/types'
import { ChevronIcon, PlusIcon, RepoIcon } from './icons'
import { KebabMenu } from './KebabMenu'

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

/** Renders one project's full session tree. Every session is repo-scoped --
 * the app no longer supports project-wide sessions spanning multiple repos
 * (existing data was migrated to one project per repo; see
 * migrateSingleRepoProjects.ts). A project with exactly one repo renders
 * its sessions as one flat list with no repo sub-group box, since there's
 * nothing left to distinguish. A project with more than one repo (possible
 * again after adding a second repo) still groups sessions per repo. */
export function SessionList({
  project,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [repoSessions, setRepoSessions] = useState<Record<string, SessionRecord[]>>({})
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [previews, setPreviews] = useState<Record<string, string | null>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function refresh(): Promise<void> {
    const repoList = await window.api.repos.list(project.id)
    setRepos(repoList)
    const sessionEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.session.list(r.id)] as const)
    )
    setRepoSessions(Object.fromEntries(sessionEntries))
    const statusEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const)
    )
    setGitStatuses(Object.fromEntries(statusEntries))
    const allSessions = Object.values(Object.fromEntries(sessionEntries)).flat()
    const previewEntries = await Promise.all(
      allSessions.map(async (s) => [s.id, await window.api.sessionPreview.get(s.id).catch(() => null)] as const)
    )
    setPreviews(Object.fromEntries(previewEntries))
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
    onSessionRenamed({ ...session, title })
  }

  function renderSessionRow(s: SessionRecord): JSX.Element {
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
            if (repo) onOpenSession(s, repo, null)
          }}
        >
          <div className="session-row-title-line">
            <span className={`session-row-status-dot${busySessionIds.has(s.id) ? ' is-busy' : ''}`} />
            <span className="session-row-title">{s.title}</span>
          </div>
          {previews[s.id] && <div className="session-row-preview">{previews[s.id]}</div>}
        </button>
        <KebabMenu
          triggerClassName="session-row-kebab"
          title="Session options"
          items={[
            { label: 'Rename', onClick: () => startRename(s) },
            { label: 'Delete', onClick: () => handleDelete(s), danger: true }
          ]}
        />
      </div>
    )
  }

  if (repos.length === 1) {
    const sessions = repoSessions[repos[0].id] ?? []
    return (
      <div className="tree-sessions">
        {sessions.map(renderSessionRow)}
        {sessions.length === 0 && <div className="sidebar-empty">No sessions yet.</div>}
      </div>
    )
  }

  return (
    <div className="tree-sessions">
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
            {!collapsed[repo.id] && sessionsForRepo.map(renderSessionRow)}
          </div>
        )
      })}
      {repos.length === 0 && <div className="sidebar-empty">No repos yet. Add one below.</div>}
    </div>
  )
}
