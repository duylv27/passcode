// src/renderer/src/components/ProjectBox.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { SessionList } from './SessionList'
import { ChevronIcon, PlusIcon } from './icons'

interface Props {
  project: Project
  collapsed: boolean
  onToggleCollapse: (projectId: string) => void
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Bumped by ProjectExplorer's parent to force SessionList to refetch
   * after a session is created from outside this tree (e.g. the hamburger
   * menu's "New Session"). Combined with this box's own local refreshKey
   * so either trigger forces a remount. */
  externalRefreshKey: number
}

export function ProjectBox({
  project,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  externalRefreshKey
}: Props): JSX.Element {
  const [addingRepo, setAddingRepo] = useState(false)
  const [repoPath, setRepoPath] = useState('')
  const [repoError, setRepoError] = useState<string | null>(null)
  // Bumped to force SessionList to refetch after a repo is added here --
  // SessionList owns its own fetched repo/session lists and has no other
  // way to learn a new repo now exists.
  const [refreshKey, setRefreshKey] = useState(0)
  // A separate, lightweight fetch just to know the repo count -- a project
  // with exactly one repo collapses the project-scoped/repo-scoped
  // distinction into a single "+" action (see handleCreateSession below).
  const [repos, setRepos] = useState<Repo[]>([])

  useEffect(() => {
    window.api.repos.list(project.id).then(setRepos)
  }, [project.id, refreshKey, externalRefreshKey])

  const singleRepo = repos.length === 1 ? repos[0] : null

  async function handleCreateSession(): Promise<void> {
    if (singleRepo) {
      const created = await window.api.session.create(singleRepo.id)
      onOpenSession(created, singleRepo, null)
      setRefreshKey((k) => k + 1)
      return
    }
    const result = await window.api.session.createProjectSession(project.id)
    if (result.ok) {
      const projectRepos = await window.api.repos.list(project.id)
      const repo = projectRepos.find((r) => r.id === result.session.repoId)
      if (repo) {
        onOpenSession(result.session, repo, project)
      } else {
        setRepoError('Could not open the new session')
      }
    } else {
      setRepoError(result.error)
    }
    setRefreshKey((k) => k + 1)
  }

  async function handleAddRepo(): Promise<void> {
    if (!repoPath.trim()) return
    setRepoError(null)
    const result = await window.api.repos.add(project.id, repoPath.trim())
    if (!result.ok) {
      setRepoError(result.error)
      return
    }
    setRepoPath('')
    setAddingRepo(false)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="project-box">
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        <button
          className="project-box-add"
          onClick={handleCreateSession}
          title={singleRepo ? 'New session' : 'New project session'}
        >
          <PlusIcon />
        </button>
      </div>
      {!collapsed && (
        <>
          <SessionList
            key={`${refreshKey}-${externalRefreshKey}`}
            project={project}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onSessionDeleted={onSessionDeleted}
            onSessionRenamed={onSessionRenamed}
          />
          {addingRepo ? (
            <div className="picker-inline-form">
              <input
                className="field"
                autoFocus
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddRepo()
                  else if (e.key === 'Escape') setAddingRepo(false)
                }}
                onBlur={() => {
                  if (!repoPath.trim()) setAddingRepo(false)
                }}
                placeholder="/path/to/repo"
              />
              <button className="btn" onClick={handleAddRepo}>
                Add
              </button>
            </div>
          ) : (
            <button className="picker-add-row" onClick={() => setAddingRepo(true)}>
              <PlusIcon className="row-icon" />
              <span>Add repo</span>
            </button>
          )}
          {repoError && <div className="error-text">{repoError}</div>}
        </>
      )}
    </div>
  )
}
