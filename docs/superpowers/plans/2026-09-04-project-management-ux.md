# Project Management UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PassCode's inline-text project creation and "Add repo" path-typing with a native folder picker and a creation modal, add a read-only per-project info popup (repos + git status), and add hover-revealed rename/delete on each project box header.

**Architecture:** A new `files.pickFolder()` main-process IPC method (parallel to the existing `pickFile()`) backs a native OS folder picker, reused by a new `NewProjectDialog` modal and by `ProjectBox`'s existing "Add repo" row. A new `projects.rename()` IPC method (mirroring `session.rename()`) backs an inline rename on the project box header. A new `ProjectInfoDialog` modal reads existing `repos.list`/`repos.gitStatus` data. All new modals reuse the established `.xxx-overlay`/`.xxx-dialog` CSS pattern from `AboutDialog`/`SettingsPanel`.

**Tech Stack:** Electron (`dialog.showOpenDialog`), React/TypeScript renderer, `node:sqlite` `DatabaseSync`, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-04-project-management-ux-design.md` — every task below implements one of its Approach subsections.
- 1:1 project-repo model: every project has exactly one repo (see `src/main/db/migrateSingleRepoProjects.ts`). New-project creation must always create the project's one repo in the same flow — never leave an empty, repo-less project behind on failure.
- No renderer component tests exist in this repo (no jsdom) — renderer changes are verified by `npx tsc -p tsconfig.web.json --noEmit` (must stay clean) plus manual interaction, matching every existing renderer component here. Only main-process/backend changes get real Vitest tests.
- **Environment note:** this sandbox runs Node 20.19.4; `node:sqlite`'s `DatabaseSync` requires Node ≥22.19.0. Tests under `tests/main/db/**` and any test that imports `node:sqlite` (directly or via a repository) fail to *load* in this environment ("Failed to load url sqlite") — this is pre-existing and environment-wide, not something introduced by or fixable within this plan. Write every test specified below regardless (TDD steps are still required); if `npm test` can't load them here, say so in the task report rather than treating it as a task failure.
- Follow existing patterns exactly: CSS classes are per-component (`<name>-overlay`/`<name>-dialog`, see `AboutDialog.tsx`/`SettingsPanel.tsx`), hover-reveal icons use `visibility: hidden`/`visibility: visible` (never `display`, which caused a layout-shift bug fixed earlier in this project), IPC handlers are `camelCase` in `shared/types.ts`/`preload/index.ts` and `colon:camelCase` channel names in `register.ts`.

---

### Task 1: `files.pickFolder()` IPC method

**Files:**
- Modify: `src/main/ipc/filesHandlers.ts`
- Modify: `src/main/index.ts:123-125`
- Modify: `src/main/ipc/register.ts:66`
- Modify: `src/preload/index.ts:43-45`
- Modify: `src/shared/types.ts:176-178`
- Test: `tests/main/ipc/filesHandlers.test.ts`

**Interfaces:**
- Produces: `FilesHandlers.pickFolder(): Promise<string | null>`, exposed as `window.api.files.pickFolder(): Promise<string | null>`. Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `tests/main/ipc/filesHandlers.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createFilesHandlers } from '../../../src/main/ipc/filesHandlers'

function makeHandlers(overrides: { filePaths?: string[]; canceled?: boolean } = {}) {
  const showOpenDialog = vi.fn(async () => ({
    canceled: overrides.canceled ?? false,
    filePaths: overrides.filePaths ?? []
  }))
  const showOpenFolderDialog = vi.fn(async () => ({
    canceled: overrides.canceled ?? false,
    filePaths: overrides.filePaths ?? []
  }))
  return { handlers: createFilesHandlers({ showOpenDialog, showOpenFolderDialog }), showOpenDialog, showOpenFolderDialog }
}

describe('filesHandlers', () => {
  it('returns the first selected path when a file is picked', async () => {
    const { handlers } = makeHandlers({ filePaths: ['/repo/notes.txt', '/repo/other.txt'] })
    expect(await handlers.pickFile()).toBe('/repo/notes.txt')
  })

  it('returns null when the file dialog is canceled', async () => {
    const { handlers } = makeHandlers({ canceled: true })
    expect(await handlers.pickFile()).toBeNull()
  })

  it('returns null when no file path is returned even though not canceled', async () => {
    const { handlers } = makeHandlers({ filePaths: [] })
    expect(await handlers.pickFile()).toBeNull()
  })

  it('returns the first selected path when a folder is picked', async () => {
    const { handlers, showOpenFolderDialog } = makeHandlers({ filePaths: ['/repos/passcode-desktop'] })
    expect(await handlers.pickFolder()).toBe('/repos/passcode-desktop')
    expect(showOpenFolderDialog).toHaveBeenCalledTimes(1)
  })

  it('returns null when the folder dialog is canceled', async () => {
    const { handlers } = makeHandlers({ canceled: true })
    expect(await handlers.pickFolder()).toBeNull()
  })

  it('returns null when no folder path is returned even though not canceled', async () => {
    const { handlers } = makeHandlers({ filePaths: [] })
    expect(await handlers.pickFolder()).toBeNull()
  })

  it('does not call the folder dialog when picking a file', async () => {
    const { handlers, showOpenFolderDialog } = makeHandlers({ filePaths: ['/repo/notes.txt'] })
    await handlers.pickFile()
    expect(showOpenFolderDialog).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/filesHandlers.test.ts`
Expected: FAIL — `createFilesHandlers` rejects the `showOpenFolderDialog` deps property (TS) or `handlers.pickFolder` is not a function.

- [ ] **Step 3: Implement `pickFolder()`**

Replace the full contents of `src/main/ipc/filesHandlers.ts` with:

```typescript
export interface FilesHandlersDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  showOpenFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface FilesHandlers {
  pickFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
}

export function createFilesHandlers(deps: FilesHandlersDeps): FilesHandlers {
  return {
    async pickFile(): Promise<string | null> {
      const result = await deps.showOpenDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    async pickFolder(): Promise<string | null> {
      const result = await deps.showOpenFolderDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/filesHandlers.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Wire the new dependency in the main process**

In `src/main/index.ts`, replace:

```typescript
    files: createFilesHandlers({
      showOpenDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openFile'] })
    }),
```

with:

```typescript
    files: createFilesHandlers({
      showOpenDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }),
      showOpenFolderDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    }),
```

- [ ] **Step 6: Register the IPC channel**

In `src/main/ipc/register.ts`, replace:

```typescript
  ipcMain.handle('files:pickFile', () => handlers.files.pickFile())
```

with:

```typescript
  ipcMain.handle('files:pickFile', () => handlers.files.pickFile())
  ipcMain.handle('files:pickFolder', () => handlers.files.pickFolder())
```

- [ ] **Step 7: Expose it in preload**

In `src/preload/index.ts`, replace:

```typescript
  files: {
    pickFile: () => ipcRenderer.invoke('files:pickFile')
  },
```

with:

```typescript
  files: {
    pickFile: () => ipcRenderer.invoke('files:pickFile'),
    pickFolder: () => ipcRenderer.invoke('files:pickFolder')
  },
```

- [ ] **Step 8: Add it to the shared `Api` type**

In `src/shared/types.ts`, replace:

```typescript
  files: {
    pickFile(): Promise<string | null>
  }
```

with:

```typescript
  files: {
    pickFile(): Promise<string | null>
    pickFolder(): Promise<string | null>
  }
```

- [ ] **Step 9: Typecheck the main/preload/shared changes**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/main/ipc/filesHandlers.ts src/main/index.ts src/main/ipc/register.ts src/preload/index.ts src/shared/types.ts tests/main/ipc/filesHandlers.test.ts
git commit -m "feat: add files.pickFolder IPC method for native folder picking"
```

---

### Task 2: `projects.rename()` IPC method

**Files:**
- Modify: `src/main/db/projectsRepository.ts`
- Modify: `src/main/ipc/projectsHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/db/projectsRepository.test.ts`
- Test: `tests/main/ipc/projectsHandlers.test.ts`

**Interfaces:**
- Produces: `ProjectsRepository.rename(id: string, name: string): void`, `ProjectsHandlers.renameProject(id: string, name: string): void`, exposed as `window.api.projects.rename(id: string, name: string): Promise<void>`. Consumed by Task 6.

- [ ] **Step 1: Write the failing repository test**

In `tests/main/db/projectsRepository.test.ts`, add this test inside the existing `describe('ProjectsRepository', ...)` block, after the `'deletes a project'` test:

```typescript
  it('renames a project', () => {
    const created = repo.create('Old Name')
    repo.rename(created.id, 'New Name')
    expect(repo.getById(created.id)?.name).toBe('New Name')
  })
```

- [ ] **Step 2: Write the failing handler tests**

In `tests/main/ipc/projectsHandlers.test.ts`, add these tests inside the existing `describe('projectsHandlers', ...)` block, after the `'rejects an empty name'` test:

```typescript
  it('renames a project', () => {
    const project = handlers.createProject('Old Name')
    handlers.renameProject(project.id, 'New Name')
    expect(handlers.listProjects()[0].name).toBe('New Name')
  })

  it('rejects renaming to an empty name', () => {
    const project = handlers.createProject('Demo')
    expect(() => handlers.renameProject(project.id, '   ')).toThrow('Project name must not be empty')
  })
```

- [ ] **Step 3: Run both test files to verify they fail**

Run: `npx vitest run tests/main/db/projectsRepository.test.ts tests/main/ipc/projectsHandlers.test.ts`
Expected: FAIL — `repo.rename` / `handlers.renameProject` is not a function.

- [ ] **Step 4: Implement `ProjectsRepository.rename`**

In `src/main/db/projectsRepository.ts`, replace:

```typescript
export interface ProjectsRepository {
  create(name: string): Project
  list(): Project[]
  getById(id: string): Project | undefined
  delete(id: string): void
}
```

with:

```typescript
export interface ProjectsRepository {
  create(name: string): Project
  list(): Project[]
  getById(id: string): Project | undefined
  rename(id: string, name: string): void
  delete(id: string): void
}
```

and replace:

```typescript
    delete(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    }
```

with:

```typescript
    rename(id: string, name: string): void {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id)
    },
    delete(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    }
```

- [ ] **Step 5: Implement `ProjectsHandlers.renameProject`**

Replace the full contents of `src/main/ipc/projectsHandlers.ts` with:

```typescript
import type { ProjectsRepository } from '../db/projectsRepository'
import type { Project } from '../../shared/types'

export interface ProjectsHandlers {
  createProject(name: string): Project
  listProjects(): Project[]
  renameProject(id: string, name: string): void
  deleteProject(id: string): void
}

export function createProjectsHandlers(repo: ProjectsRepository): ProjectsHandlers {
  return {
    createProject(name: string): Project {
      if (!name.trim()) throw new Error('Project name must not be empty')
      return repo.create(name.trim())
    },
    listProjects(): Project[] {
      return repo.list()
    },
    renameProject(id: string, name: string): void {
      if (!name.trim()) throw new Error('Project name must not be empty')
      repo.rename(id, name.trim())
    },
    deleteProject(id: string): void {
      repo.delete(id)
    }
  }
}
```

- [ ] **Step 6: Run both test files to verify they pass**

Run: `npx vitest run tests/main/db/projectsRepository.test.ts tests/main/ipc/projectsHandlers.test.ts`
Expected: PASS (5 + 5 tests)

- [ ] **Step 7: Register the IPC channel**

In `src/main/ipc/register.ts`, replace:

```typescript
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))
```

with:

```typescript
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => handlers.projects.renameProject(id, name))
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))
```

- [ ] **Step 8: Expose it in preload**

In `src/preload/index.ts`, replace:

```typescript
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
```

with:

```typescript
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
```

- [ ] **Step 9: Add it to the shared `Api` type**

In `src/shared/types.ts`, replace:

```typescript
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    delete(id: string): Promise<void>
  }
```

with:

```typescript
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    rename(id: string, name: string): Promise<void>
    delete(id: string): Promise<void>
  }
```

- [ ] **Step 10: Typecheck the main/preload/shared changes**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add src/main/db/projectsRepository.ts src/main/ipc/projectsHandlers.ts src/main/ipc/register.ts src/preload/index.ts src/shared/types.ts tests/main/db/projectsRepository.test.ts tests/main/ipc/projectsHandlers.test.ts
git commit -m "feat: add projects.rename IPC method"
```

---

### Task 3: New Project modal

**Files:**
- Create: `src/renderer/src/components/NewProjectDialog.tsx`
- Modify: `src/renderer/src/components/ProjectExplorer.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.files.pickFolder()` (Task 1), `window.api.projects.create(name)` and `window.api.repos.add(projectId, path)` (existing).
- Produces: `NewProjectDialog` component with props `{ onClose: () => void; onCreated: () => void }`.

- [ ] **Step 1: Create the dialog component**

Create `src/renderer/src/components/NewProjectDialog.tsx`:

```tsx
import { useState } from 'react'

interface Props {
  onClose: () => void
  onCreated: () => void
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function NewProjectDialog({ onClose, onCreated }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleChooseFolder(): Promise<void> {
    const picked = await window.api.files.pickFolder()
    if (!picked) return
    setFolderPath(picked)
    if (!nameEdited) setName(basename(picked))
  }

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !folderPath || creating) return
    setCreating(true)
    setError(null)
    const project = await window.api.projects.create(trimmed)
    const result = await window.api.repos.add(project.id, folderPath)
    if (!result.ok) {
      await window.api.projects.delete(project.id)
      setError(result.error)
      setCreating(false)
      return
    }
    setCreating(false)
    onCreated()
  }

  return (
    <div className="new-project-overlay" onClick={onClose}>
      <div className="new-project-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="new-project-title">New Project</div>
        <input
          className="field"
          autoFocus
          value={name}
          onChange={(e) => {
            setNameEdited(true)
            setName(e.target.value)
          }}
          placeholder="Project name"
        />
        <div className="new-project-folder-row">
          <button className="btn" onClick={handleChooseFolder} disabled={creating}>
            Choose folder…
          </button>
          {folderPath && (
            <span className="new-project-folder-path" title={folderPath}>
              {folderPath}
            </span>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="new-project-actions">
          <button className="btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button className="btn" onClick={handleCreate} disabled={!name.trim() || !folderPath || creating}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add its CSS**

In `src/renderer/src/theme.css`, after the `.about-close:hover { ... }` block (end of the "About dialog" section), add:

```css
/* ---------------------------------------------------------------------
   New Project dialog
   --------------------------------------------------------------------- */
