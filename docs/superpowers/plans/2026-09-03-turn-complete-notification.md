# Turn Complete/Error Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a native Windows notification when a session's turn finishes or fails while the app window is unfocused, and land on that exact session when the notification is clicked.

**Architecture:** A small new pure-logic module (`src/main/notifications.ts`) decides whether/what to notify about, independent of Electron; `main/index.ts`'s existing event-forwarding callback calls into it and owns the actual `Notification` object and window focus/show calls. A new one-shot IPC push channel (`session:focusRequested`) carries the clicked session's full scope (session + repo + project) to the renderer, which reuses its existing `handleOpenSession` path — the same one that already runs at app startup to land on the most-recently-used session.

**Tech Stack:** Electron's `Notification` API (main process only), the existing IPC push-channel pattern (`ipcRenderer.on`/`webContents.send`, not `ipcMain.handle`/`invoke`), Vitest for the pure-logic tests.

## Global Constraints

- Notify only when `!mainWindow.isFocused()` — never notify while the window has focus.
- Notify for exactly two `ChatEvent` types: `turn_end` (body: `"Done"`) and `error` (body: `` `Error: ${message}` ``). No other event type triggers a notification.
- Notification title is the session's `title`, or `"Session"` if the title is empty.
- Clicking the notification must: bring the window to front (`show()` + `focus()`), AND open that exact session in the renderer (not just focus the window) — even if a different repo/project is currently selected in the sidebar.
- No Settings toggle for this in this pass. No batching/deduplication — one notification per qualifying event.
- `getMostRecentSession()` in `src/main/ipc/sessionHandlers.ts` stays untouched — the new session-scope-resolving logic is a separate function in the new module, not a refactor of the existing one.

---

### Task 1: Pure notification-decision helpers

**Files:**
- Create: `src/main/notifications.ts`
- Test: `tests/main/notifications.test.ts`

**Interfaces:**
- Produces: `ResolvedSessionScope` (`{ session: SessionRecord; repo: Repo; project: Project | null }`), `resolveSessionScope(sessionId: string, sessionsRepo: SessionsRepository, reposRepo: ReposRepository, projectsRepo: ProjectsRepository): ResolvedSessionScope | null`, `notificationBodyFor(event: ChatEvent): string | null` — both consumed by Task 3 (`main/index.ts`).

This task is deliberately Electron-free (no `import ... from 'electron'` anywhere in this file) so it can be unit-tested with plain mock objects, without touching `node:sqlite` or any real database — `SessionsRepository`/`ReposRepository`/`ProjectsRepository` are interfaces; a test can implement them with simple in-memory fakes.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/notifications.test.ts
import { describe, it, expect } from 'vitest'
import { resolveSessionScope, notificationBodyFor } from '../../src/main/notifications'
import type { SessionsRepository } from '../../src/main/db/sessionsRepository'
import type { ReposRepository } from '../../src/main/db/reposRepository'
import type { ProjectsRepository } from '../../src/main/db/projectsRepository'
import type { Project, Repo, SessionRecord } from '../../src/shared/types'

const session: SessionRecord = {
  id: 's1',
  repoId: 'r1',
  projectId: null,
  piSessionId: 'pi-1',
  title: 'My Session',
  createdAt: '2026-01-01'
}

const repo: Repo = { id: 'r1', projectId: 'p1', path: '/repos/r1', name: 'r1' }
const project: Project = { id: 'p1', name: 'Project One', createdAt: '2026-01-01' }

function fakeSessionsRepo(found: SessionRecord | undefined): SessionsRepository {
  return { getById: () => found } as unknown as SessionsRepository
}

function fakeReposRepo(found: Repo | undefined): ReposRepository {
  return { getById: () => found } as unknown as ReposRepository
}

function fakeProjectsRepo(found: Project | undefined): ProjectsRepository {
  return { getById: () => found } as unknown as ProjectsRepository
}

describe('resolveSessionScope', () => {
  it('resolves a repo-scoped session with no project', () => {
    const result = resolveSessionScope(
      's1',
      fakeSessionsRepo(session),
      fakeReposRepo(repo),
      fakeProjectsRepo(undefined)
    )
    expect(result).toEqual({ session, repo, project: null })
  })

  it('resolves a project-scoped session, looking up the project', () => {
    const projectSession = { ...session, projectId: 'p1' }
    const result = resolveSessionScope(
      's1',
      fakeSessionsRepo(projectSession),
      fakeReposRepo(repo),
      fakeProjectsRepo(project)
    )
    expect(result).toEqual({ session: projectSession, repo, project })
  })

  it('returns null when the session does not exist', () => {
    const result = resolveSessionScope(
      'missing',
      fakeSessionsRepo(undefined),
      fakeReposRepo(repo),
      fakeProjectsRepo(undefined)
    )
    expect(result).toBe(null)
  })

  it('returns null when the session references a repo that no longer exists', () => {
    const result = resolveSessionScope(
      's1',
      fakeSessionsRepo(session),
      fakeReposRepo(undefined),
      fakeProjectsRepo(undefined)
    )
    expect(result).toBe(null)
  })
})

