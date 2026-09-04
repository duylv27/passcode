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
  const [repoPath, setRepoPath] = useState<string | null>(null)
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

  // Project-wide session creation no longer exists -- every session is
  // repo-scoped, so this header action only makes sense (and only shows,
  // see the JSX below) when there's exactly one unambiguous repo to create
  // it in.
  async function handleCreateSession(repo: Repo): Promise<void> {
    const created = await window.api.session.create(repo.id)
    onOpenSession(created, repo, null)
    setRefreshKey((k) => k + 1)
  }

  async function handleChooseRepoFolder(): Promise<void> {
    const picked = await window.api.files.pickFolder()
    if (picked) setRepoPath(picked)
  }

  async function handleAddRepo(): Promise<void> {
    if (!repoPath) return
    setRepoError(null)
    const result = await window.api.repos.add(project.id, repoPath)
    if (!result.ok) {
      setRepoError(result.error)
      return
    }
    setRepoPath(null)
    setAddingRepo(false)
    setRefreshKey((k) => k + 1)
  }

  function cancelAddRepo(): void {
    setRepoPath(null)
    setRepoError(null)
    setAddingRepo(false)
  }

  return (
    <div className="project-box">
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
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
              {repoPath ? (
                <>
                  <span className="new-project-folder-path" title={repoPath}>
                    {repoPath}
                  </span>
                  <button className="btn" onClick={handleAddRepo}>
                    Add
                  </button>
                </>
              ) : (
                <button className="btn" onClick={handleChooseRepoFolder}>
                  Choose folder…
                </button>
              )}
              <button className="btn" onClick={cancelAddRepo}>
                Cancel
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
