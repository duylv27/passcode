# Pi Agent Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 Pi Agent Desktop app: an Electron + React + TS desktop app that manages projects (groups of local git repos), runs a Pi-SDK-backed agent session per repo, shows git status, and supports Anthropic + GitHub Copilot auth.

**Architecture:** Electron main process (Node/TS) owns the Pi SDK, SQLite (better-sqlite3) persistence, and git status (simple-git); it exposes everything to a React renderer via `contextBridge`/`ipcMain.handle`/`ipcRenderer.invoke`, plus a `session:event` push channel for streaming.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, better-sqlite3, simple-git, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, Vitest.

## Global Constraints

- Pure TypeScript/JavaScript stack — no Rust toolchain (Electron, not Tauri).
- One active session per repo in v1 (`sessionsRepo.getByRepoId` returns the most recent record; `sessionHandlers` reuses an already-open session rather than creating a second one).
- Git status panel shows branch + changed/added/deleted file lists only — no diff viewer in v1.
- Only Anthropic and GitHub Copilot providers supported in v1.
- Pi SDK runs directly in Electron's main process — no sidecar process.
- Metadata (projects/repos/sessions) persisted via `better-sqlite3`; conversation history persisted through Pi SDK's own `SessionManager`.
- Built-in agent tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`.
- `ModelRuntime.login()`'s exact signature is undocumented upstream — Task 12 flags this explicitly and describes the fallback adjustment.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `vitest.config.ts`
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Produces: a running `npm run dev` Electron window, and a working `npm test` (vitest) command later tasks build on.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "pi-agent-desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.1.0",
    "@earendil-works/pi-coding-agent": "^0.1.0",
    "better-sqlite3": "^11.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "simple-git": "^3.27.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "electron": "^33.0.2",
    "electron-vite": "^2.3.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.9",
    "vitest": "^2.1.3"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes without errors (native rebuild of `better-sqlite3` for Electron happens later when it's actually loaded in the Electron process — Task 2 uses it under plain Node/vitest first, which needs no rebuild).

- [ ] **Step 3: Write TypeScript project configs**

`tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

`tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "out/tsc-node"
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM"],
    "types": ["vite/client"],
    "outDir": "out/tsc-web"
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: Write `electron.vite.config.ts`**

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts')
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
```

- [ ] **Step 5: Write main/preload/renderer entry files**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('api', {})
```

`src/renderer/index.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Pi Agent Desktop</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

`src/renderer/src/App.tsx`:
```tsx
export default function App(): JSX.Element {
  return <div>Pi Agent Desktop</div>
}
```

- [ ] **Step 6: Write vitest config and a sanity test**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
})
```

`tests/sanity.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 7: Run the test suite**

Run: `npm test`
Expected: PASS (1 test)

- [ ] **Step 8: Manually verify the window boots**

Run: `npm run dev`
Expected: an Electron window opens showing "Pi Agent Desktop". Close it.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json tsconfig.node.json tsconfig.web.json electron.vite.config.ts src tests vitest.config.ts
git commit -m "chore: scaffold Electron + React + TS app"
```

---

## Task 2: SQLite Schema and Projects Repository

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/db.ts`
- Create: `src/main/db/projectsRepository.ts`
- Test: `tests/main/db/projectsRepository.test.ts`

**Interfaces:**
- Consumes: nothing (first data-layer task).
- Produces: `Project { id, name, createdAt }`; `openDatabase(path: string): Database.Database`; `initSchema(db): void`; `createProjectsRepository(db): ProjectsRepository` with `create(name)`, `list()`, `getById(id)`, `delete(id)`.

- [ ] **Step 1: Create shared types**

`src/shared/types.ts`:
```ts
export interface Project {
  id: string
  name: string
  createdAt: string
}

export interface Repo {
  id: string
  projectId: string
  path: string
  name: string
}

export interface SessionRecord {
  id: string
  repoId: string
  piSessionId: string
  title: string
  createdAt: string
}
```

- [ ] **Step 2: Write the schema and db connector**

`src/main/db/schema.ts`:
```ts
import type Database from 'better-sqlite3'

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      pi_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `)
}
```

`src/main/db/db.ts`:
```ts
import Database from 'better-sqlite3'
import { initSchema } from './schema'

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}
```

- [ ] **Step 3: Write the failing test for the projects repository**

`tests/main/db/projectsRepository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository, type ProjectsRepository } from '../../../src/main/db/projectsRepository'

