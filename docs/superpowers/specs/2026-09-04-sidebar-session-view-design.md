# Sidebar Session View — Design

## Problem

The sidebar currently has exactly one layout: project boxes, each expandable to show
its repo(s) and their sessions. Finding "what did I work on recently" means opening
every project box and scanning each one's list separately — there's no single,
chronological view across all work. A reference app (screenshot shared by the user)
shows a flat, day-grouped session timeline with a richer per-row layout (status dot,
timestamp, bold title, a status line) that's faster to scan for this specific need.

## Goals

- **Two sidebar views**, switched via a small two-tab control above the content:
  **Sessions** (new, default on launch) and **Projects** (today's existing project-box
  tree, unchanged in structure — including the modal/folder-picker/info-badge/
  rename-delete work from `2026-09-04-project-management-ux-design.md`).
- **Session view**: one flat list of every session across every project, grouped by
  day (**Today**, **Yesterday**, weekday names back to a week, then a collapsible
  **Older Sessions** bucket), newest-first within each group.
- **Project chips**: a horizontal strip above the session list, one chip per project.
  Clicking a chip marks it "active" (highlighted); the sidebar's **+ New** action
  always creates a session in the currently-active project's repo.
- **Row layout**: status dot, bold title, a right-aligned timestamp on the title's
  line, and a second line showing the repo name, branch, and the existing dirty/clean
  indicator — timestamp and repo/git-status kept on separate lines, not crammed
  together.

## Non-goals

- No search or filter UI in this pass (explicitly deferred by the user).
- No user-created folders/groups (e.g. "In Review") — sessions are grouped only by
  day, nothing else.
- No issue/PR tags, comment-count chips, or "Loop N/M" style status text — PassCode
  has no PR/issue integration to source that data from.
- No top workspace-tab bar (Local/DevBox1/...) — dropped; PassCode is single-machine.
- No change to the Projects view's structure or behavior beyond what's already
  specced in `2026-09-04-project-management-ux-design.md`.
- No change to session open/rename/delete *behavior* — Session view rows reuse the
  same actions Project view rows already have (open on click, hover-reveal rename/
  delete), just in the new visual layout.

## Approach

### View switch

`ProjectExplorer.tsx` gains a `view: 'sessions' | 'projects'` state (default
`'sessions'`, not persisted — always opens to Session view). A small two-tab
segmented control renders above the sidebar content and toggles it. When `view ===
'projects'`, render exactly what `ProjectExplorer` renders today (the project-box
tree). When `view === 'sessions'`, render a new `SessionTimeline` component instead.

### Data fetch

`window.api.session.listAll()` already exists end-to-end (`sessionHandlers.ts`'s
`listAllSessions()` → `sessionsRepository.ts`'s `listAll()`) and returns
`SessionWithScope[]` (`{ session, repo, project }` triples per `shared/types.ts`),
already covering every session across every project in one call, pre-sorted by
`COALESCE(last_opened_at, created_at) DESC`. That column exists in the `sessions`
table (`schema.ts`) but isn't currently exposed on the `SessionRecord` type returned
to the renderer — one small addition is needed: add `lastOpenedAt: string | null` to
`SessionRecord` in `shared/types.ts`, and have `sessionsRepository.ts`'s row-mapping
include it (`last_opened_at` → `lastOpenedAt`), so day-bucketing (below) can use the
same timestamp the list is already sorted by, instead of falling back to `createdAt`
and disagreeing with the sort order. `SessionTimeline` calls `listAll()` on mount and
on the same `session:onEvent` busy-state subscription `SessionList.tsx` already uses
(for the busy-dot on active sessions).

### Day grouping

Client-side grouping: bucket each `SessionWithScope` by the calendar day of
`session.lastOpenedAt ?? session.createdAt` (the same timestamp the list is already
sorted by, per the Data fetch section above). Buckets, in order: **Today**,
**Yesterday**, then each of the prior 5 weekdays by name (e.g. "Wed"), then
**Older Sessions** for anything beyond 7 days.
Older Sessions renders collapsed by default, same collapse/expand + localStorage
persistence pattern `ProjectBox`'s `readCollapsed`/`toggleCollapse` already uses (new
key, e.g. `passcode-session-view-older-collapsed`). Within a bucket, sessions sort
newest-first.

