// src/renderer/src/components/SessionTimeline.tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord, SessionWithScope } from '../../../shared/types'
import { SessionTimelineRow } from './SessionTimelineRow'
import { ChevronIcon } from './icons'

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
  const groups = new Map<string, SessionWithScope[]>()
  for (const entry of entries) {
    const label = dayLabel(entry.session.lastOpenedAt ?? entry.session.createdAt, now)
    const list = groups.get(label)
    if (list) list.push(entry)
    else groups.set(label, [entry])
  }
  const olderEntries = groups.get('Older Sessions') ?? []
  groups.delete('Older Sessions')

  return (
    <div className="tree-sessions">
      {entries.length === 0 && <div className="sidebar-empty">No sessions yet.</div>}
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
              onSessionRenamed={onSessionRenamed}
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
                onSessionRenamed={onSessionRenamed}
              />
            ))}
        </div>
      )}
    </div>
  )
}
