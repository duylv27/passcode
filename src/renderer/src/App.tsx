import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Project, Repo, SessionRecord } from '../../shared/types'
import { RepoSwitcher, type Scope } from './components/RepoSwitcher'
import { SessionList } from './components/SessionList'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { TitleBar } from './components/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY } from './lib/sidebarWidth'

/** A session belongs either to one repo, or (projectId set) to every repo
 * in a project -- these two helpers keep that grouping consistent across
 * tab filtering without repeating the projectId-vs-repoId branch everywhere. */
function sessionMatchesScope(session: SessionRecord, scope: Scope): boolean {
  return scope.kind === 'project' ? session.projectId === scope.project.id : session.repoId === scope.repo.id && !session.projectId
}

function scopeOf(repo: Repo, project: Project | null): Scope {
  return project ? { kind: 'project', project } : { kind: 'repo', repo }
}

export default function App(): JSX.Element {
  const [scope, setScope] = useState<Scope | null>(null)
  const [openSessions, setOpenSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)
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
  // Bumped to force SessionList to refetch after a session is created above
  // it (the sidebar's "+" button or the hamburger menu) -- SessionList owns
  // its own fetched list and has no other way to learn about that.
  const [sessionListRefreshKey, setSessionListRefreshKey] = useState(0)

  function handleExplorerClick(): void {
    setSidebarCollapsed((collapsed) => !collapsed)
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

  function selectScope(next: Scope): void {
    setScope(next)
    const tabs = openSessions.filter((s) => sessionMatchesScope(s, next))
    setSelectedSession(tabs.length > 0 ? tabs[tabs.length - 1] : null)
  }

  function handleSelectRepo(repo: Repo): void {
    selectScope({ kind: 'repo', repo })
  }

  function handleSelectProject(project: Project): void {
    selectScope({ kind: 'project', project })
  }

  // Land on whatever was last worked in, instead of an empty state, every
  // time the app starts.
  useEffect(() => {
    window.api.session.getMostRecent().then((result) => {
      if (result) handleOpenSession(result.session, scopeOf(result.repo, result.project))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleOpenSession(session: SessionRecord, sessionScope: Scope): void {
    setScope(sessionScope)
    setOpenSessions((prev) => (prev.some((s) => s.id === session.id) ? prev : [...prev, session]))
    setSelectedSession(session)
  }

  function handleCloseTab(session: SessionRecord): void {
    const remaining = openSessions.filter((s) => s.id !== session.id)
    setOpenSessions(remaining)
    if (selectedSession?.id === session.id) {
      const remainingInScope = remaining.filter((s) =>
        session.projectId ? s.projectId === session.projectId : s.repoId === session.repoId && !s.projectId
      )
      setSelectedSession(remainingInScope.length > 0 ? remainingInScope[remainingInScope.length - 1] : null)
    }
  }

  function handleSessionDeleted(session: SessionRecord): void {
    setOpenSessions((prev) => prev.filter((s) => s.id !== session.id))
    setSelectedSession((prev) => (prev?.id === session.id ? null : prev))
  }

  function handleSessionRenamed(session: SessionRecord): void {
    setOpenSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)))
    setSelectedSession((prev) => (prev?.id === session.id ? session : prev))
  }

  const sessionsInScope = scope ? openSessions.filter((s) => sessionMatchesScope(s, scope)) : []
  const scopeName = scope ? (scope.kind === 'project' ? `${scope.project.name} (project)` : scope.repo.name) : null

  async function handleCreateSessionFromMenu(): Promise<void> {
    if (!scope) return
    if (scope.kind === 'repo') {
      const created = await window.api.session.create(scope.repo.id)
      handleOpenSession(created, scope)
    } else {
      const result = await window.api.session.createProjectSession(scope.project.id)
      if (result.ok) handleOpenSession(result.session, scope)
    }
    setSessionListRefreshKey((k) => k + 1)
  }

  function handleCloseTabFromMenu(): void {
    if (selectedSession) handleCloseTab(selectedSession)
  }

  function cycleTab(direction: 1 | -1): void {
    if (sessionsInScope.length === 0) return
    const currentIndex = selectedSession ? sessionsInScope.findIndex((s) => s.id === selectedSession.id) : -1
    const nextIndex = (currentIndex + direction + sessionsInScope.length) % sessionsInScope.length
    setSelectedSession(sessionsInScope[nextIndex])
  }

  return (
    <div className="app-shell">
      <TitleBar
        menuActions={{
          newSession: scope ? handleCreateSessionFromMenu : undefined,
          closeTab: selectedSession ? handleCloseTabFromMenu : undefined,
          quit: () => window.api.window.close(),
          toggleSidebar: handleExplorerClick,
          goExplorer: () => setSidebarCollapsed(false),
          goSettings: () => setSettingsOpen(true),
          nextTab: sessionsInScope.length > 0 ? () => cycleTab(1) : undefined,
          previousTab: sessionsInScope.length > 0 ? () => cycleTab(-1) : undefined,
          showAbout: () => setAboutOpen(true)
        }}
      />
      <div className="workbench">
        <div className="activitybar">
          <button
            className={`activitybar-icon${!sidebarCollapsed ? ' is-active' : ''}`}
            onClick={handleExplorerClick}
            title={!sidebarCollapsed ? 'Hide Explorer' : 'Explorer'}
          >
            <ExplorerIcon />
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
          <RepoSwitcher
            scope={scope}
            onSelectRepo={handleSelectRepo}
            onSelectProject={handleSelectProject}
            onCreateSession={handleCreateSessionFromMenu}
          />
          <div className="sidebar-scroll">
            {scope ? (
              <SessionList
                key={sessionListRefreshKey}
                scope={scope}
                activeSessionId={selectedSession?.id}
                onOpenSession={(session) => handleOpenSession(session, scope)}
                onSessionDeleted={handleSessionDeleted}
                onSessionRenamed={handleSessionRenamed}
              />
            ) : (
              <div className="sidebar-empty">Pick a repo or project above to see its sessions.</div>
            )}
          </div>
          <div className="sidebar-resize-handle" onPointerDown={handleSidebarResizeStart} />
        </div>

        <div className="editor-area">
          {scope ? (
            <>
              <SessionTabs
                sessions={sessionsInScope}
                selected={selectedSession}
                onSelect={setSelectedSession}
                onClose={handleCloseTab}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                {selectedSession ? (
                  <ChatPanel session={selectedSession} repoName={scopeName!} />
                ) : (
                  <div className="editor-empty">Pick or create a session in the sidebar</div>
                )}
              </div>
            </>
          ) : (
            <div className="editor-empty">Select a repo or project to start a session</div>
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
