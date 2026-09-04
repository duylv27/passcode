// src/renderer/src/components/ProjectExplorer.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ProjectBox } from './ProjectBox'
import { NewProjectDialog } from './NewProjectDialog'
import { PlusIcon } from './icons'

interface Props {
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Bumped by the parent to force a refetch after a session is created
   * from outside this tree (e.g. the hamburger menu's "New Session"). */
  refreshKey: number
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
  refreshKey
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
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
    <div className="tree-sessions">
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
          externalRefreshKey={refreshKey}
        />
      ))}
      <button className="picker-add-row is-project" onClick={() => setNewProjectOpen(true)}>
        <PlusIcon className="row-icon" />
        <span>New project</span>
      </button>
      {projects.length === 0 && <div className="sidebar-empty">No projects yet. Add one below.</div>}
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
  )
}
