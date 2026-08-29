import { useEffect, useState } from 'react'
import { LogoIcon } from './icons'

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [])

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
        <LogoIcon className="about-logo" />
        <div className="about-name">PassCode</div>
        <div className="about-version">{version ? `Version ${version}` : 'Loading version…'}</div>
        <button className="about-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