### Project chip strip

A horizontal scrollable row of chips, one per `window.api.projects.list()` entry,
rendered above the day-grouped list. `SessionTimeline` holds `activeProjectId` state,
defaulting to the project of the most recently used session (the first entry
`listAll()` returns, since it's newest-first) or the first project if there are no
sessions yet. Clicking a chip sets `activeProjectId`. The sidebar's existing **+ New**
button (today wired to `ProjectBox`'s single-repo header action) is relocated to sit
next to the view-tab control, calling `window.api.session.create(repo.id)` for the
active project's repo — for this to stay valid under the Non-goals' 1:1 project-repo
model, this requires the active project to have exactly one repo, which is always
true today; if a future project ever has zero repos, **+ New** is disabled for that
chip.

### Row rendering

```
[status-dot]  Fix login redirect bug                    3:28 PM
              passcode-desktop · main [status-dot: clean/dirty]
```
- Status dot: reuses `session-row-status-dot`/`is-busy` exactly as `SessionList.tsx`
  already renders it.
- Title: bold, truncates with ellipsis via existing `.session-row-title` styling.
- Timestamp: new small/muted text, right-aligned on the title's row — formatted as
  time-of-day ("3:28 PM") within Today/Yesterday buckets, otherwise omitted (the day
  header already conveys the date).
- Second line: repo name + branch, reusing `repo-status-dot`/`is-dirty` exactly as
  `SessionList.tsx`'s multi-repo branch already renders it for its group headers —
  fetched once per repo via `window.api.repos.gitStatus(repo.id)`, batched with
  `Promise.all` across the distinct repos present in the fetched sessions (not
  per-row, to avoid duplicate calls for repos with multiple sessions).
- Hover-reveals the same rename/delete icon pair `SessionList.tsx`'s `renderSessionRow`
  already has (`session-row-edit`/`session-row-delete`, `visibility: hidden/visible`),
  and clicking the row opens the session via the same `onOpenSession` callback prop
  `ProjectExplorer` already threads down today.

### Component boundaries

- `SessionTimeline.tsx` (new): owns the `listAll()` fetch, day-bucketing, project-chip
  strip, and renders `DayGroup` sub-sections.
- `SessionTimelineRow.tsx` (new): one row — title/timestamp/repo-status line +
  rename/delete, extracted so it's usable independently of `SessionList.tsx`'s
  existing per-repo row renderer (kept separate rather than shared, since Project
  view's row has no timestamp/repo-status line and Session view's has no
  repo-group-header context — forcing one shared component would need a pile of
  conditional props for two genuinely different layouts).
- `ProjectExplorer.tsx`: adds the view-tab state/control; delegates to either the
  existing project-box render path or the new `SessionTimeline`.

## Testing

- Manual: launch the app, confirm Session view is selected by default and shows every
  session from every project in day buckets, newest first within each bucket.
- Manual: confirm Today/Yesterday/weekday bucket labels match actual session
  timestamps, and sessions older than a week collapse into "Older Sessions"
  (collapsed by default; expand/collapse state persists across a reload).
- Manual: click a project chip, confirm it highlights and **+ New** creates a session
  in that project's repo, opening it as the active tab.
- Manual: confirm a row's repo/branch line and dirty/clean dot match what Project
  view already shows for that same repo.
- Manual: hover a session row, confirm rename/delete icons appear without shifting
  layout (reusing the existing `visibility` hover pattern), and both actions work
  and are reflected immediately in the timeline.
- Manual: switch to Projects tab, confirm the existing project-box tree renders
  exactly as it does today, with no regression from the new state added to
  `ProjectExplorer.tsx`.
- No automated tests for the new renderer components, consistent with this repo's
  established pattern (no jsdom; renderer changes verified by typecheck + manual
  interaction). `npx tsc -p tsconfig.web.json --noEmit` must stay clean.
