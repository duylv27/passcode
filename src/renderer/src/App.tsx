import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../shared/types'
import { RepoSwitcher, type Scope } from './components/RepoSwitcher'
import { SessionList } from './components/SessionList'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'

type Activity = 'explorer' | 'settings'

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
  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  function handleExplorerClick(): void {
    if (activity === 'explorer') {
      setSidebarCollapsed((collapsed) => !collapsed)
    } else {
      setActivity('explorer')
      setSidebarCollapsed(false)
    }
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
            <div className="sidebar-header">SESSIONS</div>
            <RepoSwitcher scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
            <div className="sidebar-scroll">
              {scope ? (
                <SessionList
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
          </div>
        )}

        <div className="editor-area">
          {activity === 'settings' ? (
            <SettingsPanel />
          ) : scope ? (
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
    </div>
  )
}
