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
    <div>
      <h3>Projects</h3>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              style={{ fontWeight: selected?.id === p.id ? 'bold' : 'normal' }}
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" />
      <button onClick={handleCreate}>Add</button>
    </div>
  )
}
