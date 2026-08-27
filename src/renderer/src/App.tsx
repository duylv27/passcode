import { useCallback, useState } from 'react'
import type { GitStatus, Repo } from '../../shared/types'
import { ProjectTree } from './components/ProjectTree'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ExplorerIcon, GearIcon, RepoIcon, BranchIcon } from './components/icons'

type Activity = 'explorer' | 'settings'

export default function App(): JSX.Element {
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activity, setActivity] = useState<Activity>('explorer')
  const [branch, setBranch] = useState<GitStatus['branch'] | null>(null)

  const handleTurnEnd = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div className="app-shell">
      <div className="workbench">
        <div className="activitybar">
          <button
            className={`activitybar-icon${activity === 'explorer' ? ' is-active' : ''}`}
            onClick={() => setActivity('explorer')}
            title="Explorer"
          >
            <ExplorerIcon />
          </button>
          <div className="activitybar-spacer" />
          <button
            className={`activitybar-icon${activity === 'settings' ? ' is-active' : ''}`}
            onClick={() => setActivity('settings')}
            title="Settings"
          >
            <GearIcon />
          </button>
        </div>

        {activity === 'explorer' && (
          <div className="sidebar">
            <div className="sidebar-header">EXPLORER</div>
            <div className="sidebar-scroll">
              <ProjectTree selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />
            </div>
          </div>
        )}

        <div className="editor-area">
          {activity === 'settings' ? (
            <SettingsPanel />
          ) : selectedRepo ? (
            <>
              <div className="tabs">
                <div className="tab">
                  <RepoIcon />
                  <span>{selectedRepo.name}</span>
                </div>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <ChatPanel repo={selectedRepo} onTurnEnd={handleTurnEnd} />
              </div>
              <GitStatusPanel repo={selectedRepo} refreshKey={refreshKey} onStatus={setBranch} />
            </>
          ) : (
            <div className="editor-empty">Select a repo to start a session</div>
          )}
        </div>
      </div>

      <div className="statusbar">
        {selectedRepo && branch && (
          <div className="statusbar-item">
            <BranchIcon />
            <span>{branch}</span>
          </div>
        )}
        {selectedRepo && <div className="statusbar-item">{selectedRepo.name}</div>}
      </div>
    </div>
  )
}
