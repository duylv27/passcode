import { useEffect, useState } from 'react'
import { CloseIcon, MaximizeIcon, MenuIcon, MinimizeIcon, RestoreIcon } from './icons'

interface Props {
  onOpenMenu?: () => void
  menuButtonRef?: (el: HTMLButtonElement | null) => void
}

export function TitleBar({ onOpenMenu, menuButtonRef }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      <button className="titlebar-btn" ref={menuButtonRef} onClick={onOpenMenu} title="Menu">
        <MenuIcon />
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
