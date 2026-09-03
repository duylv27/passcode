import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo } from '../../../shared/types'
import { PlusIcon, RepoIcon } from './icons'

interface Props {
  project: Project
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

export function RepoList({ project, selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const list = await window.api.repos.list(project.id)
    setRepos(list)
    const entries = await Promise.all(
      list.map(
        async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const
      )
    )
    setGitStatuses(Object.fromEntries(entries))
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
    <>
      {repos.map((r) => {
        const status = gitStatuses[r.id]
        return (
          <button
            key={r.id}
            className={`picker-row${selectedRepo?.id === r.id ? ' is-selected' : ''}`}
            onClick={() => onSelectRepo(r)}
          >
            <RepoIcon className="row-icon is-repo" />
            <span className="picker-row-name">{r.name}</span>
            {status && (
              <span className="picker-row-git">
                {status.branch && <span className="picker-row-branch">{status.branch}</span>}
                <span className={`repo-status-dot${status.dirty ? ' is-dirty' : ''}`} />
              </span>
            )}
          </button>
        )
      })}
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
    </>
  )
}
