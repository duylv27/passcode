import { useEffect, useState } from 'react'
import type { SessionRecord } from '../../../shared/types'
import type { Scope } from './RepoSwitcher'
import { ChatIcon, EditIcon, PlusIcon, TrashIcon } from './icons'

interface Props {
  scope: Scope
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

export function SessionList({
  scope,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const scopeKey = scope.kind === 'repo' ? `repo:${scope.repo.id}` : `project:${scope.project.id}`

  async function refresh(): Promise<void> {
    const list =
      scope.kind === 'repo' ? await window.api.session.list(scope.repo.id) : await window.api.session.listByProject(scope.project.id)
    setSessions(list)
  }

  useEffect(() => {
    refresh()
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  async function handleCreate(): Promise<void> {
    if (scope.kind === 'repo') {
      const created = await window.api.session.create(scope.repo.id)
      await refresh()
      onOpenSession(created)
      return
    }
    setError(null)
    const result = await window.api.session.createProjectSession(scope.project.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refresh()
    onOpenSession(result.session)
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

  return (
    <div className="tree-sessions">
      {sessions.map((s) =>
        editingId === s.id ? (
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
        ) : (
          <div key={s.id} className={`session-row${activeSessionId === s.id ? ' is-active' : ''}`}>
            <button className="session-row-select" onClick={() => onOpenSession(s)}>
              <ChatIcon className="row-icon is-session" />
              <span className="session-row-title">{s.title}</span>
            </button>
            <button
              className="session-row-edit"
              onClick={() => startRename(s)}
              title="Rename session"
            >
              <EditIcon />
            </button>
            <button className="session-row-delete" onClick={() => handleDelete(s)} title="Delete session">
              <TrashIcon />
            </button>
          </div>
        )
      )}
      <button className="session-row is-add" onClick={handleCreate}>
        <PlusIcon className="row-icon" />
        <span>New session</span>
      </button>
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