.new-project-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.new-project-dialog {
  width: 320px;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.new-project-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--fg-bright);
  margin-bottom: var(--space-1);
}

.new-project-folder-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.new-project-folder-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--fg-dim);
}

.new-project-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
```

- [ ] **Step 3: Wire the modal into `ProjectExplorer`**

Replace the full contents of `src/renderer/src/components/ProjectExplorer.tsx` with:

```tsx
// src/renderer/src/components/ProjectExplorer.tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../../shared/types'
import { ProjectBox } from './ProjectBox'
import { NewProjectDialog } from './NewProjectDialog'
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

export function ProjectExplorer({
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  refreshKey
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => readCollapsed())
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function toggleCollapse(projectId: string): void {
    setCollapsed((prev) => {
      const next = { ...prev, [projectId]: !(prev[projectId] ?? true) }
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors (e.g. private browsing)
      }
      return next
    })
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
          onProjectChanged={refresh}
          externalRefreshKey={refreshKey}
        />
      ))}
      <button className="picker-add-row is-project" onClick={() => setNewProjectOpen(true)}>
        <PlusIcon className="row-icon" />
        <span>New project</span>
      </button>
      {projects.length === 0 && <div className="sidebar-empty">No projects yet. Add one below.</div>}
      {newProjectOpen && (
        <NewProjectDialog
          onClose={() => setNewProjectOpen(false)}
          onCreated={() => {
            setNewProjectOpen(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
```

Note: this adds a new `onProjectChanged` prop to `ProjectBox` that doesn't exist yet — Task 6 adds it. Until Task 6 lands, `ProjectBox`'s props type won't include it and this file won't typecheck; that's expected and resolved by Task 6 in this same plan (tasks run in order).

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: error only about `ProjectBox`'s props not accepting `onProjectChanged` — confirm no *other* errors. (This one clears once Task 6 adds the prop.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/NewProjectDialog.tsx src/renderer/src/components/ProjectExplorer.tsx src/renderer/src/theme.css
git commit -m "feat: replace inline project creation with a folder-picker modal"
```

---

### Task 4: Folder-picker "Add repo" row

**Files:**
- Modify: `src/renderer/src/components/ProjectBox.tsx`

**Interfaces:**
- Consumes: `window.api.files.pickFolder()` (Task 1).

- [ ] **Step 1: Replace the repo-path text input with a folder picker**

In `src/renderer/src/components/ProjectBox.tsx`, replace:

```typescript
  const [addingRepo, setAddingRepo] = useState(false)
  const [repoPath, setRepoPath] = useState('')
  const [repoError, setRepoError] = useState<string | null>(null)
```

with:

```typescript
  const [addingRepo, setAddingRepo] = useState(false)
  const [repoPath, setRepoPath] = useState<string | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
```

Replace:

```typescript
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
```

with:

```typescript
  async function handleChooseRepoFolder(): Promise<void> {
    const picked = await window.api.files.pickFolder()
    if (picked) setRepoPath(picked)
  }

  async function handleAddRepo(): Promise<void> {
    if (!repoPath) return
    setRepoError(null)
    const result = await window.api.repos.add(project.id, repoPath)
    if (!result.ok) {
      setRepoError(result.error)
      return
    }
    setRepoPath(null)
    setAddingRepo(false)
    setRefreshKey((k) => k + 1)
  }

  function cancelAddRepo(): void {
    setRepoPath(null)
    setRepoError(null)
    setAddingRepo(false)
  }
```

Replace:

```tsx
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
```

with:

```tsx
          {addingRepo ? (
            <div className="picker-inline-form">
              {repoPath ? (
                <>
                  <span className="new-project-folder-path" title={repoPath}>
                    {repoPath}
                  </span>
                  <button className="btn" onClick={handleAddRepo}>
                    Add
                  </button>
                </>
              ) : (
                <button className="btn" onClick={handleChooseRepoFolder}>
                  Choose folder…
                </button>
              )}
              <button className="btn" onClick={cancelAddRepo}>
                Cancel
              </button>
            </div>
          ) : (
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no new errors from this file (the pre-existing `onProjectChanged` gap from Task 3 remains until Task 6).

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open an existing project's box, click "Add repo", click "Choose folder…", pick a git repo folder, confirm the path shows read-only with an "Add" button, click it, confirm the repo is added. Click "Add repo" again and "Cancel", confirm it closes without adding anything.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ProjectBox.tsx
git commit -m "feat: use native folder picker for Add repo instead of typing a path"
```

---

### Task 5: Project info badge

**Files:**
- Create: `src/renderer/src/components/ProjectInfoDialog.tsx`
- Modify: `src/renderer/src/components/icons.tsx`
- Modify: `src/renderer/src/components/ProjectBox.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.repos.list(projectId)` and `window.api.repos.gitStatus(repoId)` (both existing).
- Produces: `ProjectInfoDialog` component with props `{ project: Project; onClose: () => void }`; `InfoIcon` in `icons.tsx`.

- [ ] **Step 1: Add the info icon**

In `src/renderer/src/components/icons.tsx`, add at the end of the file:

```tsx
export function InfoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="5.2" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8 7.5v4" strokeLinecap="round" />
    </svg>
  )
}
```

- [ ] **Step 2: Create the info dialog component**

Create `src/renderer/src/components/ProjectInfoDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Project, Repo } from '../../../shared/types'

interface Props {
  project: Project
  onClose: () => void
}

export function ProjectInfoDialog({ project, onClose }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [gitStatuses, setGitStatuses] = useState<Record<string, GitStatus | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      const repoList = await window.api.repos.list(project.id)
      if (cancelled) return
      setRepos(repoList)
      const statusEntries = await Promise.all(
        repoList.map(async (r) => [r.id, await window.api.repos.gitStatus(r.id).catch(() => null)] as const)
      )
      if (cancelled) return
      setGitStatuses(Object.fromEntries(statusEntries))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [project.id])

  return (
    <div className="project-info-overlay" onClick={onClose}>
      <div className="project-info-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="project-info-title">{project.name}</div>
        {loading && <div className="sidebar-empty">Loading…</div>}
        {!loading && repos.length === 0 && <div className="sidebar-empty">No repos in this project.</div>}
        {repos.map((repo) => {
          const status = gitStatuses[repo.id]
          return (
            <div key={repo.id} className="project-info-repo">
              <div className="project-info-repo-name">
                <span
                  className={`repo-status-dot${status?.dirty ? ' is-dirty' : ''}`}
                  title={status?.branch ?? undefined}
                />
                {repo.name}
              </div>
              <div className="project-info-repo-path">{repo.path}</div>
              <div className="project-info-repo-branch">
                {status?.branch ? `${status.branch} · ${status.dirty ? 'dirty' : 'clean'}` : 'No git status available'}
              </div>
            </div>
          )
        })}
        <button className="btn project-info-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add its CSS**

In `src/renderer/src/theme.css`, after the "New Project dialog" section added in Task 3, add:

```css
/* ---------------------------------------------------------------------
   Project info dialog
   --------------------------------------------------------------------- */
.project-info-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.project-info-dialog {
  width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.project-info-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--fg-bright);
}

.project-info-repo {
  padding: var(--space-2) 0;
  border-top: 1px solid var(--border-subtle);
}

.project-info-repo:first-of-type {
  border-top: none;
}

.project-info-repo-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-bright);
}

.project-info-repo-path {
  font-size: 11px;
  color: var(--fg-dim);
  overflow-wrap: break-word;
  margin-top: 2px;
}

.project-info-repo-branch {
  font-size: 11px;
  color: var(--fg-dim);
  margin-top: 2px;
}

.project-info-close {
  align-self: flex-end;
  margin-top: var(--space-2);
}
```

- [ ] **Step 4: Add the info badge button to the project box header**

In `src/renderer/src/components/ProjectBox.tsx`, add to the imports:

```typescript
import { ChevronIcon, InfoIcon, PlusIcon } from './icons'
import { ProjectInfoDialog } from './ProjectInfoDialog'
```

(replacing the existing `import { ChevronIcon, PlusIcon } from './icons'` line).

Add state near the other `useState` calls:

```typescript
  const [infoOpen, setInfoOpen] = useState(false)
```

In the JSX, replace:

```tsx
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
      </div>
```

with:

```tsx
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        <button className="project-box-info" onClick={() => setInfoOpen(true)} title="Project info">
          <InfoIcon />
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
      </div>
      {infoOpen && <ProjectInfoDialog project={project} onClose={() => setInfoOpen(false)} />}
```

- [ ] **Step 5: Add the info button's CSS**

In `src/renderer/src/theme.css`, after the `.project-box-add:hover { ... }` block, add:

```css
.project-box-info {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--fg-dim);
}

.project-box-info:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no new errors from this task's files (the pre-existing `onProjectChanged` gap from Task 3 remains until Task 6).

- [ ] **Step 7: Manual verification**

Run `npm run dev`, click a project's info icon, confirm it lists every repo in that project with correct path and branch/dirty-clean status matching what the sidebar already shows elsewhere. Click Close, confirm it closes; click outside the dialog, confirm it also closes.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ProjectInfoDialog.tsx src/renderer/src/components/icons.tsx src/renderer/src/components/ProjectBox.tsx src/renderer/src/theme.css
git commit -m "feat: add a project info badge showing repos and git status"
```

---

### Task 6: Rename/delete on the project box header

**Files:**
- Modify: `src/renderer/src/components/ProjectBox.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.projects.rename(id, name)` (Task 2), `window.api.projects.delete(id)` (existing, previously unused by any UI).
- Produces: `ProjectBox` gains a required `onProjectChanged: () => void` prop — already passed in by `ProjectExplorer.tsx` since Task 3.

- [ ] **Step 1: Add the `onProjectChanged` prop and rename/delete state**

In `src/renderer/src/components/ProjectBox.tsx`, replace the `Props` interface:

```typescript
interface Props {
  project: Project
  collapsed: boolean
  onToggleCollapse: (projectId: string) => void
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Bumped by ProjectExplorer's parent to force SessionList to refetch
   * after a session is created from outside this tree (e.g. the hamburger
   * menu's "New Session"). Combined with this box's own local refreshKey
   * so either trigger forces a remount. */
  externalRefreshKey: number
}
```

with:

```typescript
interface Props {
  project: Project
  collapsed: boolean
  onToggleCollapse: (projectId: string) => void
  activeSessionId: string | undefined
  onOpenSession: (session: SessionRecord, repo: Repo, project: Project | null) => void
  onSessionDeleted: (session: SessionRecord) => void
  onSessionRenamed: (session: SessionRecord) => void
  /** Called after this project is renamed or deleted so ProjectExplorer
   * can refetch its project list. */
  onProjectChanged: () => void
  /** Bumped by ProjectExplorer's parent to force SessionList to refetch
   * after a session is created from outside this tree (e.g. the hamburger
   * menu's "New Session"). Combined with this box's own local refreshKey
   * so either trigger forces a remount. */
  externalRefreshKey: number
}
```

Update the destructured props in the component signature — replace:

```typescript
export function ProjectBox({
  project,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  externalRefreshKey
}: Props): JSX.Element {
```

with:

```typescript
export function ProjectBox({
  project,
  collapsed,
  onToggleCollapse,
  activeSessionId,
  onOpenSession,
  onSessionDeleted,
  onSessionRenamed,
  onProjectChanged,
  externalRefreshKey
}: Props): JSX.Element {
```

- [ ] **Step 2: Add rename/delete handlers**

Add state near the other `useState` calls in `ProjectBox`:

```typescript
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(project.name)
```

Add handler functions near `handleCreateSession`:

```typescript
  function startRenameProject(): void {
    setNameValue(project.name)
    setEditingName(true)
  }

  async function commitRenameProject(): Promise<void> {
    const trimmed = nameValue.trim()
    setEditingName(false)
    if (!trimmed || trimmed === project.name) return
    await window.api.projects.rename(project.id, trimmed)
    onProjectChanged()
  }

  async function handleDeleteProject(): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${project.name}"? This also removes its repo(s) and every session in them.`
    )
    if (!confirmed) return
    await window.api.projects.delete(project.id)
    onProjectChanged()
  }
```

- [ ] **Step 3: Add the rename/delete icons to the header, and swap the label for an edit field while renaming**

Add to the imports (extending the change from Task 5):

```typescript
import { ChevronIcon, EditIcon, InfoIcon, PlusIcon, TrashIcon } from './icons'
```

In the JSX, replace:

```tsx
      <div className="project-box-header">
        <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
          <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
          <span className="project-box-label">{project.name}</span>
        </button>
        <button className="project-box-info" onClick={() => setInfoOpen(true)} title="Project info">
          <InfoIcon />
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
      </div>
```

with:

```tsx
      <div className="project-box-header">
        {editingName ? (
          <input
            className="field project-box-name-field"
            autoFocus
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={commitRenameProject}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              else if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <button className="project-box-toggle" onClick={() => onToggleCollapse(project.id)}>
            <ChevronIcon className={`project-box-chevron${collapsed ? '' : ' is-open'}`} />
            <span className="project-box-label">{project.name}</span>
          </button>
        )}
        <button className="project-box-info" onClick={() => setInfoOpen(true)} title="Project info">
          <InfoIcon />
        </button>
        <button className="project-box-rename" onClick={startRenameProject} title="Rename project">
          <EditIcon />
        </button>
        <button className="project-box-delete" onClick={handleDeleteProject} title="Delete project">
          <TrashIcon />
        </button>
        {singleRepo && (
          <button className="project-box-add" onClick={() => handleCreateSession(singleRepo)} title="New session">
            <PlusIcon />
          </button>
        )}
      </div>
```

- [ ] **Step 4: Add the rename/delete CSS, hover-revealed like session rows**

In `src/renderer/src/theme.css`, after the `.project-box-info:hover { ... }` block added in Task 5, add:

```css
.project-box-rename,
.project-box-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  margin-right: 4px;
  visibility: hidden;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--fg-dim);
}

