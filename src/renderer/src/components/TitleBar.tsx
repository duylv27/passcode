import { useEffect, useRef, useState } from 'react'
import { CloseIcon, LogoIcon, MaximizeIcon, MenuIcon, MinimizeIcon, RestoreIcon } from './icons'

export interface TitleBarMenuActions {
  newSession?: () => void
  closeTab?: () => void
  quit?: () => void
  toggleSidebar?: () => void
  goExplorer?: () => void
  goProjectView?: () => void
  goSessionView?: () => void
  goSettings?: () => void
  nextTab?: () => void
  previousTab?: () => void
  showAbout?: () => void
}

interface MenuItem {
  label: string
  kbd?: string
  action?: () => void
}

function buildMenu(actions: TitleBarMenuActions): { category: string; items: MenuItem[] }[] {
  return [
    {
      category: 'File',
      items: [
        { label: 'New Session', kbd: 'Ctrl+N', action: actions.newSession },
        { label: 'Close Tab', kbd: 'Ctrl+W', action: actions.closeTab },
        { label: 'Quit', kbd: 'Alt+F4', action: actions.quit }
      ]
    },
    {
      category: 'View',
      items: [{ label: 'Toggle Sidebar', kbd: 'Ctrl+B', action: actions.toggleSidebar }]
    },
    {
      category: 'Go',
      items: [
        { label: 'Explorer', action: actions.goExplorer },
        { label: 'Project View', action: actions.goProjectView },
        { label: 'Session View', action: actions.goSessionView },
        { label: 'Settings', action: actions.goSettings },
        { label: 'Next Tab', kbd: 'Ctrl+Tab', action: actions.nextTab },
        { label: 'Previous Tab', kbd: 'Ctrl+Shift+Tab', action: actions.previousTab }
      ]
    },
    {
      category: 'Window',
      items: [
        { label: 'Minimize', action: () => window.api.window.minimize() },
        { label: 'Maximize/Restore', action: () => window.api.window.toggleMaximize() },
        { label: 'Close', action: () => window.api.window.close() }
      ]
    },
    {
      category: 'Help',
      items: [{ label: 'About PassCode', action: actions.showAbout }]
    }
  ]
}

interface Props {
  menuActions: TitleBarMenuActions
  onGoHome: () => void
}

export function TitleBar({ menuActions, onGoHome }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function runAction(action?: () => void): void {
    setMenuOpen(false)
    action?.()
  }

  return (
    <div className="titlebar">
      <div className="titlebar-menu" ref={menuRef}>
        <button className="titlebar-btn" onClick={() => setMenuOpen((v) => !v)} title="Menu">
          <MenuIcon />
        </button>
        {menuOpen && (
          <div className="titlebar-menu-dropdown" role="menu">
            {buildMenu(menuActions).map((group) => (
              <div key={group.category} className="titlebar-menu-group">
                <div className="titlebar-menu-category">{group.category}</div>
                {group.items.map((item) => (
                  <button
                    key={item.label}
                    className="titlebar-menu-item"
                    disabled={!item.action}
                    onClick={() => runAction(item.action)}
                  >
                    <span>{item.label}</span>
                    {item.kbd && <span className="titlebar-menu-kbd">{item.kbd}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="titlebar-home" onClick={onGoHome} title="Back to home">
        <LogoIcon />
        <span>PassCode</span>
      </button>
      <div className="titlebar-drag" />
      <div className="titlebar-winctrls">
        <button className="titlebar-winbtn" onClick={() => window.api.window.minimize()} title="Minimize">
          <MinimizeIcon />
        </button>
        <button className="titlebar-winbtn" onClick={() => window.api.window.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="titlebar-winbtn is-close" onClick={() => window.api.window.close()} title="Close">
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
