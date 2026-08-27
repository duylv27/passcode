import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  selected: Project | null
  onSelect: (project: Project) => void
}

export function ProjectList({ selected, onSelect }: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(): Promise<void> {
    if (!name.trim()) return
    await window.api.projects.create(name)
    setName('')
    await refresh()
  }

  return (
    <div className="rail-section rail">
      {projects.map((p) => (
        <button
          key={p.id}
          className={`rail-node is-project${selected?.id === p.id ? ' is-selected' : ''}`}
          onClick={() => onSelect(p)}
        >
          {p.name}
        </button>
      ))}
      <div className="rail-add">
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
