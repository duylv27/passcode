# Sidebar Hierarchy & Minimal Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project-scope session groups in the sidebar render as visually bounded boxes (bordered header bar + indented, divider-separated session rows) and shrink/lighten the repo-group and session-row text, matching a user-provided reference mockup.

**Architecture:** This is a pure CSS pass over `src/renderer/src/theme.css`. No component files, JSX, or logic change — every selector targets classNames that already exist in `SessionList.tsx`'s rendered markup (`.session-group`, `.session-group-header`, `.session-row-select`, etc.), added by the earlier sidebar-enhancements work.

**Tech Stack:** Plain CSS custom properties already defined per-theme in `theme.css` (`--border-subtle`, `--list-hover`, `--list-active`, `--space-2`). No new dependencies.

## Global Constraints

- Repo-scope (single-repo, non-project) session lists must render exactly as they do today — no border, no indent. Only project-scope grouped rendering (inside `.session-group`) gets the boxed/indented treatment.
- No change to `groupSessionsByRepo` (`src/renderer/src/lib/sessionGroups.ts`), collapse/expand logic, or `localStorage` persistence — visual-only change.
- No new CSS custom properties — reuse existing themed tokens (`--border-subtle`, `--list-hover`, `--list-active`) so the change renders correctly across all 5 existing themes (Light, Dark, Dracula, Nord, High Contrast) with no per-theme edits needed.
- `.session-group-header` text: font-size `11.5px` → `10px`, `font-weight` `600` → `500`.
- `.session-row-select` text: font-size `12px` → `11px` (applies globally — both grouped and flat/repo-scope rendering, per the spec's Goals section).

---

### Task 1: Boxed session-group hierarchy + lighter text

**Files:**
- Modify: `src/renderer/src/theme.css:545-619` (the `.session-group*`/`.session-row*` block)

**Interfaces:**
- None — this task only edits CSS rule bodies for existing selectors and adds two new scoped selectors (`.session-group .session-row-select`, `.session-group .session-row + .session-row`). No new classNames are introduced, so no JSX/TSX file needs touching.

- [ ] **Step 1: Add the bordered container to `.session-group`**

In `src/renderer/src/theme.css`, replace:

```css
.session-group + .session-group {
  margin-top: 2px;
}
```

with:

```css
.session-group {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  overflow: hidden;
}

.session-group + .session-group {
  margin-top: 6px;
}
```

- [ ] **Step 2: Restyle the header bar — background, bottom divider, lighter text**

Replace:

```css
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
```

with:

```css
.session-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  padding: 4px var(--space-2);
  background: var(--list-hover);
  border: none;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--fg-dim);
  font-size: 10px;
  font-weight: 500;
}

.session-group-header:hover {
  background: var(--list-active);
  color: var(--fg-bright);
}
```

(The header's own background now doubles as the "title strip" fill from the mockup, so hover
moves to `--list-active` instead of `--list-hover` — otherwise hover and rest state would be
identical and the row would lose its interactive feedback.)

- [ ] **Step 3: Indent session rows inside a group and add row-to-row dividers**

Immediately after the `.row-icon.is-session { ... }` rule (currently at
`src/renderer/src/theme.css:621-624`), add:

```css
.session-group .session-row-select {
  padding-left: 20px;
}

.session-group .session-row.is-editing {
  padding-left: 20px;
}

.session-group .session-row + .session-row {
  border-top: 1px solid var(--border-subtle);
}
```

(`padding-left: 20px` is `var(--space-2)`'s 8px base plus 12px of indent, matching the spec's
"12-16px more than the header's own left padding." The `+` combinator on the third rule only
matches a `.session-row` that has a preceding `.session-row` sibling inside the same group —
so it naturally skips the divider before the first row (already separated by the header's own
`border-bottom`) and never adds a trailing border after the last row.)

- [ ] **Step 4: Shrink session-row text**

Replace:

```css
.session-row-select {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 2px var(--space-2);
  background: none;
  border: none;
  color: var(--fg);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

with:

```css
.session-row-select {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  text-align: left;
  padding: 2px var(--space-2);
  background: none;
  border: none;
  color: var(--fg);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: no errors (this task touches no `.ts`/`.tsx` files, so this step only confirms
nothing else in the tree is broken)

- [ ] **Step 6: Manually verify**

Run: `npm run dev`
- Open a project scope with 2+ repos, each having 1+ sessions. Confirm each repo renders as
  a bordered, rounded box: a filled header bar (repo name + chevron) with a bottom divider,
  and its sessions indented beneath it with thin top-border dividers between them (none
  after the last session, none between the header and the first session).
- Confirm the repo-group header text is visibly smaller/lighter than before, and session
  row text is slightly smaller too.
- Collapse and re-expand a group; confirm the box border and indentation don't break or
  flicker during the transition.
- Switch to repo scope (select a single repo, not a project); confirm the session list
  renders as a flat, unindented, unbordered list exactly as before this change.
- Toggle through at least Light, Dark, and one of Dracula/Nord/High Contrast (Settings →
  General → theme picker); confirm the border and header-bar colors read sensibly in each.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "Box in session groups with a header bar, indent, and dividers; lighten sidebar text"
```

## Self-Review Notes

- **Spec coverage:** bordered container → Step 1; header bar background/divider → Step 2;
  session indentation + row dividers → Step 3; repo-group header text size/weight → Step 2;
  session-row text size → Step 4; repo-scope unaffected → guaranteed structurally (all new
  rules are scoped under `.session-group`, which only exists in project-scope rendering) and
  verified manually in Step 6. All five spec goals and all four non-goals are covered.
- **Placeholder scan:** no TBD/TODO; every step shows complete, exact CSS.
- **Type consistency:** N/A — no new selectors are referenced from JSX; both new scoped
  selectors (`.session-group .session-row-select`, `.session-group .session-row + .session-row`)
  compose only existing classNames already present in `SessionList.tsx`'s current markup.
