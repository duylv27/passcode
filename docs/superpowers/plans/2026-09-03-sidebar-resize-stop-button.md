# Resizable Sidebar, Split Stop Button & Sidebar Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sidebar thinner and drag-resizable, split the composer's overloaded Send/Stop button into two dedicated buttons, and add three sidebar enhancements: a running-session indicator, per-repo git branch/status, and collapsible session groups in project scope.

**Architecture:** All changes are additive to the existing Electron + React renderer (`src/renderer/src`) and its main-process IPC layer (`src/main`). Two small pure-logic modules (`src/renderer/src/lib/sidebarWidth.ts`, `src/renderer/src/lib/sessionGroups.ts`) carry the only unit-testable logic; everything else is direct component/CSS editing verified manually by running the app, matching this repo's existing test coverage pattern (main-process logic has vitest tests, renderer wiring does not).

**Tech Stack:** React 18, TypeScript (strict), Electron IPC (`ipcMain.handle` / `contextBridge`), `simple-git`, Vitest (`environment: 'node'`, `tests/**/*.test.ts`).

## Global Constraints

- Sidebar default width: 180px (was 240px). Resizable range: 150px–400px. Width persists to `localStorage` key `passcode-sidebar-width`.
- Composer Stop button: disabled/greyed while idle, active while busy. Composer Send button: always labeled "Send", always enabled when there's input text (regardless of busy state), clicking it while busy queues the message.
- No polling for git status or busy state — both are event/load driven only (per spec's Non-goals).
- No renderer component tests — this repo has none (`vitest.config.mts` has no jsdom/react setup); verify renderer changes by running `npm run dev` and interacting, plus `npx tsc -p tsconfig.web.json --noEmit` for type safety. Main-process changes get real vitest tests, matching `tests/main/**` conventions.
- Follow existing code style: no comments except where a hidden constraint/invariant needs explaining (this repo's existing files show that pattern throughout — see `App.tsx`'s doc comments).

---

### Task 1: Sidebar width clamp helper

**Files:**
- Create: `src/renderer/src/lib/sidebarWidth.ts`
- Test: `tests/renderer/lib/sidebarWidth.test.ts`

**Interfaces:**
- Produces: `SIDEBAR_MIN_WIDTH: number`, `SIDEBAR_MAX_WIDTH: number`, `SIDEBAR_DEFAULT_WIDTH: number`, `SIDEBAR_WIDTH_KEY: string`, `clampSidebarWidth(width: number): number` — consumed by Task 2 (`App.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/lib/sidebarWidth.test.ts
import { describe, it, expect } from 'vitest'
import { clampSidebarWidth, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../../../src/renderer/src/lib/sidebarWidth'

describe('clampSidebarWidth', () => {
  it('leaves an in-range width untouched', () => {
    expect(clampSidebarWidth(200)).toBe(200)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('clamps a value exactly at the bounds to itself', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/lib/sidebarWidth.test.ts`
Expected: FAIL — `Cannot find module '../../../src/renderer/src/lib/sidebarWidth'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/renderer/src/lib/sidebarWidth.ts
export const SIDEBAR_MIN_WIDTH = 150
export const SIDEBAR_MAX_WIDTH = 400
export const SIDEBAR_DEFAULT_WIDTH = 180
export const SIDEBAR_WIDTH_KEY = 'passcode-sidebar-width'

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer/lib/sidebarWidth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/sidebarWidth.ts tests/renderer/lib/sidebarWidth.test.ts
git commit -m "Add sidebar width clamping helper"
```

---

### Task 2: Resizable sidebar UI

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `clampSidebarWidth`, `SIDEBAR_DEFAULT_WIDTH`, `SIDEBAR_WIDTH_KEY` from `./lib/sidebarWidth` (Task 1).

- [ ] **Step 1: Add the width state and resize handler to `App.tsx`**

Add the import alongside the existing ones at the top of `src/renderer/src/App.tsx`:

```typescript
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_WIDTH_KEY } from './lib/sidebarWidth'
```

(this replaces the existing `import { useEffect, useState } from 'react'` line)

Inside `App()`, add a new piece of state right after `sidebarCollapsed`:

```typescript
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      return raw ? clampSidebarWidth(Number(raw)) : SIDEBAR_DEFAULT_WIDTH
    } catch {
      return SIDEBAR_DEFAULT_WIDTH
    }
  })
```

Add the drag handler as a new function, near `handleExplorerClick`:

```typescript
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
```

- [ ] **Step 2: Wire the width and handle into the sidebar JSX**

Replace this block in `App.tsx`:

```tsx
        <div className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
          <div className="sidebar-header">SESSIONS</div>
          <RepoSwitcher scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
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
        </div>
```

with:

```tsx
        <div
          className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}
          style={{ width: sidebarWidth }}
        >
          <div className="sidebar-header">SESSIONS</div>
          <RepoSwitcher scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
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
```

- [ ] **Step 3: Update `.sidebar` CSS and add the resize handle style**

In `src/renderer/src/theme.css`, replace:

```css
.sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-subtle);
  min-height: 0;
}
```

with:

```css
.sidebar {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-subtle);
  min-height: 0;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  z-index: 5;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: var(--accent);
  opacity: 0.4;
}
```

(width is no longer set in CSS — it now comes from the `style` prop in `App.tsx`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 5: Manually verify**

Run: `npm run dev`
- Confirm the sidebar opens at ~180px (noticeably thinner than before).
- Drag the thin strip on the sidebar's right edge; confirm it resizes smoothly and stops at 150px/400px.
- Restart the app (`Ctrl+C` the dev process, `npm run dev` again); confirm the resized width persisted.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/theme.css
git commit -m "Make the sidebar thinner by default and drag-resizable"
```

---

### Task 3: Split the composer's Stop button out from Send

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: existing `busy` state, `handleSend`, `handleStop` in `ChatPanel.tsx` (both unchanged internally).

- [ ] **Step 1: Replace the composer button JSX**

In `src/renderer/src/components/ChatPanel.tsx`, replace:

```tsx
          <button
            className={`composer-send${busy ? ' is-stop' : ''}`}
            onClick={busy ? handleStop : handleSend}
            disabled={!busy && !input.trim()}
            title={busy ? 'Stop' : 'Send'}
          >
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
```

with:

```tsx
          <button className="composer-stop" onClick={handleStop} disabled={!busy} title="Stop">
            <StopIcon />
          </button>
          <button className="composer-send" onClick={handleSend} disabled={!input.trim()} title="Send">
            <SendIcon />
          </button>
```

`handleSend` and `handleStop` themselves are unchanged — `handleSend` already branches on `busy` internally (queues when busy, sends immediately otherwise), and `handleStop` already clears the queue, resets `busy`/`thinking`, and calls `window.api.session.abort`.

- [ ] **Step 2: Update the composer button CSS**

In `src/renderer/src/theme.css`, replace:

```css
.composer-send.is-stop {
  background: var(--danger);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(205, 49, 49, 0.35);
}

.composer-send.is-stop:hover {
  background: #b3261e;
  box-shadow: 0 2px 6px rgba(205, 49, 49, 0.4);
}
```

with:

```css
.composer-stop {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 6px;
  background: none;
  border: 1px solid var(--border);
  color: var(--danger);
}

.composer-stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-color: var(--danger);
}

.composer-stop:disabled {
  color: var(--fg-dim);
  border-color: var(--border-subtle);
  opacity: 0.5;
  cursor: default;
}
```

(leave the rest of the `.composer-send` rules — the circular purple button, its `:hover`, `:active`, and `:disabled` states — untouched; only the `.is-stop` variant is removed since Send no longer changes appearance.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 4: Manually verify**

Run: `npm run dev`
- Open a session, confirm Send is enabled once you type, and Stop is greyed out/disabled.
- Send a prompt; while it's running, confirm Stop becomes active (clickable) and Send stays labeled "Send" and enabled.
- Type another message while busy and click Send; confirm it's added to the queue (shown in the `composer-hint` as "N queued"), not sent immediately.
- Click Stop while busy; confirm the session aborts immediately and the queue clears.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/theme.css
git commit -m "Split composer Stop into its own dedicated button"
```

---

### Task 4: Git status backend

**Files:**
- Modify: `src/main/git/gitStatus.ts`
- Modify: `src/main/ipc/reposHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/git/gitStatus.test.ts`
- Test: `tests/main/ipc/reposHandlers.test.ts`

**Interfaces:**
- Produces: `GitStatus` type (`{ branch: string | null; dirty: boolean }`) in `shared/types.ts`; `getGitStatus(path: string): Promise<GitStatus | null>` in `main/git/gitStatus.ts`; `ReposHandlers.getGitStatus(id: string): Promise<GitStatus | null>`; `window.api.repos.gitStatus(id: string): Promise<GitStatus | null>` — all consumed by Task 5 (`RepoList.tsx`).

- [ ] **Step 1: Add the `GitStatus` type**

In `src/shared/types.ts`, add near the other small interfaces (e.g. right after `AddRepoError`):

```typescript
export interface GitStatus {
  branch: string | null
  dirty: boolean
}
```

Add `gitStatus` to the `repos` namespace of the `Api` interface:

```typescript
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
    gitStatus(id: string): Promise<GitStatus | null>
  }
```

- [ ] **Step 2: Write the failing test for `getGitStatus`**

```typescript
// tests/main/git/gitStatus.test.ts — add to the existing file, inside the same describe block
  it('reports null for a plain (non-git) folder', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pi-agent-plain-'))
    expect(await getGitStatus(plain)).toBe(null)
    rmSync(plain, { recursive: true, force: true })
  })

  it('reports the current branch and a clean status for a fresh commit', async () => {
    const status = await getGitStatus(dir)
    expect(status).not.toBe(null)
    expect(status?.dirty).toBe(false)
  })

  it('reports dirty when there are uncommitted changes', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed')
    const status = await getGitStatus(dir)
    expect(status?.dirty).toBe(true)
  })
```

Update the import line at the top of the file to:

```typescript
import { isGitRepo, getGitStatus } from '../../../src/main/git/gitStatus'
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- tests/main/git/gitStatus.test.ts`
Expected: FAIL — `getGitStatus is not a function` (or similar import error)

- [ ] **Step 4: Implement `getGitStatus`**

Replace the full contents of `src/main/git/gitStatus.ts` with:

```typescript
import simpleGit from 'simple-git'
import type { GitStatus } from '../../shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}

export async function getGitStatus(path: string): Promise<GitStatus | null> {
  try {
    const git = simpleGit(path)
    if (!(await git.checkIsRepo())) return null
    const status = await git.status()
    return { branch: status.current, dirty: !status.isClean() }
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/main/git/gitStatus.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Write the failing test for `ReposHandlers.getGitStatus`**

Add to `tests/main/ipc/reposHandlers.test.ts`:

```typescript
  it('returns git status for a known repo', async () => {
    const added = await handlers.addRepo(projectId, '/tmp/my-repo')
    if (!added.ok) throw new Error('setup failed')
    const status = await handlers.getGitStatus(added.repo.id)
    expect(status).toEqual({ branch: 'main', dirty: false })
  })

  it('returns null for an unknown repo id', async () => {
    const status = await handlers.getGitStatus('does-not-exist')
    expect(status).toBe(null)
  })
```

Update the `beforeEach` in that file to create and pass a `getGitStatusMock`:

```typescript
  let handlers: ReposHandlers
  let projectId: string
  let isGitRepoMock: ReturnType<typeof vi.fn>
  let getGitStatusMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    projectId = createProjectsRepository(db).create('Demo').id
    isGitRepoMock = vi.fn(async () => true)
    getGitStatusMock = vi.fn(async () => ({ branch: 'main', dirty: false }))
    handlers = createReposHandlers(createReposRepository(db), isGitRepoMock, getGitStatusMock)
  })
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test -- tests/main/ipc/reposHandlers.test.ts`
Expected: FAIL — `createReposHandlers` called with too many arguments doesn't yet match its signature, or `handlers.getGitStatus is not a function`

- [ ] **Step 8: Implement `ReposHandlers.getGitStatus`**

Replace the full contents of `src/main/ipc/reposHandlers.ts` with:

```typescript
import { basename } from 'node:path'
import type { ReposRepository } from '../db/reposRepository'
import type { AddRepoResult, AddRepoError, GitStatus, Repo } from '../../shared/types'

