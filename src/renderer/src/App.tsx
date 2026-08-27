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
    <div style={{ display: 'flex', height: '100vh' }}>
      <div
        style={{
          width: 260,
          borderRight: '1px solid #333',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div style={{ flex: 1 }}>
          <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
          {selectedProject && (
            <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
          )}
        </div>
        <button onClick={() => setShowSettings((s) => !s)}>
          {showSettings ? 'Close Settings' : 'Settings'}
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
          <div style={{ padding: 16 }}>Select a repo to start a session.</div>
        )}
      </div>
    </div>
  )
}
