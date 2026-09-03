import type { SessionRecord } from '../../../shared/types'
import { RepoIcon, ErrorIcon } from './icons'

interface Props {
  sessions: SessionRecord[]
  selected: SessionRecord | null
  onSelect: (session: SessionRecord) => void
  onClose: (session: SessionRecord) => void
}

/** Every currently-open session across every project, shown as editor-style
 * tabs -- not filtered by project/repo. The full list of a project's
 * sessions lives in the sidebar's ProjectBox/SessionList tree; this only
 * tracks what's been opened as a tab. */
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