export interface ReposHandlers {
  addRepo(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
  listRepos(projectId: string): Repo[]
  deleteRepo(id: string): void
  getGitStatus(id: string): Promise<GitStatus | null>
}

export function createReposHandlers(
  repo: ReposRepository,
  isGitRepo: (path: string) => Promise<boolean>,
  getGitStatus: (path: string) => Promise<GitStatus | null>
): ReposHandlers {
  return {
    async addRepo(projectId: string, path: string): Promise<AddRepoResult | AddRepoError> {
      const valid = await isGitRepo(path)
      if (!valid) {
        return { ok: false, error: `"${path}" is not a git repository` }
      }
      return { ok: true, repo: repo.create(projectId, path, basename(path)) }
    },
    listRepos(projectId: string): Repo[] {
      return repo.listByProject(projectId)
    },
    deleteRepo(id: string): void {
      repo.delete(id)
    },
    async getGitStatus(id: string): Promise<GitStatus | null> {
      const found = repo.getById(id)
      if (!found) return null
      return getGitStatus(found.path)
    }
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- tests/main/ipc/reposHandlers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Wire the IPC channel**

In `src/main/ipc/register.ts`, add after the `repos:delete` line:

```typescript
  ipcMain.handle('repos:gitStatus', (_e, id: string) => handlers.repos.getGitStatus(id))
```

In `src/preload/index.ts`, add `gitStatus` to the `repos` object:

```typescript
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id),
    gitStatus: (id) => ipcRenderer.invoke('repos:gitStatus', id)
  },
```

In `src/main/index.ts`, update the import and the `createReposHandlers` call:

```typescript
import { isGitRepo, getGitStatus } from './git/gitStatus'
```

```typescript
    repos: createReposHandlers(reposRepo, isGitRepo, getGitStatus),
```

- [ ] **Step 11: Typecheck both processes**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors

- [ ] **Step 12: Run the full main-process test suite**

Run: `npm test`
Expected: all tests PASS

- [ ] **Step 13: Commit**

```bash
git add src/main/git/gitStatus.ts src/main/ipc/reposHandlers.ts src/main/ipc/register.ts src/main/index.ts src/preload/index.ts src/shared/types.ts tests/main/git/gitStatus.test.ts tests/main/ipc/reposHandlers.test.ts
git commit -m "Add repos:gitStatus IPC channel for per-repo branch/dirty status"
```

---

### Task 5: Git branch/status UI in the repo picker

**Files:**
- Modify: `src/renderer/src/components/RepoList.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.repos.gitStatus(id)` and `GitStatus` from Task 4.

- [ ] **Step 1: Fetch and render git status per repo**

Replace the full contents of `src/renderer/src/components/RepoList.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo } from '../../../shared/types'
import { PlusIcon, RepoIcon } from './icons'

interface Props {
  project: Project
  selectedRepo: Repo | null
  onSelectRepo: (repo: Repo) => void
}

export function RepoList({ project, selectedRepo, onSelectRepo }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    const list = await window.api.repos.list(project.id)
    setRepos(list)
    const entries = await Promise.all(
      list.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id)] as const)
    )
    setGitStatuses(Object.fromEntries(entries))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  async function handleAdd(): Promise<void> {
    if (!path.trim()) return
    setError(null)
    const result = await window.api.repos.add(project.id, path.trim())
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPath('')
    setAdding(false)
    await refresh()
  }

  return (
    <>
      {repos.map((r) => {
        const status = gitStatuses[r.id]
        return (
          <button
            key={r.id}
            className={`picker-row${selectedRepo?.id === r.id ? ' is-selected' : ''}`}
            onClick={() => onSelectRepo(r)}
          >
            <RepoIcon className="row-icon is-repo" />
            <span className="picker-row-name">{r.name}</span>
            {status && (
              <span className="picker-row-git">
                {status.branch && <span className="picker-row-branch">{status.branch}</span>}
                <span className={`repo-status-dot${status.dirty ? ' is-dirty' : ''}`} />
              </span>
            )}
          </button>
        )
      })}
      {adding ? (
        <div className="picker-inline-form">
          <input
            className="field"
            autoFocus
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              else if (e.key === 'Escape') setAdding(false)
            }}
            onBlur={() => {
              if (!path.trim()) setAdding(false)
            }}
            placeholder="/path/to/repo"
          />
          <button className="btn" onClick={handleAdd}>
            Add
          </button>
        </div>
      ) : (
        <button className="picker-add-row" onClick={() => setAdding(true)}>
          <PlusIcon className="row-icon" />
          <span>Add repo</span>
        </button>
      )}
      {error && <div className="error-text">{error}</div>}
    </>
  )
}
```

- [ ] **Step 2: Update `.picker-row` CSS to support the trailing git badge**

In `src/renderer/src/theme.css`, replace:

```css
.picker-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--fg);
  font-size: 12.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

with:

```css
.picker-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--fg);
  font-size: 12.5px;
}

.picker-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-row-git {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.picker-row-branch {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-dim);
}

.repo-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: transparent;
  flex-shrink: 0;
}

