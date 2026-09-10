import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ApprovalRequest, Project, Repo, SessionRecord, SessionWithScope, UiPromptRequest } from '../../shared/types'
import { ProjectExplorer } from './components/ProjectExplorer'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { WelcomeScreen } from './components/WelcomeScreen'
import { SettingsPanel } from './components/SettingsPanel'
import { TitleBar } from './components/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { ToastStack, type ToastMessage } from './components/Toast'
import { ChatIcon, ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY } from './lib/sidebarWidth'

export default function App(): JSX.Element {
  const [openSessions, setOpenSessions] = useState<SessionWithScope[]>([])
  const openSessionsRef = useRef(openSessions)
  openSessionsRef.current = openSessions
  const [selectedSession, setSelectedSession] = useState<SessionWithScope | null>(null)
  const selectedSessionIdRef = useRef<string | null>(null)
  selectedSessionIdRef.current = selectedSession?.session.id ?? null
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
  const [appVersion, setAppVersion] = useState<string | null>(null)
  // Global so no request is lost while its session's tab isn't the active
  // one -- ApprovalPanel only renders the subset scoped to whichever
  // session is currently selected (see the filter passed to ChatPanel
  // below), but this queue keeps every pending request alive underneath.
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([])
  // Same global-queue-filtered-per-session pattern as approvalQueue above.
  const [uiPromptQueue, setUiPromptQueue] = useState<UiPromptRequest[]>([])
  // Toasts for ctx.ui.notify() calls -- a separate stack from Settings'
  // own (that one only ever shows its own save-confirmation toasts), fed
  // by a session-agnostic listener since only the *active* tab's ChatPanel
  // otherwise subscribes to session events at all; a background tab's
  // notify would never be seen by anything without this.
  const [notifyToasts, setNotifyToasts] = useState<ToastMessage[]>([])
  const [explorerView, setExplorerView] = useState<'sessions' | 'projects'>('sessions')
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set())
  // Bumped to force ProjectExplorer to refetch after a session is created
  // from outside its own tree (the hamburger menu's "New Session" action).
  const [sessionListRefreshKey, setSessionListRefreshKey] = useState(0)
  // Bumped when Settings closes, so ChatPanel refetches window.api.models.list()
  // -- it otherwise only fetches once on mount, so a provider key saved while
  // Settings was open (making new models available) would go unnoticed until
  // the next full reload.
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0)

  function handleExplorerClick(): void {
    setSidebarCollapsed((collapsed) => !collapsed)
  }

  function handleGoProjectsView(): void {
    if (!sidebarCollapsed && explorerView === 'projects') {
      setSidebarCollapsed(true)
      return
    }
    setSidebarCollapsed(false)
    setExplorerView('projects')
  }

  function handleGoSessionsView(): void {
    if (!sidebarCollapsed && explorerView === 'sessions') {
      setSidebarCollapsed(true)
      return
    }
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

  function handleOpenSession(session: SessionRecord, repo: Repo, project: Project | null): void {
    const item: SessionWithScope = { session, repo, project }
    setOpenSessions((prev) => (prev.some((s) => s.session.id === session.id) ? prev : [...prev, item]))
    setSelectedSession(item)
  }

  // Unlike Close All (which keeps pinned tabs open, a tab-management
  // action), the titlebar's logo/name button is an explicit "take me to
  // the welcome screen" navigation and always closes everything.
  function handleGoHome(): void {
    setOpenSessions([])
    setSelectedSession(null)
    setSidebarCollapsed(true)
  }

  // Collapses the sidebar the moment the welcome screen appears (fresh
  // launch, or the last tab closing) without fighting a deliberate expand
  // afterwards -- e.g. clicking the welcome screen's "Browse projects"
  // action -- since this only re-runs when the open-tab count itself
  // changes, not on every render while it stays at zero.
  useEffect(() => {
    if (openSessions.length === 0) setSidebarCollapsed(true)
  }, [openSessions.length])

  useEffect(() => {
    window.api.app.getVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    const unsubscribe = window.api.approvals.onRequest((request) => {
      setApprovalQueue((prev) => [...prev, request])
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const unsubscribeRequest = window.api.uiPrompts.onRequest((request) => {
      setUiPromptQueue((prev) => [...prev, request])
    })
    // A request that timed out or whose signal aborted -- drop it from the
    // queue without treating it as a user response (that would otherwise
    // resolve a promise that's already resolved on the main side).
    const unsubscribeCancel = window.api.uiPrompts.onCancel((requestId) => {
      setUiPromptQueue((prev) => prev.filter((r) => r.requestId !== requestId))
    })
    return () => {
      unsubscribeRequest()
      unsubscribeCancel()
    }
  }, [])

  useEffect(() => {
    // Session-agnostic on purpose -- catches ui_notify from every open
    // session, not just whichever tab's ChatPanel happens to be mounted
    // (only the active one is), so a background tab's notify still
    // surfaces instead of being silently dropped.
    const unsubscribe = window.api.session.onEvent((eventSessionId, event) => {
      if (event.type !== 'ui_notify') return
      const isBackground = eventSessionId !== selectedSessionIdRef.current
      const sessionTitle = openSessionsRef.current.find((s) => s.session.id === eventSessionId)?.session.title
      const text = isBackground && sessionTitle ? `${sessionTitle}: ${event.message}` : event.message
      const variant = event.level === 'error' ? 'error' : event.level === 'warning' ? 'warning' : 'info'
      setNotifyToasts((prev) => [...prev, { id: crypto.randomUUID(), text, variant }])
    })
    return unsubscribe
  }, [])

  function dismissNotifyToast(id: string): void {
    setNotifyToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleRespondApproval(requestId: string, approved: boolean): Promise<void> {
    await window.api.approvals.respond(requestId, approved)
    setApprovalQueue((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  async function handleRespondUiPrompt(requestId: string, value: string | boolean | undefined): Promise<void> {
    await window.api.uiPrompts.respond(requestId, value)
    setUiPromptQueue((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  function handleCloseTab(item: SessionWithScope): void {
    const remaining = openSessions.filter((s) => s.session.id !== item.session.id)
    setOpenSessions(remaining)
    if (selectedSession?.session.id === item.session.id) {
      setSelectedSession(remaining.length > 0 ? remaining[remaining.length - 1] : null)
    }
  }

  // Pinned tabs survive Close Others / Close All -- the plain × on a tab
  // still closes it directly regardless of pinned state.
  function handleCloseOthers(item: SessionWithScope): void {
    const remaining = openSessions.filter(
      (s) => s.session.id === item.session.id || pinnedSessionIds.has(s.session.id)
    )
    setOpenSessions(remaining)
    if (selectedSession && !remaining.some((s) => s.session.id === selectedSession.session.id)) {
      setSelectedSession(item)
    }
  }

  function handleCloseAll(): void {
    const remaining = openSessions.filter((s) => pinnedSessionIds.has(s.session.id))
    setOpenSessions(remaining)
    if (selectedSession && !remaining.some((s) => s.session.id === selectedSession.session.id)) {
      setSelectedSession(remaining.length > 0 ? remaining[0] : null)
    }
  }

  function handleTogglePin(item: SessionWithScope): void {
    setPinnedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(item.session.id)) next.delete(item.session.id)
      else next.add(item.session.id)
      return next
    })
  }

  // Distinct from Pin above -- bookmarked is persisted (survives a restart,
  // works from the sidebar too) rather than an in-memory "keep this tab
  // open" marker. Updates the open tab locally for instant feedback, and
  // bumps the sidebar refresh key so SessionTimeline/SessionList (which
  // don't otherwise know this session's bookmarked flag changed) pick it up.
  async function handleToggleBookmark(session: SessionRecord): Promise<void> {
    const next = !session.bookmarked
    await window.api.session.setBookmarked(session.id, next)
    setOpenSessions((prev) =>
      prev.map((s) => (s.session.id === session.id ? { ...s, session: { ...s.session, bookmarked: next } } : s))
    )
    setSelectedSession((prev) =>
      prev?.session.id === session.id ? { ...prev, session: { ...prev.session, bookmarked: next } } : prev
    )
    setSessionListRefreshKey((k) => k + 1)
  }

  function handleSessionDeleted(session: SessionRecord): void {
    setOpenSessions((prev) => prev.filter((s) => s.session.id !== session.id))
    setSelectedSession((prev) => (prev?.session.id === session.id ? null : prev))
    // Neither sidebar list (SessionTimeline's recents view, SessionList's
    // per-project tree) removes a deleted row on its own -- both only
    // refetch when this key changes, so a delete triggered from either one
    // otherwise leaves the row visible until some unrelated refresh happens.
    setSessionListRefreshKey((k) => k + 1)
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
    const result = await window.api.session.createProjectSession(selectedSession.repo.projectId)
    if (!result.ok) return
    const repo =
      result.session.repoId === selectedSession.repo.id
        ? selectedSession.repo
        : (await window.api.repos.list(selectedSession.repo.projectId)).find(
            (r) => r.id === result.session.repoId
          )
    if (repo) handleOpenSession(result.session, repo, selectedSession.project)
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
        onGoHome={handleGoHome}
      />
      <div className="workbench">
        <div className="activitybar">
          <button
            className={`activitybar-icon${!sidebarCollapsed && explorerView === 'projects' ? ' is-active' : ''}`}
            onClick={handleGoProjectsView}
            title={!sidebarCollapsed && explorerView === 'projects' ? 'Hide Sidebar' : 'Projects'}
          >
            <ExplorerIcon />
          </button>
          <button
            className={`activitybar-icon${!sidebarCollapsed && explorerView === 'sessions' ? ' is-active' : ''}`}
            onClick={handleGoSessionsView}
            title={!sidebarCollapsed && explorerView === 'sessions' ? 'Hide Sidebar' : 'Sessions'}
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
                pinnedIds={pinnedSessionIds}
                onSelect={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) setSelectedSession(item)
                }}
                onClose={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) handleCloseTab(item)
                }}
                onCloseOthers={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) handleCloseOthers(item)
                }}
                onCloseAll={handleCloseAll}
                onTogglePin={(session) => {
                  const item = openSessions.find((s) => s.session.id === session.id)
                  if (item) handleTogglePin(item)
                }}
                onToggleBookmark={handleToggleBookmark}
              />
              <div style={{ flex: 1, minHeight: 0 }}>
                {selectedSession ? (
                  <ChatPanel
                    session={selectedSession.session}
                    repoName={scopeName!}
                    modelsRefreshKey={modelsRefreshKey}
                    approvalRequests={approvalQueue.filter((r) => r.sessionId === selectedSession.session.id)}
                    onRespondApproval={handleRespondApproval}
                    uiPromptRequests={uiPromptQueue.filter((r) => r.sessionId === selectedSession.session.id)}
                    onRespondUiPrompt={handleRespondUiPrompt}
                  />
                ) : (
                  <div className="editor-empty">Pick or create a session in the sidebar</div>
                )}
              </div>
            </>
          ) : (
            <WelcomeScreen onOpenSession={handleOpenSession} onBrowseProjects={handleGoProjectsView} />
          )}
        </div>
      </div>

      <div className="statusbar">
        <span className="statusbar-brand">
          <LogoIcon />
          PassCode
          {appVersion && <span className="statusbar-version">v{appVersion}</span>}
          {import.meta.env.DEV && <span className="statusbar-dev-badge">DEV BUILD</span>}
        </span>
        {scopeName && <div className="statusbar-item">{scopeName}</div>}
      </div>

      {settingsOpen && (
        <SettingsPanel
          onClose={() => {
            setSettingsOpen(false)
            setModelsRefreshKey((k) => k + 1)
          }}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      <ToastStack messages={notifyToasts} onDismiss={dismissNotifyToast} />
    </div>
  )
}
