// src/renderer/src/components/SessionTimelineRow.tsx
import { useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord } from '../../../shared/types'
import { EditIcon, TrashIcon } from './icons'

interface Props {
  session: SessionRecord
  repo: Repo
  project: Project | null
  gitStatus: GitStatus | null | undefined
  isActive: boolean
  isBusy: boolean
  showTimestamp: boolean
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function SessionTimelineRow({
  session,
  repo,
  project,
  gitStatus,
  isActive,
  isBusy,
  showTimestamp,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.title)

  function startRename(): void {
    setEditValue(session.title)
    setEditing(true)
  }

  async function commitRename(): Promise<void> {
    const title = editValue.trim()
    setEditing(false)
    if (!title || title === session.title) return
    await window.api.session.rename(session.id, title)
    onSessionRenamed({ ...session, title })
  }

  async function handleDelete(): Promise<void> {
    await window.api.session.delete(session.id)
    onSessionDeleted(session)
  }

  if (editing) {
    return (
      <div className="timeline-row is-editing">
        <input
          className="field session-row-edit-field"
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  const timestamp = session.lastOpenedAt ?? session.createdAt

  return (
    <div className={`timeline-row${isActive ? ' is-active' : ''}`}>
      <button className="timeline-row-select" onClick={() => onOpenSession(session, repo, project)}>
        <div className="timeline-row-title-line">
          <span className={`session-row-status-dot${isBusy ? ' is-busy' : ''}`} />
          <span className="timeline-row-title">{session.title}</span>
          {showTimestamp && <span className="timeline-row-timestamp">{formatTime(timestamp)}</span>}
        </div>
        <div className="timeline-row-meta-line">
          {repo.name}
          {gitStatus?.branch && (
            <>
              {' · '}
              {gitStatus.branch}
              <span className={`repo-status-dot${gitStatus.dirty ? ' is-dirty' : ''}`} />
            </>
          )}
        </div>
      </button>
      <button className="timeline-row-edit" onClick={startRename} title="Rename session">
        <EditIcon />
      </button>
      <button className="timeline-row-delete" onClick={handleDelete} title="Delete session">
        <TrashIcon />
      </button>
    </div>
  )
}
