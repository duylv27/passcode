# Sidebar: Always-Visible Project Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's dropdown-driven single-scope session list with an always-visible list of every project as a collapsible box (default collapsed), remove the `scope` concept from `App.tsx` entirely, and show every open session as an unfiltered tab regardless of which project it belongs to.

**Architecture:** `SessionList.tsx` is reworked to render one project's full content (its repos' own sessions, grouped per repo, plus any project-scoped sessions) instead of being driven by a `scope` union. A new `ProjectBox.tsx` wraps one project's header (collapse toggle, "+" for a project-scoped session, an "Add repo" form) around it. A new `ProjectExplorer.tsx` fetches every project and renders one `ProjectBox` per project, plus a "+ New project" row, replacing `RepoSwitcher`/`ProjectTree`/`RepoList` entirely. `App.tsx` drops `scope`/`Scope` and instead tracks `openSessions`/`selectedSession` as `SessionWithScope` (already-shipped type: `{ session, repo, project }`), since every open/click site already has the full repo/project objects in hand.

**Tech Stack:** React 18, TypeScript (strict). No new dependencies. Reuses the already-shipped `window.api.session.listByProject`, `window.api.session.list` (per-repo), `window.api.session.createProjectSession`, `window.api.session.create`, `window.api.repos.list`, `window.api.repos.gitStatus`, `window.api.projects.list/create` IPC methods — no main-process changes in this plan.

## Global Constraints