.repo-status-dot.is-dirty {
  border-color: var(--danger);
  background: var(--danger);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 4: Manually verify**

Run: `npm run dev`
- Open the repo switcher dropdown for a project with at least one git repo added.
- Confirm each repo row shows its branch name and an outline (clean) dot.
- Make an uncommitted change in that repo on disk, reopen the dropdown (it refetches on mount), confirm the dot fills in (dirty).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/RepoList.tsx src/renderer/src/theme.css
git commit -m "Show git branch and dirty status next to each repo in the picker"
```

---

### Task 6: Session grouping helper

**Files:**
- Create: `src/renderer/src/lib/sessionGroups.ts`
- Test: `tests/renderer/lib/sessionGroups.test.ts`

**Interfaces:**
- Produces: `SessionGroup` (`{ repo: Repo; sessions: SessionRecord[] }`), `groupSessionsByRepo(sessions: SessionRecord[], repos: Repo[]): SessionGroup[]` — consumed by Task 7 (`SessionList.tsx`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/lib/sessionGroups.test.ts
import { describe, it, expect } from 'vitest'
import { groupSessionsByRepo } from '../../../src/renderer/src/lib/sessionGroups'
import type { Repo, SessionRecord } from '../../../src/shared/types'

function repo(id: string): Repo {
  return { id, projectId: 'p1', path: `/repos/${id}`, name: id }
}

function session(id: string, repoId: string): SessionRecord {
  return { id, repoId, projectId: 'p1', piSessionId: `pi-${id}`, title: id, createdAt: '2026-01-01' }
}

describe('groupSessionsByRepo', () => {
  it('groups sessions under their repo, preserving repo order', () => {
    const repos = [repo('a'), repo('b')]
    const sessions = [session('s1', 'b'), session('s2', 'a'), session('s3', 'a')]
    const groups = groupSessionsByRepo(sessions, repos)
    expect(groups.map((g) => g.repo.id)).toEqual(['a', 'b'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('omits repos with no sessions', () => {
    const repos = [repo('a'), repo('b')]
    const sessions = [session('s1', 'a')]
    const groups = groupSessionsByRepo(sessions, repos)
    expect(groups.map((g) => g.repo.id)).toEqual(['a'])
  })

  it('returns an empty array when there are no sessions', () => {
    expect(groupSessionsByRepo([], [repo('a')])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/lib/sessionGroups.test.ts`
Expected: FAIL — `Cannot find module '../../../src/renderer/src/lib/sessionGroups'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/renderer/src/lib/sessionGroups.ts
import type { Repo, SessionRecord } from '../../../shared/types'

export interface SessionGroup {
  repo: Repo
  sessions: SessionRecord[]
}

export function groupSessionsByRepo(sessions: SessionRecord[], repos: Repo[]): SessionGroup[] {
  return repos
    .map((repo) => ({ repo, sessions: sessions.filter((s) => s.repoId === repo.id) }))
    .filter((group) => group.sessions.length > 0)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer/lib/sessionGroups.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/sessionGroups.ts tests/renderer/lib/sessionGroups.test.ts
git commit -m "Add session-by-repo grouping helper"
```

---

### Task 7: Sidebar session list — running indicator + collapsible repo groups

**Files:**
- Modify: `src/renderer/src/components/SessionList.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `groupSessionsByRepo` from Task 6; `window.api.session.onEvent` (existing, global `session:event` channel — already broadcasts `{ type: 'busy', busy }` for every session regardless of which one is open, confirmed via `preload/index.ts` and `main/ipc/sessionHandlers.ts`'s `busySessions` tracking).

- [ ] **Step 1: Rewrite `SessionList.tsx`**

Replace the full contents of `src/renderer/src/components/SessionList.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { Repo, SessionRecord } from '../../../shared/types'
import type { Scope } from './RepoSwitcher'
import { groupSessionsByRepo } from '../lib/sessionGroups'
import { ChatIcon, ChevronIcon, EditIcon, PlusIcon, RepoIcon, TrashIcon } from './icons'

interface Props {
  scope: Scope
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord) => void
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

export function SessionList({
  scope,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed
}: Props): JSX.Element {
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [projectRepos, setProjectRepos] = useState<Repo[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const scopeKey = scope.kind === 'repo' ? `repo:${scope.repo.id}` : `project:${scope.project.id}`

  async function refresh(): Promise<void> {
    const list =
      scope.kind === 'repo' ? await window.api.session.list(scope.repo.id) : await window.api.session.listByProject(scope.project.id)
    setSessions(list)
  }

  useEffect(() => {
    refresh()
    setError(null)
    if (scope.kind === 'project') {
      window.api.repos.list(scope.project.id).then(setProjectRepos)
      setCollapsed(readCollapsed(scope.project.id))
    } else {
      setProjectRepos([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

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
    if (scope.kind !== 'project') return
    const projectId = scope.project.id
    setCollapsed((prev) => {
      const next = { ...prev, [repoId]: !prev[repoId] }
      try {
        localStorage.setItem(collapsedStorageKey(projectId), JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
  }

  async function handleCreate(): Promise<void> {
    if (scope.kind === 'repo') {
      const created = await window.api.session.create(scope.repo.id)
      await refresh()
      onOpenSession(created)
      return
    }
    setError(null)
    const result = await window.api.session.createProjectSession(scope.project.id)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refresh()
    onOpenSession(result.session)
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
    setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, title } : s)))
    onSessionRenamed({ ...session, title })
  }

  function renderSessionRow(s: SessionRecord): JSX.Element {
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
        <button className="session-row-select" onClick={() => onOpenSession(s)}>
          <ChatIcon className="row-icon is-session" />
          {busySessionIds.has(s.id) && <span className="session-row-busy-dot" />}
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
      {scope.kind === 'project' && projectRepos.length > 0
        ? groupSessionsByRepo(sessions, projectRepos).map((group) => (
            <div key={group.repo.id} className="session-group">
              <button className="session-group-header" onClick={() => toggleGroup(group.repo.id)}>
                <ChevronIcon className={`session-group-chevron${collapsed[group.repo.id] ? '' : ' is-open'}`} />
                <RepoIcon className="row-icon is-repo" />
                <span className="session-group-label">{group.repo.name}</span>
              </button>
              {!collapsed[group.repo.id] && group.sessions.map(renderSessionRow)}
            </div>
          ))
        : sessions.map(renderSessionRow)}
      <button className="session-row is-add" onClick={handleCreate}>
        <PlusIcon className="row-icon" />
        <span>New session</span>
      </button>
      {error && <div className="error-text">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 2: Remove the now-unused "Repo roommates" CSS and add the new group/indicator CSS**

In `src/renderer/src/theme.css`, remove these now-dead rules (the "Repo roommates" block they styled no longer exists in `SessionList.tsx`):

```css
.scope-repos {
  padding: 2px var(--space-2) 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border-subtle);
}

.scope-repos-label {
  padding: 2px 0 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

.scope-repos-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  color: var(--fg-dim);
  font-size: 12px;
}

.scope-repos-item .row-icon.is-repo {
  flex-shrink: 0;
  color: #6a9955;
}
```

Add this new CSS directly after the `.tree-sessions` rule:

```css
.session-group + .session-group {
  margin-top: 2px;
}

.session-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 3px var(--space-2);
  background: none;
  border: none;
  color: var(--fg-dim);
  font-size: 11.5px;
  font-weight: 600;
}

.session-group-header:hover {
  background: var(--list-hover);
  color: var(--fg-bright);
}

.session-group-header .row-icon.is-repo {
  color: #6a9955;
}

.session-group-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-group-chevron {
  flex-shrink: 0;
  color: var(--fg-dim);
  transition: transform 100ms ease;
}

.session-group-chevron.is-open {
  transform: rotate(90deg);
}
```

Add this next to the other `.session-row-*` rules (after `.row-icon.is-session`):

```css
.session-row-busy-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: status-pulse 1.2s ease-in-out infinite;
}
```

(`status-pulse` is the existing `@keyframes` already defined for `.timeline-dot.is-running` — no new keyframes needed.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 4: Manually verify**

Run: `npm run dev`
- In repo scope, confirm the session list still renders as a flat list (unchanged).
- In project scope with 2+ repos, confirm sessions are grouped under collapsible repo headers; click a header to collapse/expand it.
- Restart the app, reselect the same project, confirm the collapsed state persisted.
- Open a session and send a prompt; while it's running, switch to a different tab/session and confirm the busy one's sidebar row shows a pulsing dot; confirm the dot disappears once that session's turn ends.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/SessionList.tsx src/renderer/src/theme.css
git commit -m "Add running-session indicator and collapsible repo groups to the sidebar"
```

---

## Self-Review Notes

- **Spec coverage:** resizable/thinner sidebar → Tasks 1–2; split stop button → Task 3; running-session indicator → Task 7; git branch/status → Tasks 4–5; collapsible session groups → Tasks 6–7. All five spec goals covered.
- **Placeholder scan:** no TBD/TODO markers; every step shows complete, runnable code.
- **Type consistency:** `GitStatus` defined once in `shared/types.ts` (Task 4) and reused verbatim in `RepoList.tsx` (Task 5); `SessionGroup`/`groupSessionsByRepo` defined once in `lib/sessionGroups.ts` (Task 6) and reused verbatim in `SessionList.tsx` (Task 7); `clampSidebarWidth`/`SIDEBAR_*` constants defined once in `lib/sidebarWidth.ts` (Task 1) and reused verbatim in `App.tsx` (Task 2).
