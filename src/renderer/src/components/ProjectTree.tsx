import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import { RepoList } from './RepoList'
import { ChevronIcon, FolderIcon } from './icons'

interface Props {
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

export function ProjectTree({ selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(): Promise<void> {
    if (!name.trim()) return
    const project = await window.api.projects.create(name)
    setName('')
    setExpanded((prev) => new Set(prev).add(project.id))
    await refresh()
  }

  function toggle(projectId: string): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  return (
    <div>
      {projects.map((p) => {
        const isOpen = expanded.has(p.id)
        return (
          <div key={p.id}>
            <button className="tree-row" onClick={() => toggle(p.id)}>
              <ChevronIcon className={`chevron${isOpen ? ' is-open' : ''}`} />
              <FolderIcon className="row-icon" />
              <span>{p.name}</span>
            </button>
            {isOpen && (
              <div className="tree-repos">
                <RepoList project={p} selected={selectedRepo} onSelect={onSelectRepo} />
              </div>
            )}
          </div>
        )
      })}
      <div className="tree-add is-project">
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
          }}
          placeholder="New project"
        />
        <button className="btn" onClick={handleCreate}>
          Add
        </button>
      </div>
    </div>
  )
}
