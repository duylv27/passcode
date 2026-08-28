import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import { PlusIcon, RepoIcon } from './icons'

interface Props {
  project: Project
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

export function RepoList({ project, selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setRepos(await window.api.repos.list(project.id))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setAdding(false)
    await refresh()
  }

  return (
    <div className="picker-group">
      <div className="picker-group-label">{project.name}</div>
      {repos.map((r) => (
        <button
          key={r.id}
          className={`picker-row${selectedRepo?.id === r.id ? ' is-selected' : ''}`}
          onClick={() => onSelectRepo(r)}
        >
          <RepoIcon className="row-icon is-repo" />
          <span>{r.name}</span>
        </button>
      ))}
      {adding ? (
        <div className="picker-inline-form">
          <input
            className="field"
            autoFocus
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              else if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => {
              if (!path.trim()) setAdding(false)
            }}
            placeholder="/path/to/repo"
          />
          <button className="btn" onClick={handleAdd}>
            Add
          </button>
        </div>
      ) : (
        <button className="picker-add-row" onClick={() => setAdding(true)}>
          <PlusIcon className="row-icon" />
          <span>Add repo</span>
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
