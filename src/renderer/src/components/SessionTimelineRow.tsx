// src/renderer/src/components/SessionTimelineRow.tsx
import { useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord } from '../../../shared/types'
import { KebabMenu } from './KebabMenu'
import { StarIcon } from './icons'

interface Props {
  session: SessionRecord
  repo: Repo
  project: Project | null
  gitStatus: GitStatus | null | undefined
  isActive: boolean
  isBusy: boolean
  preview: string | null | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  onSessionBookmarkChanged: (session: SessionRecord) => void
}

export function SessionTimelineRow({
  session,
  repo,
  project,
  gitStatus,
  isActive,
  isBusy,
  preview,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  onSessionBookmarkChanged
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

  async function handleToggleBookmark(): Promise<void> {
    const bookmarked = !session.bookmarked
    await window.api.session.setBookmarked(session.id, bookmarked)
    onSessionBookmarkChanged({ ...session, bookmarked })
  }

  if (editing) {
    return (
      <div className="session-timeline-row is-editing">
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

  return (
    <div className={`session-timeline-row${isActive ? ' is-active' : ''}`}>
      <button className="session-timeline-row-select" onClick={() => onOpenSession(session, repo, project)}>
        <div className="session-timeline-row-title-line">
          <span className={`session-row-status-dot${isBusy ? ' is-busy' : ''}`} />
          <span className="session-timeline-row-title">{session.title}</span>
          {session.bookmarked && <StarIcon className="session-timeline-row-star" filled />}
        </div>
        <div className="session-timeline-row-meta-line">
          {repo.name}
          {gitStatus?.branch && (
            <>
              {' · '}
              {gitStatus.branch}
              <span className={`repo-status-dot${gitStatus.dirty ? ' is-dirty' : ''}`} />
            </>
          )}
        </div>
        {preview && <div className="session-timeline-row-preview">{preview}</div>}
      </button>
      <KebabMenu
        triggerClassName="session-timeline-row-kebab"
        title="Session options"
        items={[
          { label: 'Rename', onClick: startRename },
          { label: session.bookmarked ? 'Remove bookmark' : 'Bookmark', onClick: handleToggleBookmark },
          { label: 'Delete', onClick: handleDelete, danger: true }
        ]}
      />
    </div>
  )
}
