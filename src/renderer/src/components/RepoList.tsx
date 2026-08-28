import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'
import { RepoIcon } from './icons'

interface Props {
  project: Project
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

export function RepoList({ project, selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
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
    await refresh()
  }

  return (
    <div>
      {repos.map((r) => (
        <button
          key={r.id}
          className={`tree-row${selectedRepo?.id === r.id ? ' is-selected' : ''}`}
          onClick={() => onSelectRepo(r)}
        >
          <RepoIcon className="row-icon is-repo" />
          <span>{r.name}</span>
        </button>
      ))}
      <div className="tree-add">
        <input
          className="field"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd()
          }}
          placeholder="/path/to/repo"
        />
        <button className="btn" onClick={handleAdd}>
          Add
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
