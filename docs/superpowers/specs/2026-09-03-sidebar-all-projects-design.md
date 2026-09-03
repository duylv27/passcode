# Sidebar: Always-Visible Project Boxes (No Scope Selection) — Design

## Problem

The sidebar currently requires picking exactly one repo or project via `RepoSwitcher`'s
dropdown before any sessions are visible at all — `App.tsx`'s `scope` state gates both what
the sidebar shows (`SessionList`, only rendered `if (scope)`) and what the tab bar/editor show
(`sessionsInScope`, filtered by `scope`). This means switching between sessions that belong to
different projects requires round-tripping through the dropdown every time, and there's no way
to see "everything at a glance." The earlier "All Sessions" plan (a toggled flat search list,
`docs/superpowers/specs/2026-09-03-all-sessions-view-design.md`) is superseded by this spec —
its two already-shipped backend pieces (`SessionsRepository.listAll()`,
`SessionHandlers.listAllSessions()` / `session:listAll` IPC, the `SessionWithScope` type) are
reused here, but its renderer-side plan (a toggle + separate flat list) is not built.

## Goals

- The sidebar always lists every project as a collapsible box — no dropdown, no scope
  selection required to browse or open any session. Boxes default to collapsed.
- Expanding a project box shows exactly the structure the current (soon-to-be-former)
  scoped `SessionList` already renders for one project: each repo as a collapsible
  sub-group with its own sessions, plus any project-scoped sessions (spanning every repo
  in the project).
- Two levels of session creation, each with its own "+": one on a project box's header
  (creates a project-scoped session), one on each repo sub-group's header (creates a
  repo-scoped session in just that repo) — preserving both creation modes that exist today.
- "Add repo" moves inside each project's box (replacing its current home inside the
  dropdown's picker).
- The tab bar shows every open session across every project at once, unfiltered — clicking
  any session anywhere opens it as a tab alongside whatever else is already open. Closing a
  tab selects another currently-open tab (no more "stay within the same scope" behavior,
  since there is no scope to stay within).
- The status bar's current-context label reflects whichever tab is selected (its repo name,
  or `"<project> (project)"` for a project-scoped session) — computed from the selected
  session itself, not from a separately-tracked scope.

## Non-goals

- No bookmark/pin UI in this spec — that's Goal work for a separate spec, sequenced after
  this one lands. This spec's project list ordering just needs to not actively fight a
  future "pinned projects float to top" feature (plain list, easy to re-sort later) — no
  bookmark data model, toggle, or persistence is built here.
- No search box in this spec, even though the backend (`listAllSessions`) already supports
  fetching everything needed for one — search is deferred to whenever it's actually wanted.
- No change to how an individual session's chat/tool-call transcript renders, how prompts
  are sent, or any main-process/IPC behavior beyond what already shipped
  (`SessionsRepository.listAll()`, `SessionHandlers.listAllSessions()`, `session:listAll`,
  `SessionWithScope` — all already committed and reused as-is).
- No multi-window support, no "pop out a project into its own window" — still one editor
  area, now just showing tabs from every project instead of one at a time.
