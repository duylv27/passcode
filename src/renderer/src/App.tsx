import { useCallback, useState } from 'react'
import type { GitStatus, Repo, SessionRecord } from '../../shared/types'
import { ProjectTree } from './components/ProjectTree'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { ExplorerIcon, GearIcon, BranchIcon } from './components/icons'

type Activity = 'explorer' | 'settings'

export default function App(): JSX.Element {
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [openSessions, setOpenSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [branch, setBranch] = useState<GitStatus['branch'] | null>(null)

  function handleExplorerClick(): void {
    if (activity === 'explorer') {
      setSidebarCollapsed((collapsed) => !collapsed)
    } else {
      setActivity('explorer')
      setSidebarCollapsed(false)
    }
  }

  const handleTurnEnd = useCallback(() => setRefreshKey((k) => k + 1), [])

  function handleSelectRepo(repo: Repo): void {
    setSelectedRepo(repo)
    const tabsForRepo = openSessions.filter((s) => s.repoId === repo.id)
    setSelectedSession(tabsForRepo.length > 0 ? tabsForRepo[tabsForRepo.length - 1] : null)
  }

  function handleOpenSession(session: SessionRecord, repo: Repo): void {
    setSelectedRepo(repo)
    setOpenSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [...prev, session]))
    setSelectedSession(session)
  }

  function handleCloseTab(session: SessionRecord): void {
    const remaining = openSessions.filter((s) => s.id !== session.id)
    setOpenSessions(remaining)
    if (selectedSession?.id === session.id) {
      const remainingForRepo = remaining.filter((s) => s.repoId === session.repoId)
      setSelectedSession(remainingForRepo.length > 0 ? remainingForRepo[remainingForRepo.length - 1] : null)
    }
  }

  function handleSessionDeleted(session: SessionRecord): void {
    setOpenSessions((prev) => prev.filter((s) => s.id !== session.id))
    setSelectedSession((prev) => (prev?.id === session.id ? null : prev))
  }

  const sessionsForSelectedRepo = selectedRepo
    ? openSessions.filter((s) => s.repoId === selectedRepo.id)
    : []

  return (
    <div className="app-shell">
      <div className="workbench">
        <div className="activitybar">
          <button
            className={`activitybar-icon${activity === 'explorer' && !sidebarCollapsed ? ' is-active' : ''}`}
            onClick={handleExplorerClick}
            title={activity === 'explorer' && !sidebarCollapsed ? 'Hide Explorer' : 'Explorer'}
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
          <div className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
            <div className="sidebar-header">EXPLORER</div>
            <div className="sidebar-scroll">
              <ProjectTree
                selectedRepo={selectedRepo}
                selectedSession={selectedSession}
                onSelectRepo={handleSelectRepo}
                onOpenSession={handleOpenSession}
                onSessionDeleted={handleSessionDeleted}
              />
            </div>
          </div>
        )}

        <div className="editor-area">
          {activity === 'settings' ? (
            <SettingsPanel />
          ) : selectedRepo ? (
            <>
              <SessionTabs
                sessions={sessionsForSelectedRepo}
                selected={selectedSession}
                onSelect={setSelectedSession}
                onClose={handleCloseTab}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                {selectedSession ? (
                  <ChatPanel session={selectedSession} repoName={selectedRepo.name} onTurnEnd={handleTurnEnd} />
                ) : (
                  <div className="editor-empty">Pick or create a session for this repo in the sidebar</div>
                )}
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

      <ApprovalDialog />
    </div>
  )
}
