import { useEffect, useRef, useState } from 'react'
import type { Repo } from '../../../shared/types'
import { ProjectTree } from './ProjectTree'
import { ChevronIcon, RepoIcon } from './icons'

interface Props {
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

/** A compact dropdown for picking which repo the sidebar's session list
 * shows -- projects/repos are a picker, not permanent sidebar real estate,
 * since sessions are what you actually work in day to day. */
export function RepoSwitcher({ selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  function handleSelect(repo: Repo): void {
    onSelectRepo(repo)
    setOpen(false)
  }

  return (
    <div className="repo-switcher" ref={ref}>
      <button type="button" className="repo-switcher-trigger" onClick={() => setOpen((v) => !v)}>
        <RepoIcon className="row-icon is-repo" />
        <span className="repo-switcher-label">{selectedRepo ? selectedRepo.name : 'Select a repo'}</span>
        <ChevronIcon className={`repo-switcher-chevron${open ? ' is-open' : ''}`} />
      </button>
      {open && (
        <div className="repo-switcher-menu">
          <ProjectTree selectedRepo={selectedRepo} onSelectRepo={handleSelect} />
        </div>
      )}
    </div>
  )
}
