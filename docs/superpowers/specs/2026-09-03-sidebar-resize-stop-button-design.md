# Resizable Sidebar, Split Stop Button & Sidebar Enhancements — Design

## Problem

The sidebar is a fixed 240px (`.sidebar` in `theme.css`) with no way to resize it, and
feels wide relative to the content it holds (a repo switcher + a flat session list). The
composer's Send button doubles as Stop while a session is busy (`ChatPanel.tsx`
`handleSend`/`handleStop`, toggled via `is-stop` class) — there's no dedicated, always-
present control to kill a running session immediately. Separately, the sidebar shows no
signal for which sessions are currently running, no git branch/status per repo, and
project-scope sessions render as one flat list with no grouping by repo.

## Goals

- **Thinner, resizable sidebar**: default width 180px (down from 240px), drag-resizable
  via a handle on its right edge, constrained to 150px–400px, width persisted to
  `localStorage` across restarts.
- **Split stop button**: composer gets a dedicated Stop icon-button beside Send.
  - Stop is disabled/greyed while idle, active (clickable) while busy; clicking it aborts
    the session immediately (same effect as today's `handleStop`).
  - Send always reads "Send" and stays enabled whenever there's input text, regardless of
    busy state. Clicking Send while busy queues the message (today's queuing behavior,
    currently only reachable via Enter) instead of the button switching into a Stop icon.
- **Running-session indicator**: each row in `SessionList` shows a small pulsing dot when
  that session is currently busy.
- **Git branch/status per repo**: `RepoSwitcher` shows the current branch name and a
  dirty/clean dot next to each repo.
- **Collapsible session groups**: in project scope, `SessionList` groups sessions under a
  collapsible header per repo instead of one flat list; collapsed/expanded state persists
  per project.

## Non-goals

- No session search/filter box — declined during brainstorming; can be a future addition
  if session lists grow large.
- No polling for git status — it's fetched when the repo list loads and when scope
  changes, not on a timer. A repo whose branch/dirty state changes from outside the app
  (or from a session's own git-touching tool calls) won't update live; that's an accepted
  gap for this spec.
- No change to how sessions are actually aborted server-side — `window.api.session.abort`
  and the main-process `busySessions` tracking in `sessionHandlers.ts` are reused as-is.
- No horizontal resize handle on the activity bar or editor area — only the sidebar gains
  resize behavior.

## Approach

### Resizable sidebar

`.sidebar`'s fixed `width: 240px` (`theme.css:283-291`) becomes a CSS custom property
(`--sidebar-width`) set inline from React state, defaulting to `180`. A new thin drag
handle (`.sidebar-resize-handle`, `4px` wide, `cursor: col-resize`) sits absolutely
positioned on the sidebar's right edge, inside `App.tsx`'s sidebar `<div>`. Pointer-down on
the handle starts a `pointermove`/`pointerup` listener pair on `window` that computes the
new width from cursor X position, clamps it to `[150, 400]`, and updates state on every
move (no separate drag-preview step — direct resize, matching the app's existing
directness elsewhere). On `pointerup`, the final width is written to
`localStorage['sidebarWidth']`; on mount, `App.tsx` reads that key (falling back to `180`)
to seed initial state. The collapsed state (`sidebarCollapsed`) is unaffected — collapsing
still fully hides the sidebar via the existing `.is-collapsed` class, independent of width.

### Split stop button

In `ChatPanel.tsx`, the single `composer-send` button (lines ~546-553) splits into two
sibling buttons:

- `composer-send` — always renders `<SendIcon />` and label "Send", `disabled={!input.trim()}`
  regardless of `busy`. `onClick` always calls `handleSend` (today's `handleSend` already
  branches on `busy` internally to queue vs. send immediately — that logic is unchanged).
- `composer-stop` (new) — renders `<StopIcon />`, `disabled={!busy}`, `onClick={handleStop}`,
  `title="Stop"`. Visually placed immediately to the left of Send in `.composer-toolbar`.
  Styled as a smaller/quieter icon button (like `.composer-icon-btn`) rather than the bold
  primary treatment `.composer-send` has today, since Send remains the primary action.

`handleStop` itself (queue clear, `busy`/`thinking` reset, `window.api.session.abort`) is
unchanged.

### Running-session indicator

`SessionList.tsx` gains a `busySessionIds: Set<string>` piece of state, populated by
subscribing to `window.api.session.onEvent` in a `useEffect` on mount: for each incoming
`{ type: 'busy', busy }` event, add or remove that event's `sessionId` from the set. This
reuses the existing global `session:event` IPC channel (already broadcast to every
renderer listener, not scoped to whichever session's `ChatPanel` is mounted — confirmed via
`preload/index.ts`'s `onEvent` wrapper and `sessionHandlers.ts`'s `busySessions` tracking),
so no main-process or IPC changes are needed. Each `.session-row` renders a small pulsing
dot (`.session-row-busy-dot`, reusing the existing `spin`/pulse animation pattern from
`SpinnerIcon`/`.composer-busy-spinner`) before the title when `busySessionIds.has(s.id)`.

### Git branch/status per repo

New main-process IPC handler `repos:gitStatus(repoId)` in `reposHandlers.ts`, using the
existing `simple-git` dependency: resolves the repo's path, runs `simpleGit(path).status()`,
and returns `{ branch: status.current, dirty: !status.isClean() }` (or `null` if the repo
isn't a git repo, reusing `isGitRepo`). Exposed on `Api` as `window.api.repos.gitStatus`.

`RepoSwitcher.tsx` fetches this for each repo when its repo list loads (same effect that
currently populates the dropdown) and again whenever `scope` changes to the repo currently
selected (covers the common case of switching back after making commits elsewhere). Each
repo row appends the branch name in a monospace, muted style plus a small dot — filled/
amber for dirty, outline/muted for clean — matching the visual language already used for
provider connection dots (`2026-08-29-custom-titlebar-menu-settings-design.md`'s status-dot
pattern).

### Collapsible session groups

`SessionList.tsx`'s project-scope rendering changes: instead of the separate "Repo
roommates" block (lines 85-95) plus one flat `sessions.map(...)` list, sessions are grouped
by `repoId` into `Map<repoId, SessionRecord[]>` (using `projectRepos` for names/ordering,
already fetched). Each group renders a collapsible header button (repo name + chevron,
reusing `ChevronIcon` already imported in `ChatPanel.tsx`) followed by that repo's session
rows when expanded. Collapsed/expanded state is a `Record<repoId, boolean>` persisted to
`localStorage['sessionGroups:' + projectId]`, defaulting all groups to expanded. Repo-scope
(non-project) rendering is unchanged — it already shows one flat list, which is correct
since there's only one repo in play.

## Testing

- Manual: drag the sidebar handle to its min/max bounds, restart the app, confirm the width
  persisted.
- Manual: start a prompt, confirm Stop is enabled and Send stays enabled/labeled "Send";
  click Stop mid-response and confirm the session aborts; type a message while busy and
  click Send, confirm it queues rather than sending immediately.
- Manual: open two sessions in different tabs, start a prompt in one, switch to the sidebar
  and confirm its row shows the busy dot while the other session's row doesn't.
- Manual: for a repo with uncommitted changes, confirm the dirty dot and branch name show
  correctly in `RepoSwitcher`; commit, reselect the repo, confirm the dot updates to clean.
- Manual: in a project with sessions across multiple repos, collapse one group, restart the
  app, confirm the collapsed state persisted.
- `npm test` (vitest) for any new pure logic (e.g., width-clamping helper, group-by-repoId
  helper) — UI wiring itself is exercised manually per above, consistent with this repo's
  existing test coverage pattern.
