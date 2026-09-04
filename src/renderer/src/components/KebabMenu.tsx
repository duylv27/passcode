// src/renderer/src/components/KebabMenu.tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreIcon } from './icons'

export interface KebabMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

interface Props {
  items: KebabMenuItem[]
  /** Hover-revealed (only visible while the containing row is hovered) vs.
   * always visible -- set by the caller's CSS via this class. */
  triggerClassName?: string
  title?: string
}

export function KebabMenu({ items, triggerClassName, title }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, right: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  function openMenu(): void {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPosition({ top: rect.bottom + 2, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as Node
      if (triggerRef.current?.contains(target)) return
      if (dropdownRef.current && !dropdownRef.current.contains(target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div className="kebab-menu">
      <button
        type="button"
        ref={triggerRef}
        className={`kebab-menu-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          if (open) setOpen(false)
          else openMenu()
        }}
        title={title ?? 'More options'}
      >
        <MoreIcon />
      </button>
      {open &&
        createPortal(
          <div
            className="kebab-menu-dropdown"
            role="menu"
            ref={dropdownRef}
            style={{ top: position.top, right: position.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`kebab-menu-item${item.danger ? ' is-danger' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  item.onClick()
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