- The existing "+ New project" action (currently the picker dropdown's own bottom row) keeps
  its current create-then-nothing-else behavior — no auto-expand-and-focus of the newly
  created (empty) project box is required, though it's a reasonable follow-up polish item.

## Approach

### Data flow: `openSessions` becomes self-describing

`App.tsx`'s `scope: Scope | null` state is removed entirely, along with `Scope`,
`sessionMatchesScope`, `scopeOf`, and `selectScope` — none of them have a role once nothing
gates the sidebar on a single selected scope.

`openSessions` changes from `SessionRecord[]` to `SessionWithScope[]` (the type already
shipped in `shared/types.ts`: `{ session: SessionRecord; repo: Repo; project: Project | null }`).
This is the key simplification: since a session is always opened by clicking it somewhere in
the new always-expanded-on-demand project tree, the click handler already has the session's
`repo`/`project` objects in hand (they're what the tree is rendering from) — no separate
lookup or stored "current scope" is needed to know, later, what a given open tab belongs to.
`selectedSession` becomes `SessionWithScope | null` for the same reason.

`handleOpenSession(item: SessionWithScope)` replaces the old two-argument
`handleOpenSession(session, scope)`. `handleCloseTab`, `handleSessionDeleted`, and
`handleSessionRenamed` all key off `item.session.id` exactly as they keyed off `session.id`
before — `handleSessionRenamed` additionally needs to update the `.session.title` field
inside the matched `SessionWithScope` rather than replacing the whole array entry with a bare
`SessionRecord`.

`handleCloseTab`'s "select another currently-open tab" logic drops its
scope-filtering (`remainingInScope`) — it simply selects the last remaining item in
`openSessions` (or `null` if none remain), matching a plain browser-tab-close behavior.

The tab bar (`SessionTabs`) receives `openSessions.map((item) => item.session)` directly (its
own prop type, `SessionRecord[]`, is unchanged — it never needed scope filtering itself, only
`App.tsx`'s old `sessionsInScope` derivation did, which is deleted). `ChatPanel`'s `repoName`
prop is computed from `selectedSession`: `selectedSession.project ? `${selectedSession.project.name} (project)` : selectedSession.repo.name`
(replacing the old `scopeName` derived from `scope`).

### Sidebar: the always-visible project tree

A new component (name and internal file boundaries are a plan-time decision, not fixed
here) replaces `RepoSwitcher` + the scoped `SessionList` together in `App.tsx`'s sidebar
render. It:

- Fetches `window.api.projects.list()` on mount (and on whatever refresh trigger already
  exists for project/repo creation today).
- Renders one collapsible box per project — reusing the existing `.session-group` /
  `.session-group-header` visual language (border, header bar, chevron), just one level
  higher than before. Collapsed by default; expand/collapse state persists per project via
  `localStorage`, following the same pattern `SessionList`'s existing per-repo collapse
  state already uses (`passcode-session-groups-<projectId>` today collapses repo
  sub-groups within one project — this spec adds a sibling key, e.g.
  `passcode-project-boxes` holding a `Record<projectId, boolean>`, for the outer project-level
  collapse state).
- Each project box's header carries a "+" that creates a project-scoped session
  (`window.api.session.createProjectSession`, exactly what `RepoSwitcher`'s old "+" did when
  a project was the active scope) and opens it immediately via the new
  `handleOpenSession(item: SessionWithScope)`.
- Expanding a project box fetches (or reuses already-fetched) that project's repos and
  sessions — the existing `listByProject`/`repos.list(projectId)` IPC calls, unchanged — and
  renders them with the exact repo-sub-group structure `SessionList` already has today
  (chevron, repo icon, indent, dividers, busy dot, edit/delete, its own "+" for a
  repo-scoped session). This part of the UI is not redesigned, only relocated one level
  deeper and duplicated across every project instead of just the selected one.
- Each project box also renders an "Add repo" row (the existing validated-git-repo add flow
  currently inside the dropdown's `RepoList`), and the whole list ends with the existing
  "+ New project" row.

### Testing

- Manual: with 2+ projects each having repos and a mix of project-scoped and repo-scoped
  sessions, confirm every project renders as a collapsed box by default; expanding one shows
  the same structure the old scoped view showed for a single project.
- Manual: open sessions from two different projects; confirm both appear as tabs
  simultaneously, and switching between them updates the status bar's context label
  correctly for each.
- Manual: close a tab; confirm another currently-open tab (from any project) is selected next,
  not filtered to "the same project" as before.
- Manual: create a project-scoped session via a project box's header "+", and a repo-scoped
  session via a repo sub-group's "+"; confirm both open correctly and appear in the right
  place when their box/sub-group is next viewed.
- Manual: restart the app; confirm collapsed/expanded state for each project box persisted.
- No automated tests beyond what already exists for the reused backend
  (`SessionsRepository.listAll()`, `SessionHandlers.listAllSessions()`) — this spec is
  renderer-only restructuring with no new pure logic beyond what a plan may choose to extract
  (e.g. a small collapse-state read/write helper, mirroring `SessionList.tsx`'s existing
  `collapsedStorageKey`/`readCollapsed` pattern).
