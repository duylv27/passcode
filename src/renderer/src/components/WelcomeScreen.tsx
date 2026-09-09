import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord, SessionWithScope } from '../../../shared/types'
import { LogoIcon, PlusIcon } from './icons'

const MAX_RECENT = 6

/** Compact "2m"/"3h"/"5d" style relative time for the recent-session rows --
 * coarser than a full date, finer than SessionTimeline's day-bucket labels
 * ("Today"/"Yesterday"), which are meant for section headers, not rows. */
function relativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface Props {
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onBrowseProjects: () => void
}

/** Shown in the empty content area on every launch (replacing the old
 * auto-jump-to-most-recent-session behavior) and whenever the user closes
 * every open tab. Reuses the exact same create-then-resolve-via-listAll()
 * pattern SessionTimeline's "New general session" row already uses, so a
 * freshly created session's repo/project scope comes from one source of
 * truth rather than a second bespoke IPC call. */
export function WelcomeScreen({ onOpenSession, onBrowseProjects }: Props): JSX.Element {
  const [recent, setRecent] = useState<SessionWithScope[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    window.api.session.listAll().then((entries) => {
      if (cancelled) return
      const sorted = [...entries].sort((a, b) => {
        const at = a.session.lastOpenedAt ?? a.session.createdAt
        const bt = b.session.lastOpenedAt ?? b.session.createdAt
        return bt.localeCompare(at)
      })
      setRecent(sorted.slice(0, MAX_RECENT))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreateGeneralSession(): Promise<void> {
    const result = await window.api.session.createGeneralSession()
    if (!result.ok) return
    const entries = await window.api.session.listAll()
    const created = entries.find((e) => e.session.id === result.session.id)
    if (created) onOpenSession(created.session, created.repo, created.project)
  }

  return (
    <div className="welcome-screen">
      <LogoIcon className="welcome-screen-mark" />
      <div className="welcome-screen-wordmark">PassCode</div>
      <div className="welcome-screen-tagline">
        {recent.length > 0
          ? 'Pick up where you left off, or start something new.'
          : 'Start a quick session, or open a project to get going.'}
      </div>
      <div className="welcome-screen-actions">
        <button type="button" className="welcome-screen-btn is-primary" onClick={handleCreateGeneralSession}>
          <PlusIcon className="row-icon" />
          New general session
        </button>
        <button type="button" className="welcome-screen-btn is-secondary" onClick={onBrowseProjects}>
          Browse projects
        </button>
      </div>
      {!loading && recent.length > 0 && (
        <div className="welcome-screen-recent">
          <div className="welcome-screen-recent-head">Recent</div>
          {recent.map(({ session, repo, project }) => (
            <button
              key={session.id}
              type="button"
              className="welcome-screen-recent-row"
              onClick={() => onOpenSession(session, repo, project)}
            >
              <span className="welcome-screen-recent-dot" />
              <span className="welcome-screen-recent-info">
                <span className="welcome-screen-recent-title">{session.title}</span>
                <span className="welcome-screen-recent-scope">{project ? project.name : repo.name}</span>
              </span>
              <span className="welcome-screen-recent-when">
                {relativeTime(session.lastOpenedAt ?? session.createdAt)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
