import { useEffect, useState } from 'react'
import type { Repo, SessionRecord } from '../../../shared/types'
import { ChatIcon, PlusIcon, TrashIcon } from './icons'

interface Props {
  repo: Repo
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord) => void
  onSessionDeleted: (session: SessionRecord) => void
}

export function SessionList({ repo, activeSessionId, onOpenSession, onSessionDeleted }: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])

  async function refresh(): Promise<void> {
    setSessions(await window.api.session.list(repo.id))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.id])

  async function handleCreate(): Promise<void> {
    const created = await window.api.session.create(repo.id)
    await refresh()
    onOpenSession(created)
  }

  async function handleDelete(session: SessionRecord): Promise<void> {
    await window.api.session.delete(session.id)
    onSessionDeleted(session)
    await refresh()
  }

  return (
    <div className="tree-sessions">
      {sessions.map((s) => (
        <div key={s.id} className={`session-row${activeSessionId === s.id ? ' is-active' : ''}`}>
          <button className="session-row-select" onClick={() => onOpenSession(s)}>
            <ChatIcon className="row-icon is-session" />
            <span className="session-row-title">{s.title}</span>
          </button>
          <button className="session-row-delete" onClick={() => handleDelete(s)} title="Delete session">
            <TrashIcon />
          </button>
        </div>
      ))}
      <button className="session-row is-add" onClick={handleCreate}>
        <PlusIcon className="row-icon" />
        <span>New session</span>
      </button>
    </div>
  )
}
