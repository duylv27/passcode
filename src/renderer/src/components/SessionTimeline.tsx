// src/renderer/src/components/SessionTimeline.tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord, SessionWithScope } from '../../../shared/types'
import { SessionTimelineRow } from './SessionTimelineRow'
import { ChevronIcon, PlusIcon } from './icons'

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
  const [projects, setProjects] = useState<Project[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [olderCollapsed, setOlderCollapsed] = useState(() => readOlderCollapsed())

  async function refresh(): Promise<void> {
    const [sessionEntries, projectList] = await Promise.all([
      window.api.session.listAll(),
      window.api.projects.list()
    ])
    setEntries(sessionEntries)
    setProjects(projectList)
    setActiveProjectId((prev) => {
      if (prev && projectList.some((p) => p.id === prev)) return prev
      return sessionEntries[0]?.project?.id ?? sessionEntries[0]?.repo.projectId ?? projectList[0]?.id ?? null
    })

    const distinctRepos = new Map<string, Repo>()
    for (const entry of sessionEntries) distinctRepos.set(entry.repo.id, entry.repo)
    const statusEntries = await Promise.all(
      Array.from(distinctRepos.values()).map(
        async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const
      )
    )
    setGitStatuses(Object.fromEntries(statusEntries))
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

  async function handleNewSession(): Promise<void> {
    if (!activeProjectId) return
    const repos = await window.api.repos.list(activeProjectId)
    if (repos.length !== 1) return
    const created = await window.api.session.create(repos[0].id)
    const project = projects.find((p) => p.id === activeProjectId) ?? null
    onOpenSession(created, repos[0], project)
    refresh()
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
      <div className="session-timeline-chips">
        {projects.map((project) => (
          <button
            key={project.id}
            className={`session-timeline-chip${activeProjectId === project.id ? ' is-active' : ''}`}
            onClick={() => setActiveProjectId(project.id)}
          >
            {project.name}
          </button>
        ))}
        <button className="session-timeline-new-btn" onClick={handleNewSession} title="New session in active project">
          <PlusIcon />
        </button>
      </div>
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
              showTimestamp={label === 'Today' || label === 'Yesterday'}
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
                showTimestamp={false}
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
