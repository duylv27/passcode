import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Project, Repo, SessionRecord, SessionWithScope } from '../../shared/types'
import { ProjectExplorer } from './components/ProjectExplorer'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { TitleBar } from './components/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { ChatIcon, ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY } from './lib/sidebarWidth'

export default function App(): JSX.Element {
  const [openSessions, setOpenSessions] = useState<SessionWithScope[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionWithScope | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      return raw ? clampSidebarWidth(Number(raw)) : SIDEBAR_DEFAULT_WIDTH
    } catch {
      return SIDEBAR_DEFAULT_WIDTH
    }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [explorerView, setExplorerView] = useState<'sessions' | 'projects'>('sessions')
  // Bumped to force ProjectExplorer to refetch after a session is created
  // from outside its own tree (the hamburger menu's "New Session" action).
  const [sessionListRefreshKey, setSessionListRefreshKey] = useState(0)

  function handleExplorerClick(): void {
    setSidebarCollapsed((collapsed) => !collapsed)
  }

  function handleGoProjectsView(): void {
    setSidebarCollapsed(false)
    setExplorerView('projects')
  }

  function handleGoSessionsView(): void {
    setSidebarCollapsed(false)
    setExplorerView('sessions')
  }

  function handleSidebarResizeStart(e: ReactPointerEvent<HTMLDivElement>): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth
    let latestWidth = startWidth
    function handleMove(moveEvent: PointerEvent): void {
      latestWidth = clampSidebarWidth(startWidth + (moveEvent.clientX - startX))
      setSidebarWidth(latestWidth)
    }
    function handleUp(): void {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(latestWidth))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  // Land on whatever was last worked in, instead of an empty state, every
  // time the app starts.
  useEffect(() => {
    window.api.session.getMostRecent().then((result) => {
      if (result) handleOpenSession(result.session, result.repo, result.project)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleOpenSession(session: SessionRecord, repo: Repo, project: Project | null): void {
    const item: SessionWithScope = { session, repo, project }
    setOpenSessions((prev) => (prev.some((s) => s.session.id === session.id) ? prev : [...prev, item]))
    setSelectedSession(item)
  }

  function handleCloseTab(item: SessionWithScope): void {
    const remaining = openSessions.filter((s) => s.session.id !== item.session.id)
    setOpenSessions(remaining)
    if (selectedSession?.session.id === item.session.id) {
      setSelectedSession(remaining.length > 0 ? remaining[remaining.length - 1] : null)
    }
  }

  function handleSessionDeleted(session: SessionRecord): void {
    setOpenSessions((prev) => prev.filter((s) => s.session.id !== session.id))
    setSelectedSession((prev) => (prev?.session.id === session.id ? null : prev))
  }

  function handleSessionRenamed(session: SessionRecord): void {
    setOpenSessions((prev) => prev.map((s) => (s.session.id === session.id ? { ...s, session } : s)))
    setSelectedSession((prev) => (prev?.session.id === session.id ? { ...prev, session } : prev))
  }

  function handleProjectDeleted(repoIds: string[]): void {
    setOpenSessions((prev) => prev.filter((s) => !repoIds.includes(s.repo.id)))
    setSelectedSession((prev) => (prev && repoIds.includes(prev.repo.id) ? null : prev))
  }

  async function handleCreateSessionFromMenu(): Promise<void> {
    if (!selectedSession) return
    const created = await window.api.session.create(selectedSession.repo.id)
    handleOpenSession(created, selectedSession.repo, null)
    setSessionListRefreshKey((k) => k + 1)
  }

  function handleCloseTabFromMenu(): void {
    if (selectedSession) handleCloseTab(selectedSession)
  }

  function cycleTab(direction: 1 | -1): void {
    if (openSessions.length === 0) return
    const currentIndex = selectedSession
      ? openSessions.findIndex((s) => s.session.id === selectedSession.session.id)
      : -1
    const nextIndex = (currentIndex + direction + openSessions.length) % openSessions.length
    setSelectedSession(openSessions[nextIndex])
  }

  const scopeName = selectedSession?.repo.name ?? null

  return (
    <div className="app-shell">
      <TitleBar
        menuActions={{
          newSession: selectedSession ? handleCreateSessionFromMenu : undefined,
          closeTab: selectedSession ? handleCloseTabFromMenu : undefined,
          quit: () => window.api.window.close(),
          toggleSidebar: handleExplorerClick,
          goExplorer: () => setSidebarCollapsed(false),
          goProjectView: handleGoProjectsView,
          goSessionView: handleGoSessionsView,
          goSettings: () => setSettingsOpen(true),
          nextTab: openSessions.length > 0 ? () => cycleTab(1) : undefined,
          previousTab: openSessions.length > 0 ? () => cycleTab(-1) : undefined,
          showAbout: () => setAboutOpen(true)
        }}
      />
      <div className="workbench">
        <div className="activitybar">
          <button
            className={`activitybar-icon${!sidebarCollapsed && explorerView === 'projects' ? ' is-active' : ''}`}
            onClick={handleGoProjectsView}
            title="Projects"
          >
            <ExplorerIcon />
          </button>
          <button
            className={`activitybar-icon${!sidebarCollapsed && explorerView === 'sessions' ? ' is-active' : ''}`}
            onClick={handleGoSessionsView}
            title="Sessions"
          >
            <ChatIcon />
          </button>
          <div className="activitybar-spacer" />
          <button
            className={`activitybar-icon${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <GearIcon />
          </button>
        </div>

        <div
          className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-header">SESSIONS</div>
          <div className="sidebar-scroll">
            <ProjectExplorer
              activeSessionId={selectedSession?.session.id}
              onOpenSession={handleOpenSession}
              onSessionDeleted={handleSessionDeleted}
              onSessionRenamed={handleSessionRenamed}
              onProjectDeleted={handleProjectDeleted}
              refreshKey={sessionListRefreshKey}
              view={explorerView}
              onViewChange={setExplorerView}
            />
          </div>
          <div className="sidebar-resize-handle" onPointerDown={handleSidebarResizeStart} />
        </div>

        <div className="editor-area">
          {openSessions.length > 0 ? (
            <>
              <SessionTabs
                sessions={openSessions.map((s) => s.session)}
                selected={selectedSession?.session ?? null}
                onSelect={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) setSelectedSession(item)
                }}
                onClose={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) handleCloseTab(item)
                }}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                {selectedSession ? (
                  <ChatPanel session={selectedSession.session} repoName={scopeName!} />
                ) : (
                  <div className="editor-empty">Pick or create a session in the sidebar</div>
                )}
              </div>
            </>
          ) : (
            <div className="editor-empty">Select or create a session in the sidebar</div>
          )}
        </div>
      </div>

      <div className="statusbar">
        <span className="statusbar-brand">
          <LogoIcon />
          PassCode
        </span>
        {scopeName && <div className="statusbar-item">{scopeName}</div>}
      </div>

      <ApprovalDialog />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
