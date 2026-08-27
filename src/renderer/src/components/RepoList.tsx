import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'

interface Props {
  project: Project
  selected: Repo | null
  onSelect: (repo: Repo) => void
}

export function RepoList({ project, selected, onSelect }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setRepos(await window.api.repos.list(project.id))
  }

  useEffect(() => {
    refresh()
  }, [project.id])

  async function handleAdd(): Promise<void> {
    if (!path.trim()) return
    setError(null)
    const result = await window.api.repos.add(project.id, path.trim())
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPath('')
    await refresh()
  }

  return (
    <div>
      <h4>Repos in {project.name}</h4>
      <ul>
        {repos.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onSelect(r)}
              style={{ fontWeight: selected?.id === r.id ? 'bold' : 'normal' }}
            >
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/repo" />
      <button onClick={handleAdd}>Add repo</button>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  )
}
