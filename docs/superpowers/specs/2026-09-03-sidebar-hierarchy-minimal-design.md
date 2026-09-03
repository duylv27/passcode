# Sidebar Hierarchy & Minimal Text — Design

## Problem

Project-scope session groups (added by the earlier resizable-sidebar/sidebar-enhancements
work) render a repo's name as a header row followed by its sessions as plain flat rows —
`.session-group` itself carries no visual container, and `.session-group-header` /
`.session-row-select` share the same horizontal padding. The result: nothing in the layout
actually shows that a session belongs to its repo header. Separately, repo/project name text
across the sidebar (`.session-group-header` at 11.5px/600 weight, `.session-row-select` at
12px) reads heavier and larger than the sidebar's other minimal chrome (`.sidebar-header` is
10.5px, for comparison).

## Goals

- Each repo group in project-scope session lists renders as a visually bounded box —
  bordered container, rounded corners — with the repo name as a header bar inside it and its
  sessions nested and indented beneath, separated by thin dividers. This directly matches the
  reference mockup the user provided (a bordered box, header row on top, indented session
  rows below, hairline separators between them).
- Session rows are visibly indented relative to their group's header, so the parent/child
  relationship is legible at a glance without reading the content.
- Repo/project name text and session name text both shrink and lighten: repo-group header
  text drops from 11.5px/weight 600/uppercase-adjacent styling to ~10px/medium weight,
  lowercase (title-case as typed, not forced uppercase); session row text drops from 12px to
  ~11px, regular weight.
- Repo-scope (single-repo, non-project) session lists are unaffected — they have no group
  header today and this spec doesn't add one; only project-scope grouped rendering changes.

## Non-goals

- No change to the underlying grouping logic (`groupSessionsByRepo` from
  `src/renderer/src/lib/sessionGroups.ts`) — this is a purely visual/CSS pass over an
  existing, working data structure.
- No change to collapse/expand behavior, its `localStorage` persistence, or the chevron
  icon's rotation logic — only its visual weight (as part of the header's overall lighter
  styling).
- No change to the repo picker dropdown (`RepoSwitcher`/`RepoList`/`ProjectTree`) — this
  spec is scoped to the sessions list beneath it, not the project/repo selector itself.
- No new component files — this is a CSS-only change to existing classes in
  `src/renderer/src/theme.css`, plus (if needed for the bordered-box structure) minor
  className additions in `SessionList.tsx`'s existing JSX, not a rewrite.

## Approach

### Bordered group container

`.session-group` (currently unstyled beyond a margin-top rule between consecutive groups)
gains a visible container: `border: 1px solid var(--border-subtle)`, `border-radius: 6px`,
`overflow: hidden` (so the header's background and the internal row dividers respect the
rounded corners cleanly). The existing `.session-group + .session-group { margin-top: 2px }`
rule increases slightly (e.g. to `6px`) so bordered boxes read as distinct groups rather than
touching.

### Header bar

`.session-group-header` keeps its existing button/click behavior (toggling collapse) but
gets a subtly different background than the session rows below it — `background:
var(--list-hover)` (confirmed: no dedicated header-background token exists in any of the
five themes today, and `--list-hover` is already the sidebar's standard "elevated" surface
color, used for hover states throughout) — so the header bar reads as the box's title strip,
matching the mockup's darker top bar. Its bottom edge gets a `border-bottom: 1px solid
var(--border-subtle)` to cleanly separate it from the first session row beneath it.

### Session row indentation + dividers

`.session-row` rows inside a `.session-group` (i.e., not the top-level flat list used in
repo-scope) get additional left padding — roughly 12–16px more than `.session-group-header`'s
own left padding — so they visibly nest under the header, matching the mockup's indent.
Consecutive session rows within the same group get a thin top border
(`border-top: 1px solid var(--border-subtle)`) so the divider lines from the mockup appear
between sessions, but not after the last row (the group's own bottom border/rounded corner
closes it off) and not between the header and the first row (the header's own
`border-bottom` already provides that line, so no double border).

Since `SessionList.tsx` already renders session rows both inside `.session-group` (project
scope) and as a flat top-level list (repo scope) using the same `renderSessionRow` /
`.session-row` markup, the indent and divider rules apply via a scoped selector
(`.session-group .session-row`) rather than changing `.session-row` globally — repo-scope's
flat list keeps its current unindented appearance, satisfying the Non-goals constraint.

### Text size and weight

- `.session-group-header`: font-size `11.5px` → `10px`; `font-weight: 600` → `500`.
- `.session-row-select` (the clickable session title button): font-size `12px` → `11px`;
  weight stays regular (it was never bold).

No other sidebar text (the "SESSIONS" section label, the repo-switcher trigger, etc.) is
touched — this spec is scoped to the grouped list's own two text roles per the Goals section.

## Testing

- Manual: open a project scope with 2+ repos, each having 1+ sessions; confirm each repo
  renders as a bordered box with its name as a header bar and sessions indented and
  separated by hairlines beneath it, matching the reference mockup's visual structure.
- Manual: collapse and re-expand a group, confirm the border/indent styling doesn't break or
  flicker during the transition.
- Manual: switch to repo scope (single repo, no project), confirm the flat session list is
  visually unchanged — no stray borders or indentation appear.
- Manual: check both light and dark themes (and at least one of the three added themes —
  Dracula/Nord/High Contrast) to confirm `var(--border-subtle)` and the header background
  token render sensibly in each, since this is a pure CSS pass with no new custom properties
  introduced beyond what's already themed.
- No automated tests apply — this is CSS-only with no new pure logic, consistent with this
  repo's existing renderer test coverage pattern (verified by typecheck + manual interaction).