- Project boxes default to collapsed; collapse state persists per project via `localStorage` (key `passcode-project-boxes`, a `Record<projectId, boolean>`), following the exact inline read/write pattern `SessionList.tsx` already uses for its own (now project-scoped, previously repo-scoped) collapse state — no shared helper module, matching this repo's existing precedent of not extracting tiny localStorage-touching logic (confirmed: `sidebarWidth.ts`/`sessionGroups.ts` only ever extracted the *pure* logic, never the `localStorage.getItem`/`setItem` calls themselves).
- Two independent "+" actions: a project box's header creates a project-scoped session (`window.api.session.createProjectSession`); each repo sub-group's header creates a repo-scoped session (`window.api.session.create(repoId)`).
- "Add repo" (the existing validated-git-repo add flow) lives inside each project's box.
- The tab bar shows every open session across every project, unfiltered. Closing a tab selects another currently-open tab (any project), not "another tab in the same scope."
- The status bar's context label is computed from the selected tab's own `repo`/`project` fields, not from a separately-tracked scope.
- No bookmark/pin UI and no search box in this plan (both explicitly out of scope per the spec's Non-goals — future work).
- `RepoSwitcher.tsx`, `ProjectTree.tsx`, `RepoList.tsx`, and `src/renderer/src/lib/sessionGroups.ts` (with its test) become fully unused once this plan lands and are deleted, along with their now-dead CSS.

---

### Task 1: Rework `SessionList.tsx` to render one project's full session tree

**Files:**
- Modify: `src/renderer/src/components/SessionList.tsx`
- Modify: `src/renderer/src/theme.css`
- Delete: `src/renderer/src/lib/sessionGroups.ts`
- Delete: `tests/renderer/lib/sessionGroups.test.ts`

**Interfaces:**
- Produces: `SessionList`'s new prop shape —
  `{ project: Project; activeSessionId: string | undefined; onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void; onSessionDeleted: (session: SessionRecord) => void; onSessionRenamed: (session: SessionRecord) => void }`
  — consumed by Task 2 (`ProjectBox.tsx`).

- [ ] **Step 1: Replace `SessionList.tsx`'s full contents**

Replace the entire file with:

```tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo, SessionRecord } from '../../../shared/types'
import { ChevronIcon, EditIcon, PlusIcon, RepoIcon, TrashIcon } from './icons'

interface Props {
  project: Project
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

function collapsedStorageKey(projectId: string): string {
  return `passcode-session-groups-${projectId}`
}

function readCollapsed(projectId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(collapsedStorageKey(projectId))
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** Renders one project's full session tree: each repo as a collapsible
 * group of its own (repo-scoped) sessions, plus any project-scoped
 * sessions (spanning every repo) in a small unboxed section above them. */
export function SessionList({
  project,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [repoSessions, setRepoSessions] = useState<Record<string, SessionRecord[]>>({})
  const [projectSessions, setProjectSessions] = useState<SessionRecord[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function refresh(): Promise<void> {
    const [repoList, projSessions] = await Promise.all([
      window.api.repos.list(project.id),
      window.api.session.listByProject(project.id)
    ])
    setRepos(repoList)
    setProjectSessions(projSessions)
    const sessionEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.session.list(r.id)] as const)
    )
    setRepoSessions(Object.fromEntries(sessionEntries))
    const statusEntries = await Promise.all(
      repoList.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const)
    )
    setGitStatuses(Object.fromEntries(statusEntries))
  }

  useEffect(() => {
    refresh()
    setCollapsed(readCollapsed(project.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  useEffect(() => {
    return window.api.session.onEvent((sessionId, event) => {
      if (event.type !== 'busy') return
      setBusySessionIds((prev) => {
        const next = new Set(prev)
        if (event.busy) next.add(sessionId)
        else next.delete(sessionId)
        return next
      })
    })
  }, [])

  function toggleGroup(repoId: string): void {
    setCollapsed((prev) => {
      const next = { ...prev, [repoId]: !prev[repoId] }
      try {
        localStorage.setItem(collapsedStorageKey(project.id), JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  async function handleCreateRepoSession(repo: Repo): Promise<void> {
    const created = await window.api.session.create(repo.id)
    setRepoSessions((prev) => ({ ...prev, [repo.id]: [...(prev[repo.id] ?? []), created] }))
    onOpenSession(created, repo, null)
  }

  async function handleDelete(session: SessionRecord): Promise<void> {
    await window.api.session.delete(session.id)
    onSessionDeleted(session)
    await refresh()
  }

  function startRename(session: SessionRecord): void {
    setEditingId(session.id)
    setEditValue(session.title)
  }

  async function commitRename(session: SessionRecord): Promise<void> {
    const title = editValue.trim()
    setEditingId(null)
    if (!title || title === session.title) return
    await window.api.session.rename(session.id, title)
    setRepoSessions((prev) => {
      const next: Record<string, SessionRecord[]> = {}
      for (const [repoId, list] of Object.entries(prev)) {
        next[repoId] = list.map((s) => (s.id === session.id ? { ...s, title } : s))
      }
      return next
    })
    setProjectSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title } : s)))
    onSessionRenamed({ ...session, title })
  }

  function renderSessionRow(s: SessionRecord, sessionProject: Project | null): JSX.Element {
    if (editingId === s.id) {
      return (
        <div key={s.id} className="session-row is-editing">
          <input
            className="field session-row-edit-field"
            autoFocus
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => commitRename(s)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setEditingId(null)
            }}
          />
        </div>
      )
    }
    return (
      <div key={s.id} className={`session-row${activeSessionId === s.id ? ' is-active' : ''}`}>
        <button
          className="session-row-select"
          onClick={() => {
            const repo = repos.find((r) => r.id === s.repoId)
            if (repo) onOpenSession(s, repo, sessionProject)
          }}
        >
          <span className={`session-row-status-dot${busySessionIds.has(s.id) ? ' is-busy' : ''}`} />
          <span className="session-row-title">{s.title}</span>
        </button>
        <button className="session-row-edit" onClick={() => startRename(s)} title="Rename session">
          <EditIcon />
        </button>
        <button className="session-row-delete" onClick={() => handleDelete(s)} title="Delete session">
          <TrashIcon />
        </button>
      </div>
    )
  }

  return (
    <div className="tree-sessions">
      {projectSessions.length > 0 && (
        <>
          <div className="project-sessions-label">Project</div>
          {projectSessions.map((s) => renderSessionRow(s, project))}
        </>
      )}
      {repos.map((repo) => {
        const status = gitStatuses[repo.id]
        const sessionsForRepo = repoSessions[repo.id] ?? []
        return (
          <div key={repo.id} className="session-group">
            <div className="session-group-header">
              <button className="session-group-toggle" onClick={() => toggleGroup(repo.id)}>
                <ChevronIcon className={`session-group-chevron${collapsed[repo.id] ? '' : ' is-open'}`} />
                <RepoIcon className="row-icon is-repo" />
                <span className="session-group-label">{repo.name}</span>
                {status && (
                  <span
                    className={`repo-status-dot${status.dirty ? ' is-dirty' : ''}`}
                    title={status.branch ?? undefined}
                  />
                )}
              </button>
              <button
                className="session-group-add"
                onClick={() => handleCreateRepoSession(repo)}
                title="New session in this repo"
              >
                <PlusIcon />
              </button>
            </div>
            {!collapsed[repo.id] && sessionsForRepo.map((s) => renderSessionRow(s, null))}
          </div>
        )
      })}
      {repos.length === 0 && projectSessions.length === 0 && (
        <div className="sidebar-empty">No repos yet. Add one below.</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Restructure `.session-group-header` CSS to hold two buttons instead of one, and add the new classes**

In `src/renderer/src/theme.css`, replace:

```css
.session-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 4px var(--space-2);
  background: var(--list-hover);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--fg-dim);
  font-size: 10px;
  font-weight: 500;
}