describe('notificationBodyFor', () => {
  it('returns "Done" for turn_end', () => {
    expect(notificationBodyFor({ type: 'turn_end' })).toBe('Done')
  })

  it('returns "Error: <message>" for error', () => {
    expect(notificationBodyFor({ type: 'error', message: 'boom' })).toBe('Error: boom')
  })

  it('returns null for any other event type', () => {
    expect(notificationBodyFor({ type: 'text_delta', delta: 'hi' })).toBe(null)
    expect(notificationBodyFor({ type: 'thinking_end' })).toBe(null)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/main/notifications.test.ts`
Expected: FAIL — `Cannot find module '../../src/main/notifications'`

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/notifications.ts
import type { ChatEvent, Project, Repo, SessionRecord } from '../shared/types'
import type { SessionsRepository } from './db/sessionsRepository'
import type { ReposRepository } from './db/reposRepository'
import type { ProjectsRepository } from './db/projectsRepository'

export interface ResolvedSessionScope {
  session: SessionRecord
  repo: Repo
  project: Project | null
}

/** Looks up a session's repo and (if project-scoped) project by id -- the
 * same three-repository shape SessionHandlers.getMostRecentSession() uses,
 * kept as a separate function here since that one stays untouched. */
export function resolveSessionScope(
  sessionId: string,
  sessionsRepo: SessionsRepository,
  reposRepo: ReposRepository,
  projectsRepo: ProjectsRepository
): ResolvedSessionScope | null {
  const session = sessionsRepo.getById(sessionId)
  if (!session) return null
  const repo = reposRepo.getById(session.repoId)
  if (!repo) return null
  const project = session.projectId ? (projectsRepo.getById(session.projectId) ?? null) : null
  return { session, repo, project }
}

/** The notification body for a qualifying event, or null if this event type
 * should never trigger a notification. */
export function notificationBodyFor(event: ChatEvent): string | null {
  if (event.type === 'turn_end') return 'Done'
  if (event.type === 'error') return `Error: ${event.message}`
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/main/notifications.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/notifications.ts tests/main/notifications.test.ts
git commit -m "Add pure helpers for deciding turn-complete notification content"
```

---

### Task 2: `session:focusRequested` IPC contract (types + preload)

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Produces: `Api.session.onFocusRequested(listener: (session: SessionRecord, repo: Repo, project: Project | null) => void): () => void` — consumed by Task 3 (main process, the sending side) and Task 4 (`App.tsx`, the receiving side).

- [ ] **Step 1: Add the method to the `Api` interface**

In `src/shared/types.ts`, inside the `session` block of the `Api` interface, add this line right after `onEvent(listener: (sessionId: string, event: ChatEvent) => void): () => void`:

```typescript
    onFocusRequested(listener: (session: SessionRecord, repo: Repo, project: Project | null) => void): () => void
```

- [ ] **Step 2: Expose it in preload**

In `src/preload/index.ts`, inside the `session: { ... }` object, add this right after the existing `onEvent` method (note the trailing comma needed on `onEvent`'s closing brace):

```typescript
    onFocusRequested: (listener) => {
      const wrapped = (_e: unknown, session: SessionRecord, repo: Repo, project: Project | null): void =>
        listener(session, repo, project)
      ipcRenderer.on('session:focusRequested', wrapped)
      return () => ipcRenderer.removeListener('session:focusRequested', wrapped)
    }
```

Update the top-of-file type import line to include `Project`, `Repo`, and `SessionRecord`:

```typescript
import type {
  Api,
  ApprovalRequest,
  ChatEvent,
  DeviceCodeChallenge,
  Project,
  Repo,
  SessionRecord,
  ToolApprovalPolicy
} from '../shared/types'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors (preload is checked under the node tsconfig)

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts
git commit -m "Add session:focusRequested push channel to the IPC contract"
```

---

### Task 3: Main-process notification + click-to-focus wiring

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `resolveSessionScope`, `notificationBodyFor` from `./notifications` (Task 1); `Api.session.onFocusRequested`'s wire format `session:focusRequested` (Task 2 — this task is the sending side).

- [ ] **Step 1: Import `Notification` and the new helpers**

In `src/main/index.ts`, change:

```typescript
import { app, BrowserWindow, dialog, Menu } from 'electron'
```

to:

```typescript
import { app, BrowserWindow, dialog, Menu, Notification } from 'electron'
```

Add this import near the other local imports (after the `getGitStatus` import line):

```typescript
import { resolveSessionScope, notificationBodyFor } from './notifications'
```

- [ ] **Step 2: Set the Windows AppUserModelID**

In `src/main/index.ts`, as the first line inside `app.whenReady().then(async () => {`, add:

```typescript
  app.setAppUserModelId('com.duyle.passcode-desktop')
```

(Matches `package.json`'s `build.appId`. Packaged builds get this from electron-builder's NSIS output automatically, but `npm run dev` does not, so this is set unconditionally and is a no-op where it's already correct.)

- [ ] **Step 3: Extend the `onEvent` callback**

Replace:

```typescript
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)
      },
```

with:

```typescript
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)

        const body = notificationBodyFor(event)
        if (!body || mainWindow.isFocused()) return

        const resolved = resolveSessionScope(sessionId, sessionsRepo, reposRepo, projectsRepo)
        const notification = new Notification({
          title: resolved?.session.title || 'Session',
          body
        })
        notification.on('click', () => {
          if (mainWindow.isDestroyed()) return
          mainWindow.show()
          mainWindow.focus()
          if (resolved) {
            mainWindow.webContents.send(
              'session:focusRequested',
              resolved.session,
              resolved.repo,
              resolved.project
            )
          }
        })
        notification.show()
      },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc -p tsconfig.node.json --noEmit`
Expected: no errors

- [ ] **Step 5: Manually verify (as far as this task alone allows)**

Run: `npm run dev`
- Confirm the app still launches with no crash (this task's code only runs inside the `turn_end`/`error` branch, so a clean launch here just confirms no syntax/type errors reached runtime).
- Full click-to-open behavior can't be verified until Task 4 lands (the renderer doesn't listen for `session:focusRequested` yet) — note this in your report rather than attempting to verify it now.

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "Show a notification on turn complete/error when the window is unfocused"
```

---

### Task 4: Renderer — open the session a clicked notification pointed at

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.api.session.onFocusRequested` (Task 2/3); `handleOpenSession`, `scopeOf` (both already exist in `App.tsx`, unchanged).

- [ ] **Step 1: Add the subscription effect**

In `src/renderer/src/App.tsx`, add this new `useEffect` immediately after the existing "land on most recent session at startup" effect (the one that calls `window.api.session.getMostRecent()`):

```typescript
  // A clicked notification (see main/index.ts) tells us which session to
  // open, even if it isn't currently an open tab or in the sidebar's
  // current scope -- same landing logic as the startup effect above.
  useEffect(() => {
    return window.api.session.onFocusRequested((session, repo, project) => {
      handleOpenSession(session, scopeOf(repo, project))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors

- [ ] **Step 3: Manually verify**

Run: `npm run dev`
- Start a prompt in a session, switch focus to a different window (e.g. the browser or terminal), wait for the turn to finish.
- Confirm a Windows notification appears titled with the session's name and body "Done".
- Click the notification; confirm the app window comes to the front AND the exact session that finished is now open/selected in the editor area — even if a different repo/project was selected in the sidebar before you switched away.
- Repeat with the app window focused the whole time; confirm no notification appears.
- If you can induce a real error turn (e.g. an invalid/unavailable model) while unfocused, confirm the notification body reads "Error: <message>" instead of "Done".

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Open the session a clicked turn-complete notification points at"
```

## Self-Review Notes

- **Spec coverage:** notify on turn_end/error only when unfocused → Task 3 Step 3 (`notificationBodyFor` + `mainWindow.isFocused()` check); title/body format → Task 1's `notificationBodyFor` + Task 3's `resolved?.session.title || 'Session'`; click brings window forward and opens the exact session → Task 3's `click` handler + Task 4's subscription; one notification per event, no batching → satisfied by construction (a fresh `Notification` per qualifying `onEvent` call, no dedup logic added); AppUserModelID note → Task 3 Step 2. All five spec goals and all four non-goals are covered; no Settings toggle, no change to `ChatEvent`/`mapAgentEvent`/`getMostRecentSession`, no sound/grouping added anywhere in this plan.
- **Placeholder scan:** no TBD/TODO; every step shows complete, exact code.
- **Type consistency:** `ResolvedSessionScope` defined once in Task 1 and consumed by field access (`resolved.session`, `resolved.repo`, `resolved.project`) in Task 3 — field names match exactly. `Api.session.onFocusRequested`'s listener signature (`session: SessionRecord, repo: Repo, project: Project | null`) is identical across its Task 2 type declaration, Task 2 preload wrapper, Task 3's `webContents.send` argument order, and Task 4's destructured callback — all four sites pass/expect the same three arguments in the same order.