describe('ProjectsRepository', () => {
  let repo: ProjectsRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    repo = createProjectsRepository(db)
  })

  it('creates and lists a project', () => {
    const created = repo.create('My Project')
    const listed = repo.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('My Project')
    expect(listed[0].id).toBe(created.id)
  })

  it('gets a project by id', () => {
    const created = repo.create('Another Project')
    expect(repo.getById(created.id)?.name).toBe('Another Project')
  })

  it('returns undefined for a missing project', () => {
    expect(repo.getById('missing')).toBeUndefined()
  })

  it('deletes a project', () => {
    const created = repo.create('To Delete')
    repo.delete(created.id)
    expect(repo.getById(created.id)).toBeUndefined()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- projectsRepository`
Expected: FAIL — cannot find module `../../../src/main/db/projectsRepository`

- [ ] **Step 5: Implement the projects repository**

`src/main/db/projectsRepository.ts`:
```ts
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../shared/types'

export interface ProjectsRepository {
  create(name: string): Project
  list(): Project[]
  getById(id: string): Project | undefined
  delete(id: string): void
}

export function createProjectsRepository(db: Database.Database): ProjectsRepository {
  return {
    create(name: string): Project {
      const project: Project = { id: randomUUID(), name, createdAt: new Date().toISOString() }
      db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(
        project.id,
        project.name,
        project.createdAt
      )
      return project
    },
    list(): Project[] {
      return db
        .prepare('SELECT id, name, created_at as createdAt FROM projects ORDER BY created_at')
        .all() as Project[]
    },
    getById(id: string): Project | undefined {
      return db
        .prepare('SELECT id, name, created_at as createdAt FROM projects WHERE id = ?')
        .get(id) as Project | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- projectsRepository`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/db tests/main/db/projectsRepository.test.ts
git commit -m "feat: add SQLite schema and projects repository"
```

---

## Task 3: Repos Repository and Git Status Wrapper

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/db/reposRepository.ts`
- Create: `src/main/git/gitStatus.ts`
- Test: `tests/main/db/reposRepository.test.ts`
- Test: `tests/main/git/gitStatus.test.ts`

**Interfaces:**
- Consumes: `initSchema`, `createProjectsRepository` (Task 2).
- Produces: `Repo` type (Task 2, already defined); `GitStatus { branch, changed, added, deleted }`; `createReposRepository(db): ReposRepository` with `create(projectId, path, name)`, `listByProject(projectId)`, `getById(id)`, `delete(id)`; `isGitRepo(path): Promise<boolean>`; `getGitStatus(path): Promise<GitStatus>`.

- [ ] **Step 1: Add `GitStatus` to shared types**

Add to `src/shared/types.ts` (append below `SessionRecord`):
```ts
export interface GitStatus {
  branch: string
  changed: string[]
  added: string[]
  deleted: string[]
}
```

- [ ] **Step 2: Write the failing test for the repos repository**

`tests/main/db/reposRepository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository, type ReposRepository } from '../../../src/main/db/reposRepository'

describe('ReposRepository', () => {
  let repos: ReposRepository
  let projectId: string

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    projectId = createProjectsRepository(db).create('Test Project').id
    repos = createReposRepository(db)
  })

  it('creates and lists repos for a project', () => {
    repos.create(projectId, '/path/to/repo', 'my-repo')
    const list = repos.listByProject(projectId)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('my-repo')
    expect(list[0].path).toBe('/path/to/repo')
  })

  it('gets a repo by id', () => {
    const created = repos.create(projectId, '/path/a', 'a')
    expect(repos.getById(created.id)?.name).toBe('a')
  })

  it('deletes a repo', () => {
    const created = repos.create(projectId, '/path/a', 'a')
    repos.delete(created.id)
    expect(repos.getById(created.id)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- reposRepository`
Expected: FAIL — cannot find module `../../../src/main/db/reposRepository`

- [ ] **Step 4: Implement the repos repository**

`src/main/db/reposRepository.ts`:
```ts
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Repo } from '../../shared/types'

export interface ReposRepository {
  create(projectId: string, path: string, name: string): Repo
  listByProject(projectId: string): Repo[]
  getById(id: string): Repo | undefined
  delete(id: string): void
}

export function createReposRepository(db: Database.Database): ReposRepository {
  return {
    create(projectId: string, path: string, name: string): Repo {
      const repo: Repo = { id: randomUUID(), projectId, path, name }
      db.prepare('INSERT INTO repos (id, project_id, path, name) VALUES (?, ?, ?, ?)').run(
        repo.id,
        repo.projectId,
        repo.path,
        repo.name
      )
      return repo
    },
    listByProject(projectId: string): Repo[] {
      return db
        .prepare('SELECT id, project_id as projectId, path, name FROM repos WHERE project_id = ?')
        .all(projectId) as Repo[]
    },
    getById(id: string): Repo | undefined {
      return db
        .prepare('SELECT id, project_id as projectId, path, name FROM repos WHERE id = ?')
        .get(id) as Repo | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM repos WHERE id = ?').run(id)
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- reposRepository`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test for git status**

`tests/main/git/gitStatus.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { isGitRepo, getGitStatus } from '../../../src/main/git/gitStatus'

describe('gitStatus', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-agent-test-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(dir, 'a.txt'), 'hello')
    await git.add('a.txt')
    await git.commit('initial')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports not a git repo for a plain folder', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pi-agent-plain-'))
    expect(await isGitRepo(plain)).toBe(false)
    rmSync(plain, { recursive: true, force: true })
  })

  it('reports a valid git repo', async () => {
    expect(await isGitRepo(dir)).toBe(true)
  })

  it('reports branch and changed files', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed')
    writeFileSync(join(dir, 'b.txt'), 'new file')
    const status = await getGitStatus(dir)
    expect(status.branch).toBeTruthy()
    expect(status.changed).toContain('a.txt')
    expect(status.added).toContain('b.txt')
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- gitStatus`
Expected: FAIL — cannot find module `../../../src/main/git/gitStatus`

- [ ] **Step 8: Implement the git status wrapper**

`src/main/git/gitStatus.ts`:
```ts
import simpleGit from 'simple-git'
import type { GitStatus } from '../../shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}

export async function getGitStatus(path: string): Promise<GitStatus> {
  const status = await simpleGit(path).status()
  return {
    branch: status.current ?? '',
    changed: status.modified,
    added: [...status.created, ...status.not_added],
    deleted: status.deleted
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- gitStatus`
Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/db/reposRepository.ts src/main/git tests/main/db/reposRepository.test.ts tests/main/git/gitStatus.test.ts
git commit -m "feat: add repos repository and git status wrapper"
```

---

## Task 4: Sessions Repository

**Files:**
- Create: `src/main/db/sessionsRepository.ts`
- Test: `tests/main/db/sessionsRepository.test.ts`

**Interfaces:**
- Consumes: `SessionRecord` (Task 2), `initSchema`, `createProjectsRepository`, `createReposRepository`.
- Produces: `createSessionsRepository(db): SessionsRepository` with `create(repoId, piSessionId, title)`, `getByRepoId(repoId)` (returns the most recent session for that repo, enforcing "one active session per repo"), `delete(id)`.

- [ ] **Step 1: Write the failing test**

`tests/main/db/sessionsRepository.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository, type SessionsRepository } from '../../../src/main/db/sessionsRepository'

describe('SessionsRepository', () => {
  let sessions: SessionsRepository
  let repoId: string

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = createReposRepository(db).create(projectId, '/path/a', 'a').id
    sessions = createSessionsRepository(db)
  })

  it('creates a session and finds it by repo id', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'a')
    expect(sessions.getByRepoId(repoId)?.id).toBe(created.id)
  })

  it('returns undefined when no session exists for a repo', () => {
    expect(sessions.getByRepoId('missing')).toBeUndefined()
  })

  it('returns the most recently created session for a repo', () => {
    sessions.create(repoId, 'pi-session-1', 'a')
    const second = sessions.create(repoId, 'pi-session-2', 'a')
    expect(sessions.getByRepoId(repoId)?.id).toBe(second.id)
  })

  it('deletes a session', () => {
    const created = sessions.create(repoId, 'pi-session-1', 'a')
    sessions.delete(created.id)
    expect(sessions.getByRepoId(repoId)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- sessionsRepository`
Expected: FAIL — cannot find module `../../../src/main/db/sessionsRepository`

- [ ] **Step 3: Implement the sessions repository**

`src/main/db/sessionsRepository.ts`:
```ts
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '../../shared/types'

export interface SessionsRepository {
  create(repoId: string, piSessionId: string, title: string): SessionRecord
  getByRepoId(repoId: string): SessionRecord | undefined
  delete(id: string): void
}

export function createSessionsRepository(db: Database.Database): SessionsRepository {
  return {
    create(repoId: string, piSessionId: string, title: string): SessionRecord {
      const record: SessionRecord = {
        id: randomUUID(),
        repoId,
        piSessionId,
        title,
        createdAt: new Date().toISOString()
      }
      db.prepare(
        'INSERT INTO sessions (id, repo_id, pi_session_id, title, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(record.id, record.repoId, record.piSessionId, record.title, record.createdAt)
      return record
    },
    getByRepoId(repoId: string): SessionRecord | undefined {
      return db
        .prepare(
          'SELECT id, repo_id as repoId, pi_session_id as piSessionId, title, created_at as createdAt ' +
            'FROM sessions WHERE repo_id = ? ORDER BY created_at DESC LIMIT 1'
        )
        .get(repoId) as SessionRecord | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- sessionsRepository`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/db/sessionsRepository.ts tests/main/db/sessionsRepository.test.ts
git commit -m "feat: add sessions repository"
```

---

## Task 5: Projects/Repos IPC Handlers and Wiring

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ipc/projectsHandlers.ts`
- Create: `src/main/ipc/reposHandlers.ts`
- Create: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc/projectsHandlers.test.ts`
- Test: `tests/main/ipc/reposHandlers.test.ts`

**Interfaces:**
- Consumes: `ProjectsRepository` (Task 2), `ReposRepository` + `isGitRepo` (Task 3).
- Produces: `createProjectsHandlers(repo): ProjectsHandlers`; `createReposHandlers(repo, isGitRepo): ReposHandlers`; `Api.projects`, `Api.repos` on `window.api` (renderer-facing contract used from Task 6 onward).

Handler logic is written as plain functions with no Electron import, so tests call them directly without an Electron runtime. `register.ts` is the only file that imports `ipcMain` and wires the plain functions to channels — it is exercised via manual verification (`npm run dev`), not a unit test, since it needs a live Electron process.

- [ ] **Step 1: Add IPC result types and the `Api` contract to shared types**

Add to `src/shared/types.ts` (append below `GitStatus`):
```ts
export interface AddRepoResult {
  ok: true
  repo: Repo
}

export interface AddRepoError {
  ok: false
  error: string
}

export interface Api {
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    delete(id: string): Promise<void>
  }
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
  }
}
```

- [ ] **Step 2: Write the failing test for projects handlers**

`tests/main/ipc/projectsHandlers.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createProjectsHandlers, type ProjectsHandlers } from '../../../src/main/ipc/projectsHandlers'

describe('projectsHandlers', () => {
  let handlers: ProjectsHandlers

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    handlers = createProjectsHandlers(createProjectsRepository(db))
  })

  it('creates a project', () => {
    const project = handlers.createProject('Demo')
    expect(project.name).toBe('Demo')
    expect(handlers.listProjects()).toHaveLength(1)
  })

  it('rejects an empty name', () => {
    expect(() => handlers.createProject('   ')).toThrow('Project name must not be empty')
  })

  it('deletes a project', () => {
    const project = handlers.createProject('Demo')
    handlers.deleteProject(project.id)
    expect(handlers.listProjects()).toHaveLength(0)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- projectsHandlers`
Expected: FAIL — cannot find module `../../../src/main/ipc/projectsHandlers`

- [ ] **Step 4: Implement projects handlers**

`src/main/ipc/projectsHandlers.ts`:
```ts
import type { ProjectsRepository } from '../db/projectsRepository'
import type { Project } from '../../shared/types'

export interface ProjectsHandlers {
  createProject(name: string): Project
  listProjects(): Project[]
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
    deleteProject(id: string): void {
      repo.delete(id)
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- projectsHandlers`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test for repos handlers**

`tests/main/ipc/reposHandlers.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createReposHandlers, type ReposHandlers } from '../../../src/main/ipc/reposHandlers'

describe('reposHandlers', () => {
  let handlers: ReposHandlers
  let projectId: string
  let isGitRepoMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    projectId = createProjectsRepository(db).create('Demo').id
    isGitRepoMock = vi.fn(async () => true)
    handlers = createReposHandlers(createReposRepository(db), isGitRepoMock)
  })

  it('adds a repo when the path is a valid git repo', async () => {
    const result = await handlers.addRepo(projectId, '/tmp/my-repo')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repo.name).toBe('my-repo')
      expect(result.repo.projectId).toBe(projectId)
    }
    expect(handlers.listRepos(projectId)).toHaveLength(1)
  })

  it('rejects a path that is not a git repo', async () => {
    isGitRepoMock.mockResolvedValueOnce(false)
    const result = await handlers.addRepo(projectId, '/tmp/not-a-repo')
    expect(result.ok).toBe(false)
    expect(handlers.listRepos(projectId)).toHaveLength(0)
  })
})
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npm test -- reposHandlers`
Expected: FAIL — cannot find module `../../../src/main/ipc/reposHandlers`

- [ ] **Step 8: Implement repos handlers**

`src/main/ipc/reposHandlers.ts`:
```ts
import { basename } from 'node:path'
import type { ReposRepository } from '../db/reposRepository'
import type { AddRepoResult, AddRepoError, Repo } from '../../shared/types'

export interface ReposHandlers {
  addRepo(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
  listRepos(projectId: string): Repo[]
  deleteRepo(id: string): void
}

export function createReposHandlers(
  repo: ReposRepository,
  isGitRepo: (path: string) => Promise<boolean>
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
    }
  }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- reposHandlers`
Expected: PASS (2 tests)

- [ ] **Step 10: Wire handlers to `ipcMain`**

`src/main/ipc/register.ts`:
```ts
import { ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))
}
```

- [ ] **Step 11: Expose the API on the renderer via preload**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 12: Wire the database and handlers in main**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { registerIpcHandlers } from './ipc/register'
import { isGitRepo } from './git/gitStatus'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'pi-agent.db'))
  const projectsRepo = createProjectsRepository(db)
  const reposRepo = createReposRepository(db)

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 13: Commit**

```bash
git add src/shared/types.ts src/main/ipc src/preload/index.ts src/main/index.ts tests/main/ipc
git commit -m "feat: add projects/repos IPC handlers and wiring"
```

---

## Task 6: Project and Repo List UI

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/global.d.ts`
- Create: `src/renderer/src/components/ProjectList.tsx`
- Create: `src/renderer/src/components/RepoList.tsx`

**Interfaces:**
- Consumes: `window.api.projects`, `window.api.repos` (Task 5).
- Produces: `<ProjectList>`, `<RepoList>` components; `App` state `selectedProject`/`selectedRepo` that Task 9/10 build on.

No new automated tests in this task — component behavior is verified manually since no component test runner is in scope per the spec's Testing section.

- [ ] **Step 1: Declare the `window.api` global type**

`src/renderer/src/global.d.ts`:
```ts
import type { Api } from '../../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export {}
```

- [ ] **Step 2: Build the project list component**

`src/renderer/src/components/ProjectList.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Project } from '../../../shared/types'

interface Props {
  selected: Project | null
  onSelect: (project: Project) => void
}

export function ProjectList({ selected, onSelect }: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState('')

  async function refresh(): Promise<void> {
    setProjects(await window.api.projects.list())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleCreate(): Promise<void> {
    if (!name.trim()) return
    await window.api.projects.create(name)
    setName('')
    await refresh()
  }

  return (
    <div>
      <h3>Projects</h3>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onSelect(p)}
              style={{ fontWeight: selected?.id === p.id ? 'bold' : 'normal' }}
            >
              {p.name}
            </button>
          </li>
        ))}
      </ul>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" />
      <button onClick={handleCreate}>Add</button>
    </div>
  )
}
```

- [ ] **Step 3: Build the repo list component**

`src/renderer/src/components/RepoList.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Project, Repo } from '../../../shared/types'

interface Props {
  project: Project
  selected: Repo | null
  onSelect: (repo: Repo) => void
}

export function RepoList({ project, selected, onSelect }: Props): JSX.Element {
  const [repos, setRepos] = useState<Repo[]>([])
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setRepos(await window.api.repos.list(project.id))
  }

  useEffect(() => {
    refresh()
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
    await refresh()
  }

  return (
    <div>
      <h4>Repos in {project.name}</h4>
      <ul>
        {repos.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onSelect(r)}
              style={{ fontWeight: selected?.id === r.id ? 'bold' : 'normal' }}
            >
              {r.name}
            </button>
          </li>
        ))}
      </ul>
      <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/path/to/repo" />
      <button onClick={handleAdd}>Add repo</button>
      {error && <div style={{ color: 'red' }}>{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Wire the components into `App`**

`src/renderer/src/App.tsx`:
```tsx
import { useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 260, borderRight: '1px solid #333', overflowY: 'auto' }}>
        <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
        {selectedProject && (
          <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
        )}
      </div>
      <div style={{ flex: 1 }}>
        {selectedRepo ? (
          <div>Selected repo: {selectedRepo.name}</div>
        ) : (
          <div style={{ padding: 16 }}>Select a repo to start a session.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Manually verify**

Run: `npm run dev`. Create a project, add a real local git repo path, confirm it appears in the list. Try adding a non-git folder path and confirm the inline error message appears.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/global.d.ts src/renderer/src/components/ProjectList.tsx src/renderer/src/components/RepoList.tsx
git commit -m "feat: add project and repo list UI"
```

---

## Task 7: Pi SDK Agent Session Wrapper

**Files:**
- Create: `src/main/agent/piSession.ts`
- Test: `tests/main/agent/piSession.test.ts`

**Interfaces:**
- Consumes: `createAgentSession` from `@earendil-works/pi-coding-agent`.
- Produces: `RepoSession { prompt(text), subscribe(listener), abort() }`; `createRepoSession(options: { cwd, model, modelRuntime }): Promise<{ repoSession, sessionId }>` — used by Task 8.

v1 does not attempt to resume a prior Pi-level session by id — the SDK's resume behavior isn't documented clearly enough to build on yet (flagged in the spec). Each app run starts a fresh Pi session per repo; the `sessions` table (Task 4) still records it for future resume support.

- [ ] **Step 1: Write the failing test with a mocked SDK**

`tests/main/agent/piSession.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'

const promptMock = vi.fn(async () => {})
const subscribeMock = vi.fn(() => () => {})
const abortMock = vi.fn(async () => {})
const createAgentSessionMock = vi.fn(async () => ({
  session: { prompt: promptMock, subscribe: subscribeMock, abort: abortMock }
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock
}))

import { createRepoSession } from '../../../src/main/agent/piSession'

describe('createRepoSession', () => {
  it('creates a session scoped to the repo cwd with the expected tools', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      model: {} as never,
      modelRuntime: {} as never
    })

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/path',
        tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
      })
    )

    await repoSession.prompt('hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
  })

  it('forwards subscribe and abort to the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      model: {} as never,
      modelRuntime: {} as never
    })

    const listener = vi.fn()
    repoSession.subscribe(listener)
    expect(subscribeMock).toHaveBeenCalledWith(listener)

    await repoSession.abort()
    expect(abortMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- piSession`
Expected: FAIL — cannot find module `../../../src/main/agent/piSession`

- [ ] **Step 3: Implement the session wrapper**

`src/main/agent/piSession.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { createAgentSession } from '@earendil-works/pi-coding-agent'
import type { ModelRuntime, AgentEvent } from '@earendil-works/pi-coding-agent'
import type { Model } from '@earendil-works/pi-ai'

export interface RepoSession {
  prompt(text: string): Promise<void>
  subscribe(listener: (event: AgentEvent) => void): () => void
  abort(): Promise<void>
}

export interface CreateRepoSessionOptions {
  cwd: string
  model: Model
  modelRuntime: ModelRuntime
}

const AGENT_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export async function createRepoSession(
  options: CreateRepoSessionOptions
): Promise<{ repoSession: RepoSession; sessionId: string }> {
  const { session } = await createAgentSession({
    cwd: options.cwd,
    model: options.model,
    modelRuntime: options.modelRuntime,
    tools: [...AGENT_TOOLS]
  })

  return {
    sessionId: randomUUID(),
    repoSession: {
      prompt: (text: string) => session.prompt(text),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort()
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- piSession`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/agent tests/main/agent
git commit -m "feat: add Pi SDK agent session wrapper"
```

---

## Task 8: Session IPC Handlers and Streaming Wiring

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ipc/sessionHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `RepoSession`/`createRepoSession` (Task 7), `ReposRepository` (Task 3), `SessionsRepository` (Task 4).
- Produces: `ChatEvent` shared type; `createSessionHandlers(deps): SessionHandlers` with `openSession(repoId)`, `sendPrompt(repoId, text)`; `Api.session` on `window.api` — used by Task 9.

`sessionHandlers` translates raw Pi SDK events into the small `ChatEvent` shape so the renderer never depends on Pi's exact event schema.

- [ ] **Step 1: Add `ChatEvent` and `Api.session` to shared types**

Add to `src/shared/types.ts` (append below the `Api` interface's closing brace, then add `session` inside `Api`):
```ts
export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; toolName: string }
  | { type: 'tool_end'; toolName: string }
  | { type: 'turn_end' }
  | { type: 'error'; message: string }
```

Update the `Api` interface to add a `session` member:
```ts
export interface Api {
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    delete(id: string): Promise<void>
  }
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
  }
  session: {
    open(repoId: string): Promise<void>
    prompt(repoId: string, text: string): Promise<void>
    onEvent(listener: (repoId: string, event: ChatEvent) => void): () => void
  }
}
```

- [ ] **Step 2: Write the failing test for session handlers**

`tests/main/ipc/sessionHandlers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository } from '../../../src/main/db/sessionsRepository'
import {
  createSessionHandlers,
  type ChatEvent,
  type SessionHandlers
} from '../../../src/main/ipc/sessionHandlers'
import type { RepoSession } from '../../../src/main/agent/piSession'

describe('sessionHandlers', () => {
  let repoId: string
  let events: Array<{ repoId: string; event: ChatEvent }>
  let promptMock: ReturnType<typeof vi.fn>
  let subscribeListener: ((event: unknown) => void) | undefined
  let handlers: SessionHandlers

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const projectsRepo = createProjectsRepository(db)
    const reposRepo = createReposRepository(db)
    const sessionsRepo = createSessionsRepository(db)
    const projectId = projectsRepo.create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id

    events = []
    promptMock = vi.fn(async () => {})
    subscribeListener = undefined
    const repoSession: RepoSession = {
      prompt: promptMock,
      subscribe: (listener) => {
        subscribeListener = listener
        return () => {}
      },
      abort: vi.fn(async () => {})
    }

    handlers = createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: async () => ({ repoSession, sessionId: 'pi-session-1' }),
      onEvent: (id, event) => events.push({ repoId: id, event })
    })
  })

  it('opens a session, persists it, and forwards prompt', async () => {
    await handlers.openSession(repoId)
    await handlers.sendPrompt(repoId, 'hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
  })

  it('maps and forwards a text_delta event to onEvent', async () => {
    await handlers.openSession(repoId)
    subscribeListener?.({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'Hi' }
    })
    expect(events).toContainEqual({ repoId, event: { type: 'text_delta', delta: 'Hi' } })
  })

  it('reuses the same session on a second prompt rather than recreating it', async () => {
    await handlers.sendPrompt(repoId, 'first')
    await handlers.sendPrompt(repoId, 'second')
    expect(promptMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- sessionHandlers`
Expected: FAIL — cannot find module `../../../src/main/ipc/sessionHandlers`

- [ ] **Step 4: Implement session handlers**

`src/main/ipc/sessionHandlers.ts`:
```ts
import type { RepoSession } from '../agent/piSession'
import type { SessionsRepository } from '../db/sessionsRepository'
import type { ReposRepository } from '../db/reposRepository'
import type { ChatEvent } from '../../shared/types'

export type { ChatEvent }

export interface CreateSessionHandlersDeps {
  reposRepo: ReposRepository
  sessionsRepo: SessionsRepository
  openRepoSession: (repoId: string, cwd: string) => Promise<{ repoSession: RepoSession; sessionId: string }>
  onEvent: (repoId: string, event: ChatEvent) => void
}

export interface SessionHandlers {
  openSession(repoId: string): Promise<void>
  sendPrompt(repoId: string, text: string): Promise<void>
}

export function createSessionHandlers(deps: CreateSessionHandlersDeps): SessionHandlers {
  const openSessions = new Map<string, RepoSession>()

  async function ensureSession(repoId: string): Promise<RepoSession> {
    const existing = openSessions.get(repoId)
    if (existing) return existing

    const repo = deps.reposRepo.getById(repoId)
    if (!repo) throw new Error(`Unknown repo: ${repoId}`)

    const { repoSession, sessionId } = await deps.openRepoSession(repoId, repo.path)

    if (!deps.sessionsRepo.getByRepoId(repoId)) {
      deps.sessionsRepo.create(repoId, sessionId, repo.name)
    }

    repoSession.subscribe((event) => {
      const mapped = mapAgentEvent(event)
      if (mapped) deps.onEvent(repoId, mapped)
    })

    openSessions.set(repoId, repoSession)
    return repoSession
  }

  return {
    async openSession(repoId: string): Promise<void> {
      await ensureSession(repoId)
    },
    async sendPrompt(repoId: string, text: string): Promise<void> {
      const session = await ensureSession(repoId)
      try {
        await session.prompt(text)
      } catch (err) {
        deps.onEvent(repoId, { type: 'error', message: (err as Error).message })
      }
    }
  }
}

function mapAgentEvent(event: unknown): ChatEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolName?: string
  }
  if (e.type === 'message_update' && e.assistantMessageEvent?.type === 'text_delta') {
    return { type: 'text_delta', delta: e.assistantMessageEvent.delta ?? '' }
  }
  if (e.type === 'tool_execution_start') {
    return { type: 'tool_start', toolName: e.toolName ?? 'unknown' }
  }
  if (e.type === 'tool_execution_end') {
    return { type: 'tool_end', toolName: e.toolName ?? 'unknown' }
  }
  if (e.type === 'turn_end') {
    return { type: 'turn_end' }
  }
  return null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- sessionHandlers`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire session handlers into `register.ts`**

`src/main/ipc/register.ts`:
```ts
import { ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'
import type { SessionHandlers } from './sessionHandlers'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))

  ipcMain.handle('session:open', (_e, repoId: string) => handlers.session.openSession(repoId))
  ipcMain.handle('session:prompt', (_e, repoId: string, text: string) =>
    handlers.session.sendPrompt(repoId, text)
  )
}
```

- [ ] **Step 7: Expose session methods and the event channel via preload**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ChatEvent } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id)
  },
  session: {
    open: (repoId) => ipcRenderer.invoke('session:open', repoId),
    prompt: (repoId, text) => ipcRenderer.invoke('session:prompt', repoId, text),
    onEvent: (listener) => {
      const wrapped = (_e: unknown, repoId: string, event: ChatEvent): void => listener(repoId, event)
      ipcRenderer.on('session:event', wrapped)
      return () => ipcRenderer.removeListener('session:event', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 8: Wire the agent session and model runtime into main**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { getModel } from '@earendil-works/pi-ai'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createSessionsRepository } from './db/sessionsRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { createSessionHandlers } from './ipc/sessionHandlers'
import { registerIpcHandlers } from './ipc/register'
import { isGitRepo } from './git/gitStatus'
import { createRepoSession } from './agent/piSession'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const db = openDatabase(join(app.getPath('userData'), 'pi-agent.db'))
  const projectsRepo = createProjectsRepository(db)
  const reposRepo = createReposRepository(db)
  const sessionsRepo = createSessionsRepository(db)

  const modelRuntime = await ModelRuntime.create()
  const model = getModel('anthropic', 'claude-opus-4-5')

  const mainWindow = createWindow()

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo),
    session: createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: (_repoId, cwd) => createRepoSession({ cwd, model, modelRuntime }),
      onEvent: (repoId, event) => mainWindow.webContents.send('session:event', repoId, event)
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/ipc src/preload/index.ts src/main/index.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "feat: add session IPC handlers and streaming wiring"
```

---

## Task 9: Chat Panel UI

**Files:**
- Create: `src/renderer/src/components/ChatPanel.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api.session` (Task 8), `Repo` type.
- Produces: `<ChatPanel repo onTurnEnd?>` — `onTurnEnd` is consumed by Task 10 to refresh git status after each turn.

No new automated tests — verified manually per Task 6's note (requires provider auth from Task 11/12 to actually get a model response; the UI itself can be checked structurally beforehand by confirming it renders and calls `session.open`/`session.prompt` without throwing).

- [ ] **Step 1: Build the chat panel component**

`src/renderer/src/components/ChatPanel.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import type { ChatEvent, Repo } from '../../../shared/types'

interface ChatLine {
  kind: 'text' | 'tool' | 'error'
  text: string
}

interface Props {
  repo: Repo
  onTurnEnd?: () => void
}

export function ChatPanel({ repo, onTurnEnd }: Props): JSX.Element {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const currentTextRef = useRef<string>('')

  useEffect(() => {
    setLines([])
    currentTextRef.current = ''
    window.api.session.open(repo.id)

    const unsubscribe = window.api.session.onEvent((eventRepoId, event: ChatEvent) => {
      if (eventRepoId !== repo.id) return

      if (event.type === 'text_delta') {
        currentTextRef.current += event.delta
        setLines((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'text') {
            next[next.length - 1] = { kind: 'text', text: currentTextRef.current }
          } else {
            next.push({ kind: 'text', text: currentTextRef.current })
          }
          return next
        })
      } else if (event.type === 'tool_start') {
        currentTextRef.current = ''
        setLines((prev) => [...prev, { kind: 'tool', text: `Running: ${event.toolName}` }])
      } else if (event.type === 'error') {
        setLines((prev) => [...prev, { kind: 'error', text: event.message }])
      } else if (event.type === 'turn_end') {
        currentTextRef.current = ''
        onTurnEnd?.()
      }
    })

    return unsubscribe
  }, [repo.id])

  async function handleSend(): Promise<void> {
    if (!input.trim()) return
    setLines((prev) => [...prev, { kind: 'text', text: `> ${input}` }])
    currentTextRef.current = ''
    const text = input
    setInput('')
    await window.api.session.prompt(repo.id, text)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.kind === 'error' ? 'red' : line.kind === 'tool' ? '#888' : undefined,
              whiteSpace: 'pre-wrap'
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', padding: 8 }}>
        <input
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend()
          }}
          placeholder={`Message the agent about ${repo.name}`}
        />
        <button onClick={handleSend}>Send</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render the chat panel in `App`**

Replace the right-hand panel's contents in `src/renderer/src/App.tsx`:
```tsx
import { useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'
import { ChatPanel } from './components/ChatPanel'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 260, borderRight: '1px solid #333', overflowY: 'auto' }}>
        <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
        {selectedProject && (
          <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedRepo ? (
          <ChatPanel repo={selectedRepo} />
        ) : (
          <div style={{ padding: 16 }}>Select a repo to start a session.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Manually verify the panel renders and calls the API**

Run: `npm run dev`. Select a repo and confirm the chat panel appears with an input box. Sending a message before any provider is authenticated (Task 11/12 not done yet) is expected to fail — that's fine at this point; confirm it doesn't crash the renderer (an inline `error` line should appear once error handling from Task 8 kicks in, or nothing streams back — either is acceptable at this stage).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/App.tsx
git commit -m "feat: add chat panel UI with streaming"
```

---

## Task 10: Git Status Panel

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ipc/gitHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Create: `src/renderer/src/components/GitStatusPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/ChatPanel.tsx` (no code change needed — `onTurnEnd` prop already exists from Task 9)
- Test: `tests/main/ipc/gitHandlers.test.ts`

**Interfaces:**
- Consumes: `getGitStatus` (Task 3), `ReposRepository` (Task 3), `ChatPanel`'s `onTurnEnd` (Task 9).
- Produces: `createGitHandlers(reposRepo): GitHandlers` with `status(repoId)`; `Api.git` on `window.api`; `<GitStatusPanel repo refreshKey>`.

- [ ] **Step 1: Add `Api.git` to shared types**

Update the `Api` interface in `src/shared/types.ts` to add a `git` member:
```ts
export interface Api {
  projects: {
    create(name: string): Promise<Project>
    list(): Promise<Project[]>
    delete(id: string): Promise<void>
  }
  repos: {
    add(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
    list(projectId: string): Promise<Repo[]>
    delete(id: string): Promise<void>
  }
  session: {
    open(repoId: string): Promise<void>
    prompt(repoId: string, text: string): Promise<void>
    onEvent(listener: (repoId: string, event: ChatEvent) => void): () => void
  }
  git: {
    status(repoId: string): Promise<GitStatus>
  }
}
```

- [ ] **Step 2: Write the failing test for git handlers**

`tests/main/ipc/gitHandlers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'

vi.mock('../../../src/main/git/gitStatus', () => ({
  getGitStatus: vi.fn(async () => ({ branch: 'main', changed: ['a.ts'], added: [], deleted: [] }))
}))

import { createGitHandlers } from '../../../src/main/ipc/gitHandlers'
import { getGitStatus } from '../../../src/main/git/gitStatus'

describe('gitHandlers', () => {
  let repoId: string
  let handlers: ReturnType<typeof createGitHandlers>

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    const reposRepo = createReposRepository(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo').id
    handlers = createGitHandlers(reposRepo)
  })

  it('returns git status for a known repo', async () => {
    const status = await handlers.status(repoId)
    expect(status.branch).toBe('main')
    expect(getGitStatus).toHaveBeenCalledWith('/repo/path')
  })

  it('throws for an unknown repo', async () => {
    await expect(handlers.status('missing')).rejects.toThrow('Unknown repo: missing')
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- gitHandlers`
Expected: FAIL — cannot find module `../../../src/main/ipc/gitHandlers`

- [ ] **Step 4: Implement git handlers**

`src/main/ipc/gitHandlers.ts`:
```ts
import { getGitStatus } from '../git/gitStatus'
import type { ReposRepository } from '../db/reposRepository'
import type { GitStatus } from '../../shared/types'

export interface GitHandlers {
  status(repoId: string): Promise<GitStatus>
}

export function createGitHandlers(reposRepo: ReposRepository): GitHandlers {
  return {
    async status(repoId: string): Promise<GitStatus> {
      const repo = reposRepo.getById(repoId)
      if (!repo) throw new Error(`Unknown repo: ${repoId}`)
      return getGitStatus(repo.path)
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- gitHandlers`
Expected: PASS (2 tests)

- [ ] **Step 6: Wire git handlers into `register.ts`**

`src/main/ipc/register.ts`:
```ts
import { ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'
import type { SessionHandlers } from './sessionHandlers'
import type { GitHandlers } from './gitHandlers'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
  git: GitHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))

  ipcMain.handle('session:open', (_e, repoId: string) => handlers.session.openSession(repoId))
  ipcMain.handle('session:prompt', (_e, repoId: string, text: string) =>
    handlers.session.sendPrompt(repoId, text)
  )

  ipcMain.handle('git:status', (_e, repoId: string) => handlers.git.status(repoId))
}
```

- [ ] **Step 7: Expose git status via preload**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ChatEvent } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id)
  },
  session: {
    open: (repoId) => ipcRenderer.invoke('session:open', repoId),
    prompt: (repoId, text) => ipcRenderer.invoke('session:prompt', repoId, text),
    onEvent: (listener) => {
      const wrapped = (_e: unknown, repoId: string, event: ChatEvent): void => listener(repoId, event)
      ipcRenderer.on('session:event', wrapped)
      return () => ipcRenderer.removeListener('session:event', wrapped)
    }
  },
  git: {
    status: (repoId) => ipcRenderer.invoke('git:status', repoId)
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 8: Wire git handlers into main**

In `src/main/index.ts`, add the import and include `git` in the `registerIpcHandlers` call:
```ts
import { createGitHandlers } from './ipc/gitHandlers'
```
```ts
  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo),
    session: createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: (_repoId, cwd) => createRepoSession({ cwd, model, modelRuntime }),
      onEvent: (repoId, event) => mainWindow.webContents.send('session:event', repoId, event)
    }),
    git: createGitHandlers(reposRepo)
  })
```

- [ ] **Step 9: Build the git status panel component**

`src/renderer/src/components/GitStatusPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { GitStatus, Repo } from '../../../shared/types'

interface Props {
  repo: Repo
  refreshKey: number
}

export function GitStatusPanel({ repo, refreshKey }: Props): JSX.Element {
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    window.api.git.status(repo.id).then(setStatus)
  }, [repo.id, refreshKey])

  if (!status) return <div style={{ padding: 8 }}>Loading git status...</div>

  return (
    <div style={{ padding: 8, borderTop: '1px solid #333' }}>
      <div>
        Branch: <strong>{status.branch}</strong>
      </div>
      <StatusList label="Changed" files={status.changed} />
      <StatusList label="Added" files={status.added} />
      <StatusList label="Deleted" files={status.deleted} />
    </div>
  )
}

function StatusList({ label, files }: { label: string; files: string[] }): JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div>
      {label}:
      <ul>
        {files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 10: Wire the panel into `App`, refreshing after each turn**

`src/renderer/src/App.tsx`:
```tsx
import { useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 260, borderRight: '1px solid #333', overflowY: 'auto' }}>
        <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
        {selectedProject && (
          <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {selectedRepo ? (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel repo={selectedRepo} onTurnEnd={() => setRefreshKey((k) => k + 1)} />
            </div>
            <GitStatusPanel repo={selectedRepo} refreshKey={refreshKey} />
          </>
        ) : (
          <div style={{ padding: 16 }}>Select a repo to start a session.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Manually verify**

Run: `npm run dev`. Select a repo with uncommitted changes and confirm branch + file lists render. Modify a file on disk, send a chat prompt that completes a turn, and confirm the panel refreshes.

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/main/ipc src/preload/index.ts src/main/index.ts src/renderer/src tests/main/ipc/gitHandlers.test.ts
git commit -m "feat: add git status panel"
```

---

## Task 11: Settings — Anthropic API Key

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/main/ipc/settingsHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Create: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Test: `tests/main/ipc/settingsHandlers.test.ts`

**Interfaces:**
- Consumes: `ModelRuntime` (from `@earendil-works/pi-coding-agent`, Task 8's wiring).
- Produces: `AuthStatus { anthropic, copilot }`; `createSettingsHandlers(modelRuntime): SettingsHandlers` with `setAnthropicApiKey(apiKey)`, `getAuthStatus()`; `Api.settings` (partial — extended in Task 12); `<SettingsPanel>`.

`ModelRuntimeLike` is a narrow interface covering only what `settingsHandlers` needs, so tests can supply a plain mock instead of a real `ModelRuntime`.

- [ ] **Step 1: Add `AuthStatus` and `Api.settings` (partial) to shared types**

Add to `src/shared/types.ts` (append below `GitStatus`):
```ts
export interface AuthStatus {
  anthropic: boolean
  copilot: boolean
}
```

Update the `Api` interface to add a `settings` member:
```ts
  settings: {
    setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
    getAuthStatus(): Promise<AuthStatus>
  }
```

- [ ] **Step 2: Write the failing test for settings handlers**

`tests/main/ipc/settingsHandlers.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSettingsHandlers,
  type ModelRuntimeLike,
  type SettingsHandlers
} from '../../../src/main/ipc/settingsHandlers'

describe('settingsHandlers', () => {
  let modelRuntime: ModelRuntimeLike
  let handlers: SettingsHandlers

  beforeEach(() => {
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async (providerId: string) => providerId === 'anthropic'),
      login: vi.fn(async () => {})
    }
    handlers = createSettingsHandlers(modelRuntime)
  })

  it('sets a valid Anthropic API key', async () => {
    const result = await handlers.setAnthropicApiKey('sk-test-123')
    expect(result.ok).toBe(true)
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-test-123')
  })

  it('rejects an empty API key', async () => {
    const result = await handlers.setAnthropicApiKey('   ')
    expect(result.ok).toBe(false)
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
  })

  it('reports auth status per provider', async () => {
    const status = await handlers.getAuthStatus()
    expect(status).toEqual({ anthropic: true, copilot: false })
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- settingsHandlers`
Expected: FAIL — cannot find module `../../../src/main/ipc/settingsHandlers`

- [ ] **Step 4: Implement settings handlers (Anthropic + auth status only)**

`src/main/ipc/settingsHandlers.ts`:
```ts
import type { AuthStatus, DeviceCodeChallenge } from '../../shared/types'

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>
  checkAuth(providerId: string): Promise<boolean>
  login(providerId: string, onChallenge: (challenge: DeviceCodeChallenge) => void): Promise<void>
}

export interface SettingsHandlers {
  setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  getAuthStatus(): Promise<AuthStatus>
  loginCopilot(
    onChallenge: (challenge: DeviceCodeChallenge) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
}

export function createSettingsHandlers(modelRuntime: ModelRuntimeLike): SettingsHandlers {
  return {
    async setAnthropicApiKey(apiKey: string) {
      if (!apiKey.trim()) return { ok: false, error: 'API key must not be empty' }
      try {
        await modelRuntime.setRuntimeApiKey('anthropic', apiKey.trim())
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async getAuthStatus() {
      const [anthropic, copilot] = await Promise.all([
        modelRuntime.checkAuth('anthropic'),
        modelRuntime.checkAuth('copilot')
      ])
      return { anthropic, copilot }
    },
    async loginCopilot(onChallenge) {
      try {
        await modelRuntime.login('copilot', onChallenge)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  }
}
```

Note: `loginCopilot` and `DeviceCodeChallenge` are implemented here already (simpler than splitting the file across two tasks) — Task 12 adds the shared `DeviceCodeChallenge` type, the IPC wiring, and the UI for it. Skip Step 1's `DeviceCodeChallenge` import failure by completing Task 12's Step 1 (below) before running this task's tests if type-checking blocks the test run; otherwise proceed — Vitest transpiles per-file and will not fail on an unused type import ahead of its definition being added, but to keep things buildable in order, add the `DeviceCodeChallenge` type now:

Add to `src/shared/types.ts` (append below `AuthStatus`):
```ts
export interface DeviceCodeChallenge {
  userCode: string
  verificationUri: string
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- settingsHandlers`
Expected: PASS (3 tests)

- [ ] **Step 6: Wire settings handlers into `register.ts`**

`src/main/ipc/register.ts`:
```ts
import { ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'
import type { SessionHandlers } from './sessionHandlers'
import type { GitHandlers } from './gitHandlers'
import type { SettingsHandlers } from './settingsHandlers'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
  git: GitHandlers
  settings: SettingsHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))

  ipcMain.handle('session:open', (_e, repoId: string) => handlers.session.openSession(repoId))
  ipcMain.handle('session:prompt', (_e, repoId: string, text: string) =>
    handlers.session.sendPrompt(repoId, text)
  )

  ipcMain.handle('git:status', (_e, repoId: string) => handlers.git.status(repoId))

  ipcMain.handle('settings:setAnthropicApiKey', (_e, apiKey: string) =>
    handlers.settings.setAnthropicApiKey(apiKey)
  )
  ipcMain.handle('settings:getAuthStatus', () => handlers.settings.getAuthStatus())
  ipcMain.handle('settings:loginCopilot', (event) =>
    handlers.settings.loginCopilot((challenge) => event.sender.send('settings:copilotChallenge', challenge))
  )
}
```

- [ ] **Step 7: Expose settings methods via preload**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ChatEvent, DeviceCodeChallenge } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id)
  },
  session: {
    open: (repoId) => ipcRenderer.invoke('session:open', repoId),
    prompt: (repoId, text) => ipcRenderer.invoke('session:prompt', repoId, text),
    onEvent: (listener) => {
      const wrapped = (_e: unknown, repoId: string, event: ChatEvent): void => listener(repoId, event)
      ipcRenderer.on('session:event', wrapped)
      return () => ipcRenderer.removeListener('session:event', wrapped)
    }
  },
  git: {
    status: (repoId) => ipcRenderer.invoke('git:status', repoId)
  },
  settings: {
    setAnthropicApiKey: (apiKey) => ipcRenderer.invoke('settings:setAnthropicApiKey', apiKey),
    getAuthStatus: () => ipcRenderer.invoke('settings:getAuthStatus'),
    loginCopilot: () => ipcRenderer.invoke('settings:loginCopilot'),
    onCopilotChallenge: (listener) => {
      const wrapped = (_e: unknown, challenge: DeviceCodeChallenge): void => listener(challenge)
      ipcRenderer.on('settings:copilotChallenge', wrapped)
      return () => ipcRenderer.removeListener('settings:copilotChallenge', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
```

Update the `Api.settings` member in `src/shared/types.ts` to its full shape (this is the same edit Task 12 would otherwise make — doing it now keeps `preload/index.ts` type-correct in this step):
```ts
  settings: {
    setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
    getAuthStatus(): Promise<AuthStatus>
    loginCopilot(): Promise<{ ok: true } | { ok: false; error: string }>
    onCopilotChallenge(listener: (challenge: DeviceCodeChallenge) => void): () => void
  }
```

- [ ] **Step 8: Wire settings handlers into main**

In `src/main/index.ts`, add the import and include `settings` in the `registerIpcHandlers` call:
```ts
import { createSettingsHandlers } from './ipc/settingsHandlers'
```
```ts
  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo),
    session: createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: (_repoId, cwd) => createRepoSession({ cwd, model, modelRuntime }),
      onEvent: (repoId, event) => mainWindow.webContents.send('session:event', repoId, event)
    }),
    git: createGitHandlers(reposRepo),
    settings: createSettingsHandlers(modelRuntime)
  })
```

- [ ] **Step 9: Build the settings panel (Anthropic section + Copilot placeholder)**

`src/renderer/src/components/SettingsPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge } from '../../../shared/types'

export function SettingsPanel(): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  async function refresh(): Promise<void> {
    setStatus(await window.api.settings.getAuthStatus())
  }

  useEffect(() => {
    refresh()
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    return unsubscribe
  }, [])

  async function handleSaveKey(): Promise<void> {
    setError(null)
    const result = await window.api.settings.setAnthropicApiKey(apiKey)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setApiKey('')
    await refresh()
  }

  async function handleCopilotLogin(): Promise<void> {
    setLoggingIn(true)
    setChallenge(null)
    const result = await window.api.settings.loginCopilot()
    setLoggingIn(false)
    setChallenge(null)
    if (result.ok) await refresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>Settings</h3>
      <section>
        <h4>Anthropic {status?.anthropic ? '✓ connected' : ''}</h4>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Anthropic API key"
        />
        <button onClick={handleSaveKey}>Save</button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </section>
      <section>
        <h4>GitHub Copilot {status?.copilot ? '✓ connected' : ''}</h4>
        <button onClick={handleCopilotLogin} disabled={loggingIn}>
          {loggingIn ? 'Signing in...' : 'Sign in'}
        </button>
        {challenge && (
          <div>
            Go to {challenge.verificationUri} and enter code: <strong>{challenge.userCode}</strong>
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 10: Add Settings navigation to `App`**

`src/renderer/src/App.tsx`:
```tsx
import { useState } from 'react'
import type { Project, Repo } from '../../shared/types'
import { ProjectList } from './components/ProjectList'
import { RepoList } from './components/RepoList'
import { ChatPanel } from './components/ChatPanel'
import { GitStatusPanel } from './components/GitStatusPanel'
import { SettingsPanel } from './components/SettingsPanel'

export default function App(): JSX.Element {
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<Repo | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <div style={{ width: 260, borderRight: '1px solid #333', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1 }}>
          <ProjectList selected={selectedProject} onSelect={setSelectedProject} />
          {selectedProject && (
            <RepoList project={selectedProject} selected={selectedRepo} onSelect={setSelectedRepo} />
          )}
        </div>
        <button onClick={() => setShowSettings((s) => !s)}>{showSettings ? 'Close Settings' : 'Settings'}</button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {showSettings ? (
          <SettingsPanel />
        ) : selectedRepo ? (
          <>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel repo={selectedRepo} onTurnEnd={() => setRefreshKey((k) => k + 1)} />
            </div>
            <GitStatusPanel repo={selectedRepo} refreshKey={refreshKey} />
          </>
        ) : (
          <div style={{ padding: 16 }}>Select a repo to start a session.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Manually verify the Anthropic key flow**

Run: `npm run dev`. Open Settings, paste a real Anthropic API key, click Save, confirm "✓ connected" appears next to Anthropic. Select a repo and send a chat message; confirm a real streamed response appears (this exercises Tasks 7–9 end-to-end for the first time).

- [ ] **Step 12: Commit**

```bash
git add src/shared/types.ts src/main/ipc src/preload/index.ts src/main/index.ts src/renderer/src tests/main/ipc/settingsHandlers.test.ts
git commit -m "feat: add Anthropic API key settings"
```

---

## Task 12: Settings — GitHub Copilot Device-Code Login

**Files:**
- Modify: `tests/main/ipc/settingsHandlers.test.ts`

**Interfaces:**
- Consumes: `SettingsHandlers.loginCopilot` (already implemented in Task 11, Step 4).

The `loginCopilot` implementation, its shared `DeviceCodeChallenge` type, the `settings:loginCopilot` IPC wiring, the preload bridge, and the `SettingsPanel` UI for it were all written in Task 11 (to keep `settingsHandlers.ts` and its consumers each written exactly once). This task adds the missing test coverage for `loginCopilot` and performs the real, only-doable-by-hand verification of the device-code flow.

**Known risk:** `ModelRuntime.login()`'s exact signature is not documented upstream beyond "resolves after the affected provider's ... catalog ... are locally consistent" and that credentials land in `~/.pi/agent/auth.json`. `ModelRuntimeLike.login(providerId, onChallenge)` in `settingsHandlers.ts` is this plan's best-effort assumption. If the installed `@earendil-works/pi-coding-agent` package's actual types don't match (e.g., `login` returns a value instead of taking a callback, or the challenge fields are named differently), fix the call site inside `createSettingsHandlers`'s `loginCopilot` method and the `DeviceCodeChallenge` fields in `src/shared/types.ts` — nothing else in the app depends on the exact shape.

- [ ] **Step 1: Add failing tests for `loginCopilot`**

Extend `tests/main/ipc/settingsHandlers.test.ts` — add these two `it` blocks inside the existing `describe('settingsHandlers', ...)` block, after the existing three:
```ts
  it('signs in to Copilot and surfaces the device code challenge', async () => {
    const challenges: Array<{ userCode: string; verificationUri: string }> = []
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_providerId: string, onChallenge: (c: { userCode: string; verificationUri: string }) => void) => {
        onChallenge({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
      }
    )

    const result = await handlers.loginCopilot((c) => challenges.push(c))

    expect(result.ok).toBe(true)
    expect(challenges).toEqual([{ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }])
  })

  it('reports a failed Copilot login', async () => {
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('user cancelled'))

    const result = await handlers.loginCopilot(() => {})

    expect(result).toEqual({ ok: false, error: 'user cancelled' })
  })
```

- [ ] **Step 2: Run the test to verify the new cases pass**

Run: `npm test -- settingsHandlers`
Expected: PASS (5 tests) — `loginCopilot` was already implemented in Task 11, so no production code changes are needed here.

- [ ] **Step 3: Manually verify the real device-code flow**

Run: `npm run dev`. Open Settings, click "Sign in" under GitHub Copilot. Confirm a user code and a `https://github.com/login/device`-style URL appear. Open that URL in a browser, enter the code, approve. Back in the app, confirm the button stops showing "Signing in..." and Copilot flips to "✓ connected".

If the challenge never appears, or the call throws immediately with a type error: open `node_modules/@earendil-works/pi-coding-agent`'s type definitions for `ModelRuntime.login`, compare against `ModelRuntimeLike.login` in `src/main/ipc/settingsHandlers.ts`, and adjust the method signature and the `loginCopilot` implementation to match — then repeat this manual check.

- [ ] **Step 4: Commit**

```bash
git add tests/main/ipc/settingsHandlers.test.ts
git commit -m "test: add Copilot device-code login coverage"
```
