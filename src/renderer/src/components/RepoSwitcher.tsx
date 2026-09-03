import { useEffect, useRef, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import { ProjectTree } from './ProjectTree'
import { ChevronIcon, PlusIcon, RepoIcon } from './icons'

export type Scope = { kind: 'repo'; repo: Repo } | { kind: 'project'; project: Project }

interface Props {
  scope: Scope | null
  onSelectRepo: (repo: Repo) => void
  onSelectProject: (project: Project) => void
  onCreateSession: () => void
}

/** A compact dropdown for picking what the sidebar's session list shows --
 * one repo, or a whole project spanning every repo in it. Projects/repos
 * are a picker, not permanent sidebar real estate, since sessions are what
 * you actually work in day to day. */
export function RepoSwitcher({ scope, onSelectRepo, onSelectProject, onCreateSession }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleSelectRepo(repo: Repo): void {
    onSelectRepo(repo)
    setOpen(false)
  }

  function handleSelectProject(project: Project): void {
    onSelectProject(project)
    setOpen(false)
  }

  const label = scope ? (scope.kind === 'project' ? `${scope.project.name} (project)` : scope.repo.name) : 'Select a repo'

  return (
    <div className="repo-switcher" ref={ref}>
      <button type="button" className="repo-switcher-trigger" onClick={() => setOpen((v) => !v)}>
        <RepoIcon className="row-icon is-repo" />
        <span className="repo-switcher-label">{label}</span>
        <ChevronIcon className={`repo-switcher-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div className="repo-switcher-menu">
          <ProjectTree scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
        </div>
      )}
      <button
        type="button"
        className="repo-switcher-add"
        onClick={onCreateSession}
        disabled={!scope}
        title="New session"
      >
        <PlusIcon />
      </button>
    </div>
  )
}