.project-box-header:hover .project-box-rename,
.project-box-header:hover .project-box-delete {
  visibility: visible;
}

.project-box-rename:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}

.project-box-delete:hover {
  background: var(--list-active);
  color: var(--danger);
}

.project-box-name-field {
  flex: 1;
  min-width: 0;
  margin: 3px var(--space-2);
  font-size: 11px;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors — this is also the step where the `onProjectChanged` gap left open since Task 3 finally clears, since `ProjectBox` now accepts the prop `ProjectExplorer` has been passing since Task 3.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. Hover a project box's header, confirm rename and delete icons appear next to the "+" button without any layout shift. Click rename, edit the name, press Enter, confirm the new name persists and shows correctly (check it survives a reload too). Create a throwaway test project, click delete, confirm the browser `confirm()` prompt appears with the project's name in the message, confirm cancelling it leaves the project untouched, and confirm accepting it removes the project from the sidebar.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/ProjectBox.tsx src/renderer/src/theme.css
git commit -m "feat: add rename and delete to the project box header"
```

---

## Final verification

- [ ] Run `npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit` — both clean.
- [ ] Run `npm test` — note in the final report which suites loaded vs. failed to load under this environment's Node version (see Global Constraints), and confirm every test added in Tasks 1-2 passes wherever `node:sqlite` does load.
- [ ] Manually walk all four features end-to-end once in the running app: create a project via the modal, add a second repo to it via the folder picker, open its info badge, rename it, delete a throwaway project.
