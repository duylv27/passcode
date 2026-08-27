import { useCallback, useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleTurnEnd = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 260, borderRight: '1px solid #333', overflowY: 'auto' }}>
        <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
        {selectedProject && (
          <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedRepo ? (
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
