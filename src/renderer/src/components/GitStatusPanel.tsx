import { useEffect, useState } from 'react'
import type { GitStatus, Repo } from '../../../shared/types'

interface Props {
  repo: Repo
  refreshKey: number
}

export function GitStatusPanel({ repo, refreshKey }: Props): JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setError(null)
    window.api.git.status(repo.id).then(
      (result) => {
        if (!cancelled) setStatus(result)
      },
      () => {
        if (!cancelled) setError('Could not load git status')
      }
    )
    return () => {
      cancelled = true
    }
  }, [repo.id, refreshKey])

  if (error) return <div className="git-status git-status-error">{error}</div>

  if (!status) return <div className="git-status git-status-loading">Loading git status…</div>

  const hasChanges = status.changed.length + status.added.length + status.deleted.length > 0

  return (
    <div className="git-status">
      <div className="git-status-branch">
        <span className="branch-dot" />
        <strong>{status.branch}</strong>
        {!hasChanges && <span>— clean</span>}
      </div>
      <FileGroup label="~" kind="changed" files={status.changed} />
      <FileGroup label="+" kind="added" files={status.added} />
      <FileGroup label="-" kind="deleted" files={status.deleted} />
    </div>
  )
}

function FileGroup({
  label,
  kind,
  files
}: {
  label: string
  kind: 'changed' | 'added' | 'deleted'
  files: string[]
}): JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div className="git-status-group">
      {files.map((f) => (
        <div key={f} className={`git-status-file is-${kind}`}>
          <span className="gutter">{label}</span>
          <span>{f}</span>
        </div>
      ))}
    </div>
  )
}
