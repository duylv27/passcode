import { useState } from 'react'
import type { SessionRecord } from '../../../shared/types'
import { RepoIcon, ErrorIcon, PinIcon } from './icons'
import { TabContextMenu } from './TabContextMenu'

interface Props {
  sessions: SessionRecord[]
  selected: SessionRecord | null
  pinnedIds: Set<string>
  onSelect: (session: SessionRecord) => void
  onClose: (session: SessionRecord) => void
  onCloseOthers: (session: SessionRecord) => void
  onCloseAll: () => void
  onTogglePin: (session: SessionRecord) => void
}

/** Every currently-open session across every project, shown as editor-style
 * tabs -- not filtered by project/repo. The full list of a project's
 * sessions lives in the sidebar's ProjectBox/SessionList tree; this only
 * tracks what's been opened as a tab. */
export function SessionTabs({
  sessions,
  selected,
  pinnedIds,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  onTogglePin
}: Props): JSX.Element {
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionRecord } | null>(null)

  return (
    <div className="tabs">
      {sessions.map((s) => {
        const pinned = pinnedIds.has(s.id)
        return (
          <div
            key={s.id}
            className={`tab${selected?.id === s.id ? ' is-active' : ''}`}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, session: s })
            }}
          >
            <button className="tab-select" onClick={() => onSelect(s)}>
              {pinned ? <PinIcon className="row-icon is-pinned" /> : <RepoIcon />}
              <span className="tab-title">{s.title}</span>
            </button>
            <button className="tab-close" onClick={() => onClose(s)} title="Close tab">
              <ErrorIcon />
            </button>
          </div>
        )
      })}
      {menu && (
        <TabContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Close', onClick: () => onClose(menu.session) },
            {
              label: 'Close Others',
              onClick: () => onCloseOthers(menu.session),
              disabled: sessions.length <= 1
            },
            { label: 'Close All', onClick: onCloseAll, disabled: sessions.length === 0 },
            {
              label: pinnedIds.has(menu.session.id) ? 'Unpin' : 'Pin',
              onClick: () => onTogglePin(menu.session)
            }
          ]}
        />
      )}
    </div>
  )
}
