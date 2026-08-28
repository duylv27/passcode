import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ChevronIcon, RepoIcon } from './icons'
import { SessionList } from './SessionList'

interface Props {
  project: Project
  selectedRepo: Repo | null
  selectedSession: SessionRecord | null
  onSelectRepo: (repo: Repo) => void
  onOpenSession: (session: SessionRecord, repo: Repo) => void
  onSessionDeleted: (session: SessionRecord) => void
}

export function RepoList({
  project,
  selectedRepo,
  selectedSession,
  onSelectRepo,
  onOpenSession,
  onSessionDeleted
}: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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

  function handleRepoClick(r: Repo): void {
    const wasSelected = selectedRepo?.id === r.id
    onSelectRepo(r)
    setExpanded((prev) => {
      const next = new Set(prev)
      const isOpen = next.has(r.id)
      if (wasSelected && isOpen) next.delete(r.id)
      else next.add(r.id)
      return next
    })
  }

  return (
    <div>
      {repos.map((r) => {
        const isOpen = expanded.has(r.id)
        return (
          <div key={r.id}>
            <button
              className={`tree-row${selectedRepo?.id === r.id ? ' is-selected' : ''}`}
              onClick={() => handleRepoClick(r)}
            >
              <ChevronIcon className={`chevron${isOpen ? ' is-open' : ''}`} />
              <RepoIcon className="row-icon is-repo" />
              <span>{r.name}</span>
            </button>
            {isOpen && (
              <SessionList
                repo={r}
                activeSessionId={selectedRepo?.id === r.id ? (selectedSession?.id ?? undefined) : undefined}
                onOpenSession={(session) => onOpenSession(session, r)}
                onSessionDeleted={onSessionDeleted}
              />
            )}
          </div>
        )
      })}
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
