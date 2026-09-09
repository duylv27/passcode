import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { KebabMenu } from './KebabMenu'

interface Props {
  project: Project
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

/** Renders one project's full session list. A repo is only a code
 * reference attached to a project (see ProjectInfoDialog for its git
 * status/path) -- sessions always belong to the project as a whole, never
 * nested under one specific repo, so this is always one flat list
 * regardless of repo count. This includes sessions created before that was
 * true (repoId set, projectId null) alongside project-scoped ones, fetched
 * separately since listByProject only returns the latter. */
export function SessionList({
  project,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [previews, setPreviews] = useState<Record<string, string | null>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  // See SessionTimeline.tsx's identical field -- avoids flashing "No repos
  // yet"/"No sessions yet." before the first fetch has actually resolved.
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    const repoList = await window.api.repos.list(project.id)
    setRepos(repoList)
    const [perRepoLists, projectSessions] = await Promise.all([
      Promise.all(repoList.map((r) => window.api.session.list(r.id))),
      window.api.session.listByProject(project.id)
    ])
    const allSessions = [...perRepoLists.flat(), ...projectSessions]
    setSessions(allSessions)
    const previewEntries = await Promise.all(
      allSessions.map(async (s) => [s.id, await window.api.sessionPreview.get(s.id).catch(() => null)] as const)
    )
    setPreviews(Object.fromEntries(previewEntries))
    setLoading(false)
  }

  useEffect(() => {
    refresh()
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
        <button
          className="session-row-select"
          onClick={() => {
            const repo = repos.find((r) => r.id === s.repoId)
            if (repo) onOpenSession(s, repo, project)
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

  return (
    <div className="tree-sessions">
      {sessions.map(renderSessionRow)}
      {!loading && repos.length === 0 && <div className="sidebar-empty">No repos yet. Add one below.</div>}
      {!loading && repos.length > 0 && sessions.length === 0 && (
        <div className="sidebar-empty">No sessions yet.</div>
      )}
    </div>
  )
}
