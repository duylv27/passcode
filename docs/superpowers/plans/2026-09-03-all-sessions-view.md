# "All Sessions" Sidebar View + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidebar view, toggled independently of the existing repo/project scope, that lists every session across every project/repo as one flat, searchable, most-recently-opened-first list.

**Architecture:** A new `SessionsRepository.listAll()` at the data layer, enriched with repo/project lookups in a new `SessionHandlers.listAllSessions()` (mirroring the existing `getMostRecentSession()` pattern), exposed over a new `session:listAll` IPC channel. The renderer gets a new `AllSessionsList.tsx` component and a `sidebarView` toggle in `App.tsx` that is completely independent of the existing `scope` state — opening a session from this view still updates `scope` normally (so the tab bar/editor work exactly as today), but nothing switches `sidebarView` back except the toggle itself.

**Tech Stack:** `node:sqlite` (existing `better-sqlite3`-style raw SQL via `DatabaseSync`), the existing IPC invoke/preload pattern, React state in `App.tsx`, Vitest.

## Global Constraints

- `listAll()` orders by `COALESCE(last_opened_at, created_at) DESC, rowid DESC` — most-recently-opened first, falling back to creation time for a session that's never been opened, matching `getMostRecent()`'s existing ordering exactly.
- Search filters by session title only, client-side, case-insensitive substring match, and only exists in the "All Sessions" view — never added to the existing scoped view.
- Sessions whose repo no longer resolves (deleted) are skipped from the enriched list, not included with a null repo.
- Opening a session from "All Sessions" must update `scope` exactly as today's `handleOpenSession` already does — no new opening logic — and must NOT toggle `sidebarView` back to `'scoped'`.
- No grouping by project/repo in this view — deliberately flat, with each row showing the session title plus its repo's name as a small trailing label.
- No sort options beyond most-recently-opened.

---

### Task 1: `SessionsRepository.listAll()`

**Files:**
- Modify: `src/main/db/sessionsRepository.ts`
- Test: `tests/main/db/sessionsRepository.test.ts`

