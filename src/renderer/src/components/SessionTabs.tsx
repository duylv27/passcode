import type { SessionRecord } from '../../../shared/types'
import { RepoIcon, ErrorIcon } from './icons'

interface Props {
  sessions: SessionRecord[]
  selected: SessionRecord | null
  onSelect: (session: SessionRecord) => void
  onClose: (session: SessionRecord) => void
}

/** The currently-open sessions for the selected repo, shown as editor-style
 * tabs. The full list of every session for a repo lives in the Explorer
 * tree (see SessionList) -- this only tracks what's been opened here. */
export function SessionTabs({ sessions, selected, onSelect, onClose }: Props): JSX.Element {
  return (
    <div className="tabs">
      {sessions.map((s) => (
        <div key={s.id} className={`tab${selected?.id === s.id ? ' is-active' : ''}`}>
          <button className="tab-select" onClick={() => onSelect(s)}>
            <RepoIcon />
            <span className="tab-title">{s.title}</span>
          </button>
          <button className="tab-close" onClick={() => onClose(s)} title="Close tab">
            <ErrorIcon />
          </button>
        </div>
      ))}
    </div>
  )
}
