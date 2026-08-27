import { useEffect, useState } from 'react'
import type { GitStatus, Repo } from '../../../shared/types'

interface Props {
  repo: Repo
  refreshKey: number
}

export function GitStatusPanel({ repo, refreshKey }: Props): JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    window.api.git.status(repo.id).then(setStatus)
  }, [repo.id, refreshKey])

  if (!status) return <div style={{ padding: 8 }}>Loading git status...</div>

  return (
    <div style={{ padding: 8, borderTop: '1px solid #333' }}>
      <div>
        Branch: <strong>{status.branch}</strong>
      </div>
      <StatusList label="Changed" files={status.changed} />
      <StatusList label="Added" files={status.added} />
      <StatusList label="Deleted" files={status.deleted} />
    </div>
  )
}

function StatusList({ label, files }: { label: string; files: string[] }): JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div>
      {label}:
      <ul>
        {files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}