**Interfaces:**
- Produces: `SessionsRepository.listAll(): SessionRecord[]` — consumed by Task 2 (`sessionHandlers.ts`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/db/sessionsRepository.test.ts`, inside the existing `describe('SessionsRepository', ...)` block:

```typescript
  it('lists sessions from every repo, most-recently-opened first', () => {
    const first = sessions.create(repoId, 'pi-1', 'First')
    const second = sessions.create(repoId, 'pi-2', 'Second')
    const third = sessions.create(repoId, 'pi-3', 'Third')
    sessions.touchOpened(first.id)

    const all = sessions.listAll()

    expect(all.map((s) => s.id)).toEqual([first.id, third.id, second.id])
  })

  it('includes sessions from every repo across every project', () => {
    const projectId2 = createProjectsRepository(dbRef).create('Second project').id
    const repoId2 = createReposRepository(dbRef).create(projectId2, '/path/b', 'repo-b').id
    const otherRepoSession = sessions.create(repoId2, 'pi-x', 'Other repo session')
    const sameRepoSession = sessions.create(repoId, 'pi-y', 'Same repo session')

    const ids = sessions.listAll().map((s) => s.id)

    expect(ids).toContain(otherRepoSession.id)
    expect(ids).toContain(sameRepoSession.id)
  })

  it('returns an empty list when there are no sessions', () => {
    expect(sessions.listAll()).toEqual([])
  })
```

The second test needs a reference to the shared in-memory `db` the outer `beforeEach` creates (currently a local variable inside `beforeEach`, not stored on a variable visible to `it` blocks). Update the `beforeEach` to also assign it to an outer-scoped `dbRef` variable:

```typescript
describe('SessionsRepository', () => {
  let sessions: SessionsRepository
  let repoId: string
  let dbRef: Database

  beforeEach(() => {
    const db = new Database(':memory:')
    dbRef = db
    initSchema(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = createReposRepository(db).create(projectId, '/path/a', 'a').id
    sessions = createSessionsRepository(db)
  })
```

(`Database` here is the same `DatabaseSync as Database` import already at the top of this
test file — the `let dbRef: Database` declaration uses that existing import, no new import
needed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/main/db/sessionsRepository.test.ts`
Expected: FAIL — `sessions.listAll is not a function`

- [ ] **Step 3: Implement `listAll()`**

In `src/main/db/sessionsRepository.ts`, add to the `SessionsRepository` interface, right after
`getMostRecent(): SessionRecord | undefined`:

```typescript
  /** Every session across every repo/project, most-recently-opened first
   * (falling back to creation time for a session that's never been opened). */
  listAll(): SessionRecord[]
```

Add to the returned object in `createSessionsRepository`, right after the `getMostRecent()`
method implementation:

```typescript
    listAll(): SessionRecord[] {
      return db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM sessions ORDER BY COALESCE(last_opened_at, created_at) DESC, rowid DESC`
        )
        .all() as unknown as SessionRecord[]
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/main/db/sessionsRepository.test.ts`
Expected: PASS (10 tests — 7 existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/main/db/sessionsRepository.ts tests/main/db/sessionsRepository.test.ts
git commit -m "Add SessionsRepository.listAll() for a cross-repo session list"
```

---

### Task 2: `listAllSessions` handler + IPC contract

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc/sessionHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `SessionsRepository.listAll()` (Task 1).
- Produces: `SessionWithScope` type (`{ session: SessionRecord; repo: Repo; project: Project | null }`); `SessionHandlers.listAllSessions(): SessionWithScope[]`; `window.api.session.listAll(): Promise<SessionWithScope[]>` — consumed by Task 3 (`AllSessionsList.tsx`).

- [ ] **Step 1: Add the `SessionWithScope` type and the `Api` method**

In `src/shared/types.ts`, add this interface right after `GitStatus`:

```typescript
export interface SessionWithScope {
  session: SessionRecord
  repo: Repo
  project: Project | null
}
```

In the `Api` interface's `session` block, add this line right after
`getMostRecent(): Promise<{ session: SessionRecord; repo: Repo; project: Project | null } | null>`:

```typescript
    listAll(): Promise<SessionWithScope[]>
```

- [ ] **Step 2: Write the failing test**

Add to `tests/main/ipc/sessionHandlers.test.ts`, inside the existing `describe('sessionHandlers', ...)`
block (it needs its own local `projectsRepo`, since the outer `beforeEach`'s shared `handlers`
doesn't wire one in):

```typescript
  it('listAllSessions resolves repo and project for every session, most-recently-opened first', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const localSessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo Project').id
    const localRepoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    const localHandlers = createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo: localSessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text
    })

    const repoScoped = localHandlers.createSession(localRepoId, 'Repo scoped')
    const projectResult = localHandlers.createProjectSession(projectId, 'Project scoped')
    if (!projectResult.ok) throw new Error('setup failed: ' + projectResult.error)

    const all = localHandlers.listAllSessions()

    expect(all).toHaveLength(2)
    const repoEntry = all.find((s) => s.session.id === repoScoped.id)
    expect(repoEntry?.repo.id).toBe(localRepoId)
    expect(repoEntry?.project).toBe(null)
    const projectEntry = all.find((s) => s.session.id === projectResult.session.id)
    expect(projectEntry?.repo.id).toBe(localRepoId)
    expect(projectEntry?.project?.id).toBe(projectId)
  })

  it('listAllSessions skips a session whose repo no longer exists', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const localSessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo Project').id
    const localRepoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    const localHandlers = createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo: localSessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text
    })

    localHandlers.createSession(localRepoId, 'Orphaned-to-be')
    reposRepo.delete(localRepoId)

    expect(localHandlers.listAllSessions()).toEqual([])
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/main/ipc/sessionHandlers.test.ts`
Expected: FAIL — `localHandlers.listAllSessions is not a function`

- [ ] **Step 4: Implement `listAllSessions`**

In `src/main/ipc/sessionHandlers.ts`, add `SessionWithScope` to the type import block (which
currently imports `ChatEvent`, `CreateProjectSessionError`, `CreateProjectSessionResult`,
`Project`, `PromptOptions`, `Repo`, `SessionRecord` from `'../../shared/types'`):

```typescript
import type {
  ChatEvent,
  CreateProjectSessionError,
  CreateProjectSessionResult,
  Project,
  PromptOptions,
  Repo,
  SessionRecord,
  SessionWithScope
} from '../../shared/types'
```

Add to the `SessionHandlers` interface, right after
`getMostRecentSession(): { session: SessionRecord; repo: Repo; project: Project | null } | null`:

```typescript
  listAllSessions(): SessionWithScope[]
```

Add to the returned object in `createSessionHandlers`, right after the `getMostRecentSession()`
method implementation:

```typescript
    listAllSessions(): SessionWithScope[] {
      const sessions = deps.sessionsRepo.listAll()
      const resolved: SessionWithScope[] = []
      for (const session of sessions) {
        const repo = deps.reposRepo.getById(session.repoId)
        if (!repo) continue
        const project = session.projectId ? (deps.projectsRepo.getById(session.projectId) ?? null) : null
        resolved.push({ session, repo, project })
      }
      return resolved
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/main/ipc/sessionHandlers.test.ts`
Expected: PASS (all existing tests plus the 2 new ones)

- [ ] **Step 6: Wire the IPC channel**

In `src/main/ipc/register.ts`, add this line right after
`ipcMain.handle('session:getMostRecent', () => handlers.session.getMostRecentSession())`:

```typescript
  ipcMain.handle('session:listAll', () => handlers.session.listAllSessions())
```

In `src/preload/index.ts`, add this line right after
`getMostRecent: () => ipcRenderer.invoke('session:getMostRecent'),`:

```typescript
    listAll: () => ipcRenderer.invoke('session:listAll'),
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/ipc/sessionHandlers.ts src/main/ipc/register.ts src/preload/index.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "Add listAllSessions handler and session:listAll IPC channel"
```

---

### Task 3: "All Sessions" view — component, toggle, and styling

**Files:**
- Create: `src/renderer/src/components/AllSessionsList.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.session.listAll()`, `SessionWithScope` (Task 2); `App.tsx`'s existing
  `handleOpenSession(session, scope)` and `scopeOf(repo, project)` (both already exist,
  unchanged).

- [ ] **Step 1: Create `AllSessionsList.tsx`**

```tsx
// src/renderer/src/components/AllSessionsList.tsx
import { useEffect, useState } from 'react'
import type { SessionWithScope } from '../../../shared/types'

interface Props {
  activeSessionId: string | undefined
  onOpenSession: (item: SessionWithScope) => void
}

/** A flat, cross-project session list -- unlike SessionList (scoped to one
 * repo/project), this fetches every session once and lets the user search
 * across all of them, sorted most-recently-opened first by the backend. */
export function AllSessionsList({ activeSessionId, onOpenSession }: Props): JSX.Element {
  const [items, setItems] = useState<SessionWithScope[]>([])
  const [query, setQuery] = useState('')
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.session.listAll().then(setItems)
  }, [])

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

  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? items.filter((item) => item.session.title.toLowerCase().includes(normalizedQuery))
    : items

  return (
    <div className="all-sessions">
      <div className="all-sessions-search">
        <input
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions..."
        />
      </div>
      <div className="tree-sessions">
        {filtered.map((item) => (
          <div
            key={item.session.id}
            className={`session-row${activeSessionId === item.session.id ? ' is-active' : ''}`}
          >
            <button className="session-row-select" onClick={() => onOpenSession(item)}>
              <span
                className={`session-row-status-dot${busySessionIds.has(item.session.id) ? ' is-busy' : ''}`}
              />
              <span className="session-row-title">{item.session.title}</span>
              <span className="all-sessions-repo-label">{item.repo.name}</span>
            </button>
          </div>
        ))}
        {filtered.length === 0 && <div className="sidebar-empty">No sessions found.</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the toggle and conditional render into `App.tsx`**

Add to the import block at the top of `src/renderer/src/App.tsx`:

```typescript
import type { Project, Repo, SessionRecord, SessionWithScope } from '../../shared/types'
import { AllSessionsList } from './components/AllSessionsList'
```

(this replaces the existing `import type { Project, Repo, SessionRecord } from '../../shared/types'`
line, adding `SessionWithScope`, and adds the new component import alongside the other
component imports.)

Add new state right after `const [sidebarCollapsed, setSidebarCollapsed] = useState(false)`:

```typescript
  const [sidebarView, setSidebarView] = useState<'scoped' | 'all'>('scoped')
```

Add a new handler function near `handleOpenSession`:

```typescript
  function handleOpenSessionFromAllSessions(item: SessionWithScope): void {
    handleOpenSession(item.session, scopeOf(item.repo, item.project))
  }
```

Replace this block in the JSX:

```tsx
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
```

with:

```tsx
          <div className="sidebar-header">
            <span>SESSIONS</span>
            <button
              type="button"
              className={`sidebar-view-toggle${sidebarView === 'all' ? ' is-active' : ''}`}
              onClick={() => setSidebarView((v) => (v === 'all' ? 'scoped' : 'all'))}
              title={sidebarView === 'all' ? 'Show scoped sessions' : 'Show all sessions'}
            >
              <ChatIcon />
            </button>
          </div>
          <RepoSwitcher
            scope={scope}
            onSelectRepo={handleSelectRepo}
            onSelectProject={handleSelectProject}
            onCreateSession={handleCreateSessionFromMenu}
          />
          <div className="sidebar-scroll">
            {sidebarView === 'all' ? (
              <AllSessionsList
                activeSessionId={selectedSession?.id}
                onOpenSession={handleOpenSessionFromAllSessions}
              />
            ) : scope ? (
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
```

Add `ChatIcon` to the existing icons import line
(`import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'` becomes):

```typescript
import { ChatIcon, ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
```

- [ ] **Step 3: Update `.sidebar-header` to a flex row and add the new styles**

In `src/renderer/src/theme.css`, replace:

```css
.sidebar-header {
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--sidebar-header-fg);
  flex-shrink: 0;
}
```

with:

```css
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3) var(--space-1);
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--sidebar-header-fg);
  flex-shrink: 0;
}

.sidebar-view-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--fg-dim);
}

.sidebar-view-toggle:hover {
  background: var(--list-hover);
  color: var(--fg-bright);
}

.sidebar-view-toggle.is-active {
  color: var(--accent);
}

.all-sessions {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.all-sessions-search {
  padding: 0 var(--space-2) var(--space-2);
  flex-shrink: 0;
}

.all-sessions-search .field {
  width: 100%;
  font-size: 12px;
}

.all-sessions-repo-label {
  flex-shrink: 0;
  margin-left: auto;
  max-width: 40%;
  padding-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: 10px;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 5: Manually verify**

Run: `npm run dev`
- Create sessions in at least 2 different repos/projects.
- Click the new toggle icon next to "SESSIONS"; confirm the sidebar switches to a flat list
  showing every session, most-recently-opened first, each row showing its repo name as a
  small trailing label.
- Type into the search box; confirm the list filters live to matching titles, and clearing it
  restores the full list.
- Click a session belonging to a different repo/project than whatever tab was open before;
  confirm it opens correctly (tab bar/editor switch to it) and the sidebar stays on "All
  Sessions" (toggle still shows active/highlighted).
- Click the toggle again; confirm it returns to the normal scoped session list, unaffected by
  anything done in "All Sessions" mode.
- Start a prompt in a session, then switch to "All Sessions"; confirm that session's row shows
  the pulsing busy dot while it's running.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/AllSessionsList.tsx src/renderer/src/App.tsx src/renderer/src/theme.css
git commit -m "Add All Sessions sidebar view with cross-project search"
```

## Self-Review Notes

- **Spec coverage:** `listAll()` data layer + ordering → Task 1; `SessionWithScope` +
  `listAllSessions()` + IPC contract + orphaned-repo skip behavior → Task 2; toggle
  (independent of `scope`), flat sorted list, repo label per row, search box, click-opens-
  without-switching-view-back → Task 3. All four goals and all four non-goals from the spec
  are covered — no new sort options, no search in the scoped view, no change to
  `sessionMatchesScope`/`handleOpenSession`/tab logic, no grouping in the new view.
- **Placeholder scan:** no TBD/TODO markers; every step shows the final, complete code to
  add, with no draft/throwaway intermediate attempts left in.
- **Type consistency:** `SessionWithScope`'s fields (`session`, `repo`, `project`) are used
  identically via dot-access in Task 2's handler implementation and Task 3's component
  (`item.session`, `item.repo`, `item.project`) — no renaming drift. `AllSessionsList`'s
  `onOpenSession: (item: SessionWithScope) => void` prop type matches exactly what
  `App.tsx`'s `handleOpenSessionFromAllSessions` accepts and what the component's `onClick`
  passes (`onOpenSession(item)`, not a partial/reshaped object).
