// src/renderer/src/components/TabContextMenu.tsx
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface TabContextMenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

interface Props {
  x: number
  y: number
  items: TabContextMenuItem[]
  onClose: () => void
}

/** A right-click context menu positioned at arbitrary screen coordinates
 * (not tied to a trigger button, unlike KebabMenu) -- portal-rendered so it
 * escapes the tab strip's own layout entirely. */
export function TabContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handlePointerDown(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="kebab-menu-dropdown" role="menu" ref={ref} style={{ top: y, left: x }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={`kebab-menu-item${item.danger ? ' is-danger' : ''}`}
          onClick={() => {
            onClose()
            item.onClick()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
