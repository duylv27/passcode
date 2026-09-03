# "All Sessions" Sidebar View + Search — Design

## Problem

The sidebar's session list is always scoped to exactly one repo or one project at a time
(`RepoSwitcher`'s `Scope`) — there's no way to see or search across every session in every
project at once. As the number of projects/repos/sessions grows with real daily use, finding
a session you know exists somewhere, but don't remember which project it's under, means
manually switching scope and scanning each one.

## Goals

- A new toggle, separate from the project/repo picker, switches the sidebar between its
  current scoped view and a new "All Sessions" view.
- "All Sessions" shows every session across every project/repo as one flat list, sorted by
  most-recently-opened first (falling back to creation time for a session never opened),
  each row showing the session title plus its repo's name as a small secondary label.
- A search box appears only in "All Sessions" view, filtering the flat list by session title
  (client-side, case-insensitive substring match).
- Clicking a session in "All Sessions" opens it exactly like clicking one in the scoped view
  today (updates `scope` so the tab bar/editor show the right thing) — but the sidebar stays
  in "All Sessions" view; the toggle does not get switched back off by opening a session.

## Non-goals

- No additional sort options (date created, alphabetical, etc.) — most-recently-opened only.
- No search box in the existing scoped view — search is "All Sessions"-only.
- No change to how `scope` drives the tab bar/editor area, and no change to
  `sessionMatchesScope`, `handleOpenSession`, or any existing tab-filtering logic — "All
  Sessions" is purely a new way to *find and open* a session; everything downstream of
  opening one is unchanged.
- No grouping by project/repo in this view (that's what the existing scoped view already
  does) — deliberately flat, since the point is cutting across project boundaries.

## Approach

### Data layer

`src/main/db/sessionsRepository.ts`'s `SessionsRepository` gains:

```typescript
/** Every session across every repo/project, most-recently-opened first
 * (falling back to creation time for a session that's never been opened). */
listAll(): SessionRecord[]
```

Implemented with the same `COALESCE(last_opened_at, created_at) DESC` ordering
`getMostRecent()` already uses, just without a `LIMIT 1`:

```sql
SELECT ${SELECT_COLUMNS} FROM sessions ORDER BY COALESCE(last_opened_at, created_at) DESC, rowid DESC
```

### Enrichment + IPC

`src/shared/types.ts` gains:

```typescript
export interface SessionWithScope {
  session: SessionRecord
  repo: Repo
  project: Project | null
}
```

`SessionHandlers` (`src/main/ipc/sessionHandlers.ts`) gains `listAllSessions(): SessionWithScope[]`,
implemented by mapping `sessionsRepo.listAll()` through the same per-session repo/project
lookup `getMostRecentSession()` already performs (`reposRepo.getById(session.repoId)`, and
`projectsRepo.getById(session.projectId)` when `projectId` is set) — sessions whose repo no
longer resolves are skipped, matching `getMostRecentSession()`'s existing null-safety. New IPC
channel `session:listAll`, registered and exposed via preload following the existing
`session:getMostRecent` pattern exactly (invoke, no arguments).

### Sidebar view toggle

`App.tsx` gains a new piece of state, independent of `scope`:

```typescript
const [sidebarView, setSidebarView] = useState<'scoped' | 'all'>('scoped')
```

A new toggle button/icon sits next to `RepoSwitcher` in the sidebar header row (not inside
its dropdown — a separate, always-visible control). Clicking it flips `sidebarView`. Nothing
else reads or writes `sidebarView` except this button and the render branch below — in
particular, `handleOpenSession` is completely unchanged and never touches it, which is what
keeps "All Sessions" active after opening a session from within it.

### Rendering

In the sidebar's `.sidebar-scroll` area, the existing `{scope ? <SessionList .../> : ...}`
branch is extended: when `sidebarView === 'all'`, a new `AllSessionsList.tsx` component
renders instead of `SessionList`, regardless of whether `scope` is set. `AllSessionsList`:

- Fetches `window.api.session.listAll()` once on mount.
- Owns its own `query: string` search state and a text input above the list.
- Filters the fetched list client-side: `item.session.title.toLowerCase().includes(query.toLowerCase())`.
- Renders each match as a row: session title (reusing `.session-row-status-dot` +
  `.session-row-title` styling from the existing scoped list for visual consistency) plus
  the repo name in a small muted label after it.
- On click, calls the same `onOpenSession`-shaped callback `SessionList` already receives
  from `App.tsx` — `handleOpenSession(item.session, scopeOf(item.repo, item.project))` —
  passed down as a prop exactly like today, no new opening logic.

Busy-state dots follow the same pattern as `SessionList`'s existing `busySessionIds`
subscription to `window.api.session.onEvent` — duplicated locally in `AllSessionsList` rather
than lifted to a shared hook, since `SessionList` already owns its own copy of this same
subscription and this spec doesn't touch that existing duplication.

## Testing

- Manual: create sessions across 2+ different projects/repos; toggle to "All Sessions";
  confirm every session appears, sorted with the most recently opened at the top.
- Manual: type into the search box; confirm the list filters to matching titles only, and
  clearing the box restores the full list.
- Manual: click a session from a different project than the one currently in the tab bar;
  confirm it opens correctly (tab bar/editor update to that session's real scope) and the
  sidebar stays on "All Sessions" (toggle still shows it active).
- Manual: toggle back to the scoped view; confirm the existing project/repo session list
  still works exactly as before (grouped boxes, collapse/expand, indentation all unchanged).
- `sessionsRepo.listAll()` gets a real vitest test in `tests/main/db/sessionsRepository.test.ts`
  (ordering by most-recently-opened, falling back to creation time for a never-opened
  session, and including sessions from every repo/project, not just one).
