import { useEffect, useState } from 'react'
import type { Repo, SessionRecord } from '../../../shared/types'
import type { Scope } from './RepoSwitcher'
import { groupSessionsByRepo } from '../lib/sessionGroups'
import { ChevronIcon, EditIcon, RepoIcon, TrashIcon } from './icons'

interface Props {
  scope: Scope
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord) => void
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

export function SessionList({
  scope,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [projectRepos, setProjectRepos] = useState<Repo[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const scopeKey = scope.kind === 'repo' ? `repo:${scope.repo.id}` : `project:${scope.project.id}`

  async function refresh(): Promise<void> {
    const list =
      scope.kind === 'repo' ? await window.api.session.list(scope.repo.id) : await window.api.session.listByProject(scope.project.id)
    setSessions(list)
  }

  useEffect(() => {
    refresh()
    if (scope.kind === 'project') {
      window.api.repos.list(scope.project.id).then(setProjectRepos)
      setCollapsed(readCollapsed(scope.project.id))
    } else {
      setProjectRepos([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

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
    if (scope.kind !== 'project') return
    const projectId = scope.project.id
    setCollapsed((prev) => {
      const next = { ...prev, [repoId]: !prev[repoId] }
      try {
        localStorage.setItem(collapsedStorageKey(projectId), JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
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
    setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title } : s)))
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
        <button className="session-row-select" onClick={() => onOpenSession(s)}>
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
      {scope.kind === 'project' && projectRepos.length > 0
        ? groupSessionsByRepo(sessions, projectRepos).map((group) => (
            <div key={group.repo.id} className="session-group">
              <button className="session-group-header" onClick={() => toggleGroup(group.repo.id)}>
                <ChevronIcon className={`session-group-chevron${collapsed[group.repo.id] ? '' : ' is-open'}`} />
                <RepoIcon className="row-icon is-repo" />
                <span className="session-group-label">{group.repo.name}</span>
              </button>
              {!collapsed[group.repo.id] && group.sessions.map(renderSessionRow)}
            </div>
          ))
        : sessions.map(renderSessionRow)}
    </div>
  )
}
