import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import type { Scope } from './RepoSwitcher'
import { RepoList } from './RepoList'
import { PlusIcon } from './icons'

interface Props {
  scope: Scope | null
  onSelectRepo: (repo: Repo) => void
  onSelectProject: (project: Project) => void
}

/** A flat project/repo picker -- used inside the RepoSwitcher dropdown.
 * Sessions live in the sidebar's own flat list once something's picked, not
 * here, so this only needs to answer "which repo, or which whole project":
 * every project's repos are always visible (no expand/collapse) since these
 * lists are short. */
export function ProjectTree({ scope, onSelectRepo, onSelectProject }: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(): Promise<void> {
    if (!name.trim()) return
    await window.api.projects.create(name.trim())
    setName('')
    setAdding(false)
    await refresh()
  }

  return (
    <div className="picker">
      {projects.map((p) => (
        <div key={p.id} className="picker-group">
          <button
            className={`picker-group-label is-clickable${scope?.kind === 'project' && scope.project.id === p.id ? ' is-selected' : ''}`}
            onClick={() => onSelectProject(p)}
            title="Open this project's sessions (spans every repo in it)"
          >
            {p.name}
          </button>
          <RepoList
            project={p}
            selectedRepo={scope?.kind === 'repo' ? scope.repo : null}
            onSelectRepo={onSelectRepo}
          />
        </div>
      ))}
      {adding ? (
        <div className="picker-inline-form">
          <input
            className="field"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate()
              else if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => {
              if (!name.trim()) setAdding(false)
            }}
            placeholder="Project name"
          />
          <button className="btn" onClick={handleCreate}>
            Add
          </button>
        </div>
      ) : (
        <button className="picker-add-row is-project" onClick={() => setAdding(true)}>
          <PlusIcon className="row-icon" />
          <span>New project</span>
        </button>
      )}
    </div>
  )
}
