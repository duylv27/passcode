// src/renderer/src/components/ProjectBox.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { SessionList } from './SessionList'
import { ChevronIcon, EditIcon, InfoIcon, PlusIcon, RepoPlusIcon, TrashIcon } from './icons'
import { ProjectInfoDialog } from './ProjectInfoDialog'

interface Props {
  project: Project
  collapsed: boolean
  onToggleCollapse: (projectId: string) => void
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Called after this project is renamed or deleted so ProjectExplorer
   * can refetch its project list. */
  onProjectChanged: () => void
  /** Called after this project is deleted, with the ids of the repos it
   * contained, so App can prune any open session tabs belonging to them. */
  onProjectDeleted: (repoIds: string[]) => void
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
  onProjectChanged,
  onProjectDeleted,
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
  const [infoOpen, setInfoOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(project.name)

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

  async function handleAddRepoClick(): Promise<void> {
    setAddingRepo(true)
    setRepoError(null)
    await handleChooseRepoFolder()
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

  function startRenameProject(): void {
    setNameValue(project.name)
    setEditingName(true)
  }

  async function commitRenameProject(): Promise<void> {
    const trimmed = nameValue.trim()
    setEditingName(false)
    if (!trimmed || trimmed === project.name) return
    await window.api.projects.rename(project.id, trimmed)
    onProjectChanged()
  }

  async function handleDeleteProject(): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${project.name}"? This also removes its repo(s) and every session in them.`
    )
    if (!confirmed) return
    const projectRepos = await window.api.repos.list(project.id)
    await window.api.projects.delete(project.id)
    onProjectDeleted(projectRepos.map((r) => r.id))
    onProjectChanged()
  }

  return (
    <div className="project-box">
      <div className="project-box-header">
        {editingName ? (
          <input
            className="field project-box-name-field"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRenameProject}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
            <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
            <span className="project-box-label">{project.name}</span>
          </button>
        )}
        <button className="project-box-add-repo" onClick={handleAddRepoClick} title="Add repo">
          <RepoPlusIcon />
        </button>
        <button className="project-box-info" onClick={() => setInfoOpen(true)} title="Project info">
          <InfoIcon />
        </button>
        <button className="project-box-rename" onClick={startRenameProject} title="Rename project">
          <EditIcon />
        </button>
        <button className="project-box-delete" onClick={handleDeleteProject} title="Delete project">
          <TrashIcon />
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
      </div>
      {infoOpen && <ProjectInfoDialog project={project} onClose={() => setInfoOpen(false)} />}
      {addingRepo && (
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
      )}
      {repoError && <div className="error-text">{repoError}</div>}
      {!collapsed && (
        <SessionList
          key={`${refreshKey}-${externalRefreshKey}`}
          project={project}
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          onSessionDeleted={onSessionDeleted}
          onSessionRenamed={onSessionRenamed}
        />
      )}
    </div>
  )
}
