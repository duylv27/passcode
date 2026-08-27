import { useCallback, useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'
import { SettingsPanel } from './components/SettingsPanel'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  const handleTurnEnd = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="sidebar-brand">
          <span className="pi-mark">π</span>
          <span>AGENT DESKTOP</span>
        </div>
        <div className="sidebar-scroll">
          <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
          {selectedProject && (
            <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
          )}
        </div>
        <button
          className={`rail-node${showSettings ? ' is-selected' : ''}`}
          style={{ borderTop: '1px solid var(--border)', paddingLeft: 16 }}
          onClick={() => setShowSettings((s) => !s)}
        >
          Settings
        </button>
      </div>
      <div className="main">
        {showSettings ? (
          <SettingsPanel />
        ) : selectedRepo ? (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel repo={selectedRepo} onTurnEnd={handleTurnEnd} />
            </div>
            <GitStatusPanel repo={selectedRepo} refreshKey={refreshKey} />
          </>
        ) : (
          <div className="main-empty">Select a repo to start a session</div>
        )}
      </div>
    </div>
  )
}