.session-group-header:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}

.session-group-header .row-icon.is-repo {
  color: #6a9955;
}

.session-group-header:last-child {
  border-bottom: none;
}
```

with:

```css
.session-group-header {
  display: flex;
  align-items: center;
  width: 100%;
  background: var(--list-hover);
  border-bottom: 1px solid var(--border-subtle);
}

.session-group-header:last-child {
  border-bottom: none;
}

.session-group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 4px var(--space-2);
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 10px;
  font-weight: 500;
}

.session-group-toggle:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}

.session-group-toggle .row-icon.is-repo {
  color: #6a9955;
}

.session-group-add {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin-right: 4px;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--fg-dim);
}

.session-group-add:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}
```

(Note: `.session-group-label` and `.session-group-chevron` rules elsewhere in the file are
unchanged — they still apply the same way inside `.session-group-toggle` as they did inside
the old single-button `.session-group-header`. `.repo-status-dot`/`.repo-status-dot.is-dirty`,
already defined from earlier work, are reused as-is — no changes needed there.)

Add this new rule near `.tree-sessions` (for the unboxed "Project" sessions label):

```css
.project-sessions-label {
  padding: 4px var(--space-2) 2px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
}
```

- [ ] **Step 3: Delete the now-unused grouping helper**

```bash
rm src/renderer/src/lib/sessionGroups.ts tests/renderer/lib/sessionGroups.test.ts
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: errors referencing `App.tsx` (still passing the old `scope` prop) and possibly
`ProjectBox`/`ProjectExplorer` (not created yet) — this is expected at this point in the
plan; `SessionList.tsx` itself, in isolation, should show no errors of its own. Confirm any
reported errors are all in files this task does not touch (they'll be fixed by Tasks 2-4).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionList.tsx src/renderer/src/theme.css
git rm src/renderer/src/lib/sessionGroups.ts tests/renderer/lib/sessionGroups.test.ts
git commit -m "Rework SessionList to render one project's full session tree"
```

---

### Task 2: `ProjectBox.tsx` — one project's collapsible box

**Files:**
- Create: `src/renderer/src/components/ProjectBox.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `SessionList` (Task 1), exact prop shape `{ project, activeSessionId, onOpenSession, onSessionDeleted, onSessionRenamed }`.
- Produces: `ProjectBox`'s prop shape —
  `{ project: Project; collapsed: boolean; onToggleCollapse: (projectId: string) => void; activeSessionId: string | undefined; onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void; onSessionDeleted: (session: SessionRecord) => void; onSessionRenamed: (session: SessionRecord) => void }`
  — consumed by Task 3 (`ProjectExplorer.tsx`).

- [ ] **Step 1: Create `ProjectBox.tsx`**

```tsx
// src/renderer/src/components/ProjectBox.tsx
import { useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { SessionList } from './SessionList'
import { ChevronIcon, PlusIcon } from './icons'

interface Props {
  project: Project
  collapsed: boolean
  onToggleCollapse: (projectId: string) => void
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
}

export function ProjectBox({
  project,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [addingRepo, setAddingRepo] = useState(false)
  const [repoPath, setRepoPath] = useState('')
  const [repoError, setRepoError] = useState<string | null>(null)
  // Bumped to force SessionList to refetch after a repo is added here --
  // SessionList owns its own fetched repo/session lists and has no other
  // way to learn a new repo now exists.
  const [refreshKey, setRefreshKey] = useState(0)

  async function handleCreateProjectSession(): Promise<void> {
    const result = await window.api.session.createProjectSession(project.id)
    if (result.ok) {
      const repos = await window.api.repos.list(project.id)
      const repo = repos.find((r) => r.id === result.session.repoId)
      if (repo) onOpenSession(result.session, repo, project)
    }
    setRefreshKey((k) => k + 1)
  }

  async function handleAddRepo(): Promise<void> {
    if (!repoPath.trim()) return
    setRepoError(null)
    const result = await window.api.repos.add(project.id, repoPath.trim())
    if (!result.ok) {
      setRepoError(result.error)
      return
    }
    setRepoPath('')
    setAddingRepo(false)
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="project-box">
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        <button className="project-box-add" onClick={handleCreateProjectSession} title="New project session">
          <PlusIcon />
        </button>
      </div>
      {!collapsed && (
        <>
          <SessionList
            key={refreshKey}
            project={project}
            activeSessionId={activeSessionId}
            onOpenSession={onOpenSession}
            onSessionDeleted={onSessionDeleted}
            onSessionRenamed={onSessionRenamed}
          />
          {addingRepo ? (
            <div className="picker-inline-form">
              <input
                className="field"
                autoFocus
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddRepo()
                  else if (e.key === 'Escape') setAddingRepo(false)
                }}
                onBlur={() => {
                  if (!repoPath.trim()) setAddingRepo(false)
                }}
                placeholder="/path/to/repo"
              />
              <button className="btn" onClick={handleAddRepo}>
                Add
              </button>
            </div>
          ) : (
            <button className="picker-add-row" onClick={() => setAddingRepo(true)}>
              <PlusIcon className="row-icon" />
              <span>Add repo</span>
            </button>
          )}
          {repoError && <div className="error-text">{repoError}</div>}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the project-box CSS**

In `src/renderer/src/theme.css`, add this near the `.session-group` block:

```css
.project-box {
  margin: 0 var(--space-1);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  overflow: hidden;
}

.project-box + .project-box {
  margin-top: 6px;
}

.project-box-header {
  display: flex;
  align-items: center;
  width: 100%;
  background: var(--list-hover);
  border-bottom: 1px solid var(--border-subtle);
}

.project-box-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 5px var(--space-2);
  background: none;
  border: none;
  color: var(--fg-bright);
  font-size: 11px;
  font-weight: 600;
}

