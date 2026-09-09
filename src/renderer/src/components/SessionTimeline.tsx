// src/renderer/src/components/SessionTimeline.tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord, SessionWithScope } from '../../../shared/types'
import { SessionTimelineRow } from './SessionTimelineRow'
import { ChevronIcon, PlusIcon, StarIcon } from './icons'

interface Props {
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  refreshKey: number
}

const OLDER_COLLAPSED_KEY = 'passcode-session-view-older-collapsed'
const RECENT_DAYS = 6

function readOlderCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(OLDER_COLLAPSED_KEY)
    return raw ? (JSON.parse(raw) as boolean) : true
  } catch {
    return true
  }
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayLabel(dateStr: string, now: Date): string {
  const diffDays = Math.round((startOfDay(now) - startOfDay(new Date(dateStr))) / 86400000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays <= RECENT_DAYS) return new Date(dateStr).toLocaleDateString(undefined, { weekday: 'long' })
  return 'Older Sessions'
}

export function SessionTimeline({
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  refreshKey
}: Props): JSX.Element {
  const [entries, setEntries] = useState<SessionWithScope[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [previews, setPreviews] = useState<Record<string, string | null>>({})
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [olderCollapsed, setOlderCollapsed] = useState(() => readOlderCollapsed())
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false)
  // Distinguishes "still fetching" from "genuinely no sessions" -- without
  // this, the empty state flashed on screen for a beat before every refresh
  // (initial load, and again each time refreshKey bumps) even when there
  // was real data on the way.
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    const sessionEntries = await window.api.session.listAll()
    setEntries(sessionEntries)

    const distinctRepos = new Map<string, Repo>()
    for (const entry of sessionEntries) distinctRepos.set(entry.repo.id, entry.repo)
    const statusEntries = await Promise.all(
      Array.from(distinctRepos.values()).map(
        async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const
      )
    )
    setGitStatuses(Object.fromEntries(statusEntries))

    const previewEntries = await Promise.all(
      sessionEntries.map(
        async (e) => [e.session.id, await window.api.sessionPreview.get(e.session.id).catch(() => null)] as const
      )
    )
    setPreviews(Object.fromEntries(previewEntries))
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

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

  // A general session has no project of its own -- its repoId/project only
  // become known once listAll() resolves them, so re-fetch and pull the new
  // entry out of the refreshed list rather than adding a second IPC call
  // just to hand back {repo, project} at creation time.
  async function handleCreateGeneralSession(): Promise<void> {
    const result = await window.api.session.createGeneralSession()
    if (!result.ok) return
    const sessionEntries = await window.api.session.listAll()
    setEntries(sessionEntries)
    const created = sessionEntries.find((e) => e.session.id === result.session.id)
    if (created) onOpenSession(created.session, created.repo, created.project)
  }

  // SessionTimelineRow's own rename only updates the DB and its own local
  // edit-field state -- without also patching entries here, the new title
  // didn't show until refreshKey changed (e.g. switching views away and
  // back, which force-refetches) rather than reflecting immediately.
  function handleRowRenamed(session: SessionRecord): void {
    setEntries((prev) => prev.map((e) => (e.session.id === session.id ? { ...e, session } : e)))
    onSessionRenamed(session)
  }

  function handleRowBookmarkChanged(session: SessionRecord): void {
    setEntries((prev) => prev.map((e) => (e.session.id === session.id ? { ...e, session } : e)))
  }

  function toggleOlderCollapsed(): void {
    setOlderCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(OLDER_COLLAPSED_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  const now = new Date()
  const visibleEntries = bookmarkedOnly ? entries.filter((e) => e.session.bookmarked) : entries
  const groups = new Map<string, SessionWithScope[]>()
  for (const entry of visibleEntries) {
    const label = dayLabel(entry.session.lastOpenedAt ?? entry.session.createdAt, now)
    const list = groups.get(label)
    if (list) list.push(entry)
    else groups.set(label, [entry])
  }
  const olderEntries = groups.get('Older Sessions') ?? []
  groups.delete('Older Sessions')

  return (
    <div className="tree-sessions">
      <button className="picker-add-row is-general" onClick={handleCreateGeneralSession}>
        <PlusIcon className="row-icon" />
        <span>New general session</span>
      </button>
      {entries.length > 0 && (
        <button
          className={`session-timeline-filter${bookmarkedOnly ? ' is-active' : ''}`}
          onClick={() => setBookmarkedOnly((v) => !v)}
        >
          <StarIcon filled={bookmarkedOnly} />
          <span>{bookmarkedOnly ? 'Bookmarked' : 'All sessions'}</span>
        </button>
      )}
      {!loading && visibleEntries.length === 0 && (
        <div className="sidebar-empty">
          {bookmarkedOnly ? 'No bookmarked sessions.' : 'No sessions yet.'}
        </div>
      )}
      {Array.from(groups.entries()).map(([label, groupEntries]) => (
        <div key={label} className="session-timeline-day-group">
          <div className="session-timeline-day-header">{label}</div>
          {groupEntries.map(({ session, repo, project }) => (
            <SessionTimelineRow
              key={session.id}
              session={session}
              repo={repo}
              project={project}
              gitStatus={gitStatuses[repo.id]}
              isActive={activeSessionId === session.id}
              isBusy={busySessionIds.has(session.id)}
              preview={previews[session.id]}
              onOpenSession={onOpenSession}
              onSessionDeleted={onSessionDeleted}
              onSessionRenamed={handleRowRenamed}
              onSessionBookmarkChanged={handleRowBookmarkChanged}
            />
          ))}
        </div>
      ))}
      {olderEntries.length > 0 && (
        <div className="session-timeline-day-group">
          <button className="session-timeline-older-toggle" onClick={toggleOlderCollapsed}>
            <ChevronIcon className={`session-timeline-older-chevron${olderCollapsed ? '' : ' is-open'}`} />
            Older Sessions
          </button>
          {!olderCollapsed &&
            olderEntries.map(({ session, repo, project }) => (
              <SessionTimelineRow
                key={session.id}
                session={session}
                repo={repo}
                project={project}
                gitStatus={gitStatuses[repo.id]}
                isActive={activeSessionId === session.id}
                isBusy={busySessionIds.has(session.id)}
                preview={previews[session.id]}
                onOpenSession={onOpenSession}
                onSessionDeleted={onSessionDeleted}
                onSessionRenamed={handleRowRenamed}
                onSessionBookmarkChanged={handleRowBookmarkChanged}
              />
            ))}
        </div>
      )}
    </div>
  )
}
