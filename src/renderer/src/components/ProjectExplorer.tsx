// src/renderer/src/components/ProjectExplorer.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ProjectBox } from './ProjectBox'
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

/** The sidebar's top-level content: every project, always visible, each a
 * collapsible box (default collapsed) -- no scope selection required to
 * browse or open any session. Replaces RepoSwitcher + the old scoped
 * SessionList together. */
export function ProjectExplorer({
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  refreshKey
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  const [addingProject, setAddingProject] = useState(false)
  const [projectName, setProjectName] = useState('')

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function toggleCollapse(projectId: string): void {
    setCollapsed((prev) => {
      // New projects default to collapsed: `prev[projectId] ?? true` is
      // truthy (collapsed) whenever there's no stored entry yet, so the
      // very first toggle correctly flips to expanded (`false`).
      const next = { ...prev, [projectId]: !(prev[projectId] ?? true) }
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  async function handleCreateProject(): Promise<void> {
    if (!projectName.trim()) return
    await window.api.projects.create(projectName.trim())
    setProjectName('')
    setAddingProject(false)
    await refresh()
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
          externalRefreshKey={refreshKey}
        />
      ))}
      {addingProject ? (
        <div className="picker-inline-form">
          <input
            className="field"
            autoFocus
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProject()
              else if (e.key === 'Escape') setAddingProject(false)
            }}
            onBlur={() => {
              if (!projectName.trim()) setAddingProject(false)
            }}
            placeholder="Project name"
          />
          <button className="btn" onClick={handleCreateProject}>
            Add
          </button>
        </div>
      ) : (
        <button className="picker-add-row is-project" onClick={() => setAddingProject(true)}>
          <PlusIcon className="row-icon" />
          <span>New project</span>
        </button>
      )}
      {projects.length === 0 && !addingProject && (
        <div className="sidebar-empty">No projects yet. Add one below.</div>
      )}
    </div>
  )
}
