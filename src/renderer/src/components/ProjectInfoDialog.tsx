import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo } from '../../../shared/types'

interface Props {
  project: Project
  onClose: () => void
}

export function ProjectInfoDialog({ project, onClose }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const repoList = await window.api.repos.list(project.id)
        if (cancelled) return
        setRepos(repoList)
        const statusEntries = await Promise.all(
          repoList.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const)
        )
        if (cancelled) return
        setGitStatuses(Object.fromEntries(statusEntries))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [project.id])

  return (
    <div className="project-info-overlay" onClick={onClose}>
      <div className="project-info-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="project-info-title">{project.name}</div>
        {loading && <div className="sidebar-empty">Loading…</div>}
        {!loading && repos.length === 0 && <div className="sidebar-empty">No repos in this project.</div>}
        {repos.map((repo) => {
          const status = gitStatuses[repo.id]
          return (
            <div key={repo.id} className="project-info-repo">
              <div className="project-info-repo-name">
                <span
                  className={`repo-status-dot${status ? (status.dirty ? ' is-dirty' : '') : ' is-unknown'}`}
                  title={status?.branch ?? undefined}
                />
                {repo.name}
              </div>
              <div className="project-info-repo-path">{repo.path}</div>
              <div className="project-info-repo-branch">
                {status?.branch ? `${status.branch} · ${status.dirty ? 'dirty' : 'clean'}` : 'No git status available'}
              </div>
            </div>
          )
        })}
        <button className="btn project-info-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
