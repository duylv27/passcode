import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import { RepoList } from './RepoList'
import { PlusIcon } from './icons'

interface Props {
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

/** A flat project/repo picker -- used inside the RepoSwitcher dropdown.
 * Sessions live in the sidebar's own flat list once a repo is picked, not
 * here, so this only needs to answer "which repo": every project's repos
 * are always visible (no expand/collapse) since these lists are short. */
export function ProjectTree({ selectedRepo, onSelectRepo }: Props): JSX.Element {
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
        <RepoList key={p.id} project={p} selectedRepo={selectedRepo} onSelectRepo={onSelectRepo} />
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
