import { useEffect, useState } from 'react'
import type { Repo, SessionRecord } from '../../../shared/types'
import { PlusIcon, RepoIcon, ErrorIcon } from './icons'

interface Props {
  repo: Repo
  selected: SessionRecord | null
  onSelect: (session: SessionRecord) => void
}

export function SessionTabs({ repo, selected, onSelect }: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])

  async function refresh(): Promise<SessionRecord[]> {
    const list = await window.api.session.list(repo.id)
    setSessions(list)
    return list
  }

  useEffect(() => {
    let cancelled = false
    refresh().then(async (list) => {
      if (cancelled) return
      if (list.length === 0) {
        const created = await window.api.session.create(repo.id)
        if (cancelled) return
        setSessions([created])
        onSelect(created)
      } else {
        onSelect(list[list.length - 1])
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.id])

  async function handleCreate(): Promise<void> {
    const created = await window.api.session.create(repo.id)
    await refresh()
    onSelect(created)
  }

  async function handleDelete(session: SessionRecord): Promise<void> {
    await window.api.session.delete(session.id)
    const remaining = sessions.filter((s) => s.id !== session.id)
    setSessions(remaining)
    if (selected?.id !== session.id) return
    if (remaining.length > 0) {
      onSelect(remaining[remaining.length - 1])
    } else {
      await handleCreate()
    }
  }

  return (
    <div className="tabs">
      {sessions.map((s) => (
        <div key={s.id} className={`tab${selected?.id === s.id ? ' is-active' : ''}`}>
          <button className="tab-select" onClick={() => onSelect(s)}>
            <RepoIcon />
            <span className="tab-title">{s.title}</span>
          </button>
          <button
            className="tab-close"
            onClick={() => handleDelete(s)}
            title="Close session"
            disabled={sessions.length === 1}
          >
            <ErrorIcon />
          </button>
        </div>
      ))}
      <button className="tab-add" onClick={handleCreate} title="New session">
        <PlusIcon />
      </button>
    </div>
  )
}