.project-box-toggle:hover {
  background: var(--list-active);
}

.project-box-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-box-chevron {
  flex-shrink: 0;
  color: var(--fg-dim);
  transition: transform 100ms ease;
}

.project-box-chevron.is-open {
  transform: rotate(90deg);
}

.project-box-add {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-right: 6px;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--fg-dim);
}

.project-box-add:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: errors only in `App.tsx` (still using the old `scope`/`RepoSwitcher` shape) and
possibly a missing `ProjectExplorer` — `ProjectBox.tsx` itself should show no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ProjectBox.tsx src/renderer/src/theme.css
git commit -m "Add ProjectBox: one project's collapsible header, session tree, and add-repo form"
```

---

### Task 3: `ProjectExplorer.tsx` — the full always-visible project list

**Files:**
- Create: `src/renderer/src/components/ProjectExplorer.tsx`

**Interfaces:**
- Consumes: `ProjectBox` (Task 2), exact prop shape from Task 2's Interfaces block.
- Produces: `ProjectExplorer`'s prop shape —
  `{ activeSessionId: string | undefined; onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void; onSessionDeleted: (session: SessionRecord) => void; onSessionRenamed: (session: SessionRecord) => void; refreshKey: number }`
  — consumed by Task 4 (`App.tsx`).

- [ ] **Step 1: Create `ProjectExplorer.tsx`**

```tsx
// src/renderer/src/components/ProjectExplorer.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ProjectBox } from './ProjectBox'
import { PlusIcon } from './icons'

