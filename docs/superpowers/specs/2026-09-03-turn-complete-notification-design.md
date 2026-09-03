# Desktop Notification on Turn Complete/Error — Design

## Problem

When a prompt is running, the only way to know it finished is to have the app window in
view. There's no signal once you've switched away to another window — you have to keep
checking back. The main process already emits `turn_end` and `error` events for every
session turn (`src/main/ipc/sessionHandlers.ts`'s `onEvent` callback, wired in
`src/main/index.ts:112-114`, already forwards every `ChatEvent` to the renderer over
`session:event`) — nothing currently reacts to them outside the renderer's own UI state.

## Goals

- When a session's turn finishes (`turn_end`) or fails (`error`), and the app window is
  **not focused**, show a native OS notification (Windows toast, via Electron's
  `Notification` API).
- Notification title is the session's title (its `SessionRecord.title`, falling back to
  "Session" if empty); body is "Done" for `turn_end`, or "Error: <message>" for `error`.
- Clicking the notification brings the app window to the front and opens that specific
  session — even if it isn't currently an open tab, and even if the sidebar's current
  scope is a different repo/project. Reuses the exact mechanism `App.tsx` already uses to
  land on the most-recently-used session at startup (`handleOpenSession(session, scope)`),
  driven by a new one-shot push from main to renderer carrying the session, its repo, and
  its project (mirroring `SessionHandlers.getMostRecentSession()`'s existing return shape).
- One notification per session turn — no batching/deduplication if multiple sessions
  finish around the same time.

## Non-goals

- No Settings toggle to disable notifications in this pass — always on when the window is
  unfocused. Can be added later if wanted.
- No notification when the window IS focused — the in-app UI (busy dot, transcript) is
  the notice in that case; this feature is specifically for "I looked away."
- No change to `ChatEvent`, `mapAgentEvent`, or any other part of the existing event
  pipeline — this hooks into the single existing forwarding point in `main/index.ts`,
  nothing upstream of it changes.
- No sound customization, notification grouping/history, or action buttons beyond the
  default click-to-open — Electron's default `Notification` behavior as-is.

## Approach

### Detecting "turn finished" and building the notification

In `src/main/index.ts`, the existing `onEvent: (sessionId, event) => { ... }` callback
(currently just forwarding to the renderer) gains a check: if `event.type === 'turn_end'`
or `event.type === 'error'`, and `!mainWindow.isFocused()`, build and show a `Notification`.
A small helper local to `main/index.ts` resolves the session/repo/project by id, using the
same three-repository lookup shape `SessionHandlers.getMostRecentSession()` already uses (a
separate function, not a shared/refactored one -- `getMostRecentSession()` stays untouched
in `sessionHandlers.ts`, per this spec's Non-goals):

```typescript
function resolveSessionScope(
  sessionId: string,
  sessionsRepo: SessionsRepository,
  reposRepo: ReposRepository,
  projectsRepo: ProjectsRepository
): { session: SessionRecord; repo: Repo; project: Project | null } | null {
  const session = sessionsRepo.getById(sessionId)
  if (!session) return null
  const repo = reposRepo.getById(session.repoId)
  if (!repo) return null
  const project = session.projectId ? (projectsRepo.getById(session.projectId) ?? null) : null
  return { session, repo, project }
}
```

The notification body is `'Done'` for `turn_end`, or `` `Error: ${event.message}` `` for
`error`; the title is `resolved.session.title || 'Session'`.

### Click-to-focus-and-open

A new IPC push channel, `session:focusRequested`, carries the same
`{ session, repo, project }` shape `getMostRecentSession()` returns. The notification's
`click` handler calls `mainWindow.show()`, `mainWindow.focus()`, and sends this payload.
`shared/types.ts`'s `Api.session` gains `onFocusRequested(listener): () => void` (following
the exact pattern `onEvent` already uses), exposed in `preload/index.ts` the same way.

`App.tsx` subscribes to this in a new `useEffect` (parallel to its existing "land on most
recent session at startup" effect) and calls the same `handleOpenSession(session, scopeOf(repo,
project))` that effect already uses — no new renderer-side logic, just a second trigger for
an existing, working code path.

### Windows-specific note

Electron's `Notification` on Windows benefits from `app.setAppUserModelId(...)` being set
(otherwise toasts can show a generic Electron identity/icon instead of the app's own) — add
this once near the top of `app.whenReady()` if not already implicitly handled by
electron-builder's packaged output (it sets this automatically for a built .exe; only
`npm run dev` needs it explicit, similar to the existing dev-icon fallback comment already
in `createWindow()`).

## Testing

- Manual: start a prompt, switch to a different window (e.g. the browser), wait for the
  turn to finish; confirm a Windows notification appears with the session's title and
  "Done".
- Manual: trigger an error turn (e.g. abort mid-flight isn't an error — use an invalid
  model or induce a real error path) while unfocused; confirm the notification shows
  "Error: <message>".
- Manual: click the notification; confirm the app window comes to the front and the exact
  session that finished is open and selected, even if a different repo/project was
  selected in the sidebar beforehand.
- Manual: run a prompt while the app window IS focused; confirm no notification appears.
- No automated tests apply to the notification/focus trigger itself (Electron's
  `Notification` and `BrowserWindow.isFocused()` aren't meaningfully testable without a
  real OS+display, consistent with this repo's existing pattern of manual verification for
  window-chrome behavior). The extracted `resolveSessionScope` helper is a plain function
  with no Electron dependency and gets a real vitest test, matching
  `getMostRecentSession()`'s existing test coverage in `tests/main/ipc/sessionHandlers.test.ts`.
