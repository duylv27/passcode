// src/renderer/src/components/ProjectExplorer.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ProjectBox } from './ProjectBox'
import { NewProjectDialog } from './NewProjectDialog'
import { SessionTimeline } from './SessionTimeline'
import { PlusIcon } from './icons'

interface Props {
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Called after a project is deleted, with the ids of the repos it
   * contained, so App can prune any open session tabs belonging to them. */
  onProjectDeleted: (repoIds: string[]) => void
  /** Bumped by the parent to force a refetch after a session is created
   * from outside this tree (e.g. the hamburger menu's "New Session"). */
  refreshKey: number
  /** Which top-level view to show -- controlled entirely by App's
   * activitybar icons and Go menu (no in-sidebar switcher). */
  view: 'sessions' | 'projects'
}

const COLLAPSED_STORAGE_KEY = 'passcode-project-boxes'

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function ProjectExplorer({
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  onProjectDeleted,
  refreshKey,
  view
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  // See SessionTimeline.tsx's identical field -- avoids flashing "No
  // projects yet." before the first fetch has actually resolved.
  const [loading, setLoading] = useState(true)

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function toggleCollapse(projectId: string): void {
    setCollapsed((prev) => {
      const next = { ...prev, [projectId]: !(prev[projectId] ?? true) }
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  return (
    <div className="explorer-root">
      {/* Both branches stay mounted and are toggled via `hidden` rather than
          conditionally rendered -- unmounting whichever view isn't active
          used to drop its already-fetched data (and its own loading guard)
          every time you switched, so switching back re-triggered the exact
          empty-state flash the loading guards were added to prevent. */}
      <div hidden={view !== 'sessions'}>
        <SessionTimeline
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          onSessionDeleted={onSessionDeleted}
          onSessionRenamed={onSessionRenamed}
          refreshKey={refreshKey}
        />
      </div>
      <div className="tree-sessions" hidden={view !== 'projects'}>
        {projects.map((project) => (
          <ProjectBox
            key={project.id}
            project={project}
            collapsed={collapsed[project.id] ?? true}
            onToggleCollapse={toggleCollapse}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onSessionDeleted={onSessionDeleted}
            onSessionRenamed={onSessionRenamed}
            onProjectChanged={refresh}
            onProjectDeleted={onProjectDeleted}
            externalRefreshKey={refreshKey}
          />
        ))}
        <button className="picker-add-row is-project" onClick={() => setNewProjectOpen(true)}>
          <PlusIcon className="row-icon" />
          <span>New project</span>
        </button>
        {!loading && projects.length === 0 && (
          <div className="sidebar-empty">No projects yet. Add one above.</div>
        )}
        {newProjectOpen && (
          <NewProjectDialog
            onClose={() => setNewProjectOpen(false)}
            onCreated={() => {
              setNewProjectOpen(false)
              refresh()
            }}
          />
        )}
      </div>
    </div>
  )
}