interface Props {
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Bumped by the parent to force a refetch after a session is created
   * from outside this tree (e.g. the hamburger menu's "New Session"). */
  refreshKey: number
}

const COLLAPSED_STORAGE_KEY = 'passcode-project-boxes'

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** The sidebar's top-level content: every project, always visible, each a
 * collapsible box (default collapsed) -- no scope selection required to
 * browse or open any session. Replaces RepoSwitcher + the old scoped
 * SessionList together. */
export function ProjectExplorer({
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  refreshKey
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  const [addingProject, setAddingProject] = useState(false)
  const [projectName, setProjectName] = useState('')

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function toggleCollapse(projectId: string): void {
    setCollapsed((prev) => {
      // New projects default to collapsed: `prev[projectId] ?? true` is
      // truthy (collapsed) whenever there's no stored entry yet, so the
      // very first toggle correctly flips to expanded (`false`).
      const next = { ...prev, [projectId]: !(prev[projectId] ?? true) }
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  async function handleCreateProject(): Promise<void> {
    if (!projectName.trim()) return
    await window.api.projects.create(projectName.trim())
    setProjectName('')
    setAddingProject(false)
    await refresh()
  }

  return (
    <div className="tree-sessions">
      {projects.map((project) => (
        <ProjectBox
          key={project.id}
          project={project}
          collapsed={collapsed[project.id] ?? true}
          onToggleCollapse={toggleCollapse}
          activeSessionId={activeSessionId}
          onOpenSession={onOpenSession}
          onSessionDeleted={onSessionDeleted}
          onSessionRenamed={onSessionRenamed}
        />
      ))}
      {addingProject ? (
        <div className="picker-inline-form">
          <input
            className="field"
            autoFocus
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProject()
              else if (e.key === 'Escape') setAddingProject(false)
            }}
            onBlur={() => {
              if (!projectName.trim()) setAddingProject(false)
            }}
            placeholder="Project name"
          />
          <button className="btn" onClick={handleCreateProject}>
            Add
          </button>
        </div>
      ) : (
        <button className="picker-add-row is-project" onClick={() => setAddingProject(true)}>
          <PlusIcon className="row-icon" />
          <span>New project</span>
        </button>
      )}
      {projects.length === 0 && !addingProject && (
        <div className="sidebar-empty">No projects yet. Add one below.</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: errors only in `App.tsx` — `ProjectExplorer.tsx` itself should show no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ProjectExplorer.tsx
git commit -m "Add ProjectExplorer: always-visible list of every project's box"
```

---

### Task 4: Wire `ProjectExplorer` into `App.tsx`, remove `scope`

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/SessionTabs.tsx` (no signature change; confirm untouched — see Step 5)

**Interfaces:**
- Consumes: `ProjectExplorer` (Task 3), `SessionWithScope` (already shipped in `shared/types.ts`: `{ session: SessionRecord; repo: Repo; project: Project | null }`).

- [ ] **Step 1: Replace `App.tsx`'s full contents**

```tsx
// src/renderer/src/App.tsx
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Project, Repo, SessionRecord, SessionWithScope } from '../../shared/types'
import { ProjectExplorer } from './components/ProjectExplorer'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { TitleBar } from './components/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
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
  // Bumped to force ProjectExplorer to refetch after a session is created
  // from outside its own tree (the hamburger menu's "New Session" action).
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

  async function handleCreateSessionFromMenu(): Promise<void> {
    if (!selectedSession) return
    if (selectedSession.project) {
      const result = await window.api.session.createProjectSession(selectedSession.project.id)
      if (result.ok) handleOpenSession(result.session, selectedSession.repo, selectedSession.project)
    } else {
      const created = await window.api.session.create(selectedSession.repo.id)
      handleOpenSession(created, selectedSession.repo, null)
    }
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

  const scopeName = selectedSession
    ? selectedSession.project
      ? `${selectedSession.project.name} (project)`
      : selectedSession.repo.name
    : null

  return (
    <div className="app-shell">
      <TitleBar
        menuActions={{
          newSession: selectedSession ? handleCreateSessionFromMenu : undefined,
          closeTab: selectedSession ? handleCloseTabFromMenu : undefined,
          quit: () => window.api.window.close(),
          toggleSidebar: handleExplorerClick,
          goExplorer: () => setSidebarCollapsed(false),
          goSettings: () => setSettingsOpen(true),
          nextTab: openSessions.length > 0 ? () => cycleTab(1) : undefined,
          previousTab: openSessions.length > 0 ? () => cycleTab(-1) : undefined,
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
          <div className="sidebar-scroll">
            <ProjectExplorer
              activeSessionId={selectedSession?.session.id}
              onOpenSession={handleOpenSession}
              onSessionDeleted={handleSessionDeleted}
              onSessionRenamed={handleSessionRenamed}
              refreshKey={sessionListRefreshKey}
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 3: Manually verify**

Run: `npm run dev`
- Confirm the sidebar shows every project as a collapsed box on launch (no dropdown visible
  anywhere).
- Expand a project box; confirm it shows its repos (each with a git branch/dirty dot and its
  own "+"), any project-wide sessions above them, and an "Add repo" row.
- Click a session; confirm it opens as a tab and the status bar shows the right context
  label.
- Open a session from a second, different project; confirm both tabs show simultaneously in
  the tab bar.
- Close a tab; confirm another currently-open tab (from either project) is selected.
- Use the project box header's "+"; confirm it creates and opens a project-scoped session.
  Use a repo sub-group's "+"; confirm it creates and opens a repo-scoped session in just that
  repo.
- Restart the app; confirm project box collapse state persisted, and the app lands back on
  the most-recently-opened session.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire ProjectExplorer into App.tsx; remove the scope concept entirely"
```

---

### Task 5: Delete the now-unused picker components and dead CSS

**Files:**
- Delete: `src/renderer/src/components/RepoSwitcher.tsx`
- Delete: `src/renderer/src/components/ProjectTree.tsx`
- Delete: `src/renderer/src/components/RepoList.tsx`
- Modify: `src/renderer/src/theme.css`

- [ ] **Step 1: Confirm nothing still imports the files being deleted**

Run: `grep -rn "RepoSwitcher\|ProjectTree\|from './RepoList'\|from '../components/RepoList'" src/renderer/src --include=*.tsx`
Expected: no matches (Task 4 already replaced the only importer, `App.tsx`)

- [ ] **Step 2: Delete the files**

```bash
git rm src/renderer/src/components/RepoSwitcher.tsx src/renderer/src/components/ProjectTree.tsx src/renderer/src/components/RepoList.tsx
```

- [ ] **Step 3: Remove their now-dead CSS**

In `src/renderer/src/theme.css`, remove the following rules in full (all are exclusively used
by the three deleted files — confirmed unused elsewhere: `.picker-group*` and `.picker-row*`
were only ever rendered by `ProjectTree.tsx`/`RepoList.tsx`; `.repo-switcher*` only by
`RepoSwitcher.tsx`. `.picker-add-row`, `.picker-inline-form`, `.field`, `.btn`,
`.repo-status-dot`, `.error-text`, `.sidebar-empty` are all still in active use by
`ProjectBox.tsx`/`ProjectExplorer.tsx`/`SessionList.tsx` from Tasks 1-3 and must NOT be
removed):

- `.repo-switcher` and every rule starting `.repo-switcher-*` (trigger, add, label, chevron,
  menu, and their `:hover`/`:disabled`/`.is-open` variants)
- `.picker-group + .picker-group`
- `.picker-group-label` and its `.is-clickable:hover` / `.is-selected` variants
- `.picker-row`, `.picker-row-name`, `.picker-row:hover`, `.picker-row.is-selected`,
  `.picker-row .row-icon.is-repo`

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: same pass/fail counts as before this plan started (this task touches no test
files; any pre-existing `node:sqlite`-related environment failures are unrelated and expected)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "Delete RepoSwitcher/ProjectTree/RepoList and their dead CSS"
```

## Self-Review Notes

- **Spec coverage:** always-visible collapsible project boxes, default collapsed → Task 3
  (`collapsed[project.id] ?? true`); repo sub-groups + project-wide sessions per box → Task 1;
  two independent "+" actions → Task 1 (repo-level) + Task 2 (project-level); "Add repo" inside
  each box → Task 2; unfiltered tab bar, closing selects any remaining tab → Task 4;
  status-bar label from the selected tab's own fields → Task 4 (`scopeName` derivation); old
  "All Sessions" plan's backend reuse (`SessionWithScope`, `listAllSessions`) — note:
  this plan does NOT end up calling `listAllSessions()`/`session:listAll` anywhere, because
  the always-visible-boxes design fetches per-project (`listByProject`) and per-repo (`list`)
  instead of one flat cross-project call. This is intentional and consistent with the spec's
  Approach section, which describes expanding a project box as fetching "that project's repos
  and sessions" via the existing per-project IPC calls, not the flat endpoint. The flat
  endpoint and `SessionWithScope` type remain shipped and valid (reused for `openSessions`'
  item shape in `App.tsx`) even though this particular plan doesn't call `listAllSessions`
  itself — no gap, just worth naming explicitly since a shallower reading of "reuses the
  backend" might expect a call site for the list-everything endpoint specifically.
- **Placeholder scan:** no TBD/TODO; every step shows complete code.
- **Type consistency:** `onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void`
  is identical across Task 1's `SessionList` prop, Task 2's `ProjectBox` prop (passed straight
  through), Task 3's `ProjectExplorer` prop (passed straight through), and Task 4's
  `App.tsx` `handleOpenSession` (the concrete implementation) — same three-argument order and
  types at every hop. `SessionWithScope`'s `{ session, repo, project }` field names match
  their use in Task 4 (`item.session.id`, `selectedSession.repo`, `selectedSession.project`)
  exactly, and match the type's existing shipped definition in `shared/types.ts` from the
  prior (Tasks 1-2 of the now-superseded) plan.
