---
name: passcode-design
description: Use when designing, mocking up, reviewing, or implementing any UI screen, dialog, panel, or component for the PassCode desktop app (this repo) -- covers matching its exact color tokens, spacing, typography, and existing component class conventions instead of improvising a generic look.
---

# PassCode Design

## Overview

PassCode's whole visual language lives in one file: `src/renderer/src/theme.css`. There is no
separate design-tokens package or Figma export to reconcile against -- that file IS the source of
truth, for every theme (light "Ledger", dark, dracula, nord, high-contrast).

**Core principle: never invent a color, spacing value, radius, or component shape. Grep
`theme.css` (and `src/renderer/src/components/icons.tsx` for icons) for the real one first.**

The theme is internally named **"Ledger"** — a cool-neutral paper palette (hairline borders, one
sparing accent color, flat surfaces, a faint dotted-grid texture on the main content area, inline
panels instead of modals). Full aesthetic rationale + an ASCII map of every layout region
(titlebar/activitybar/sidebar/editor-area/statusbar, popovers, tabs, settings) is in
[references/design-language.md](references/design-language.md) -- read that before designing
anything non-trivial, not just this summary.

## When to Use

- Building an HTML/design mockup or artifact for a new PassCode feature or dialog
- Implementing a new renderer component (`src/renderer/src/components/*.tsx`)
- Reviewing whether a UI change matches the existing look before merging
- Redesigning an existing surface (e.g. turning a modal into an inline panel)

**Not for:** main-process/IPC logic, other repos, CLI-only tooling with no UI.

## Quick Reference — Light Theme Tokens

Always re-check these against `theme.css` `:root` (this snapshot can drift) -- but as of writing:

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#f4f5f3` | App background |
| `--sidebar-bg` / `--editor-bg` | `#eceeea` / `#f4f5f3` | Sidebar vs. main content panels |
| `--border` / `--border-subtle` | `#c7ccc7` / `#dadedb` | Hairline dividers, card borders |
| `--fg` / `--fg-dim` / `--fg-faint` / `--fg-bright` | `#20242a` / `#5c6268` / `#8b9094` / `#0b0d0f` | Text hierarchy, dimmest to boldest |
| `--accent` / `--accent-wash` | `#55677a` / `rgba(85,103,122,.09)` | The one accent color + its low-opacity fill |
| `--list-hover` / `--list-active` | `#e3e6e2` / `rgba(85,103,122,.07)` | Row hover / selected states |
| `--input-bg` | `#fbfcfb` | Composer, cards, form fields |
| `--button-bg` / `--button-hover` / `--button-fg` | `#55677a` / `#44525f` / `#fff` | Primary buttons (e.g. Allow) |
| `--success` / `--danger` / `--warning` | `#2e7d32` / `#c0392b` / `#a3690f` | Status colors |
| `--radius` / `--radius-sm` | `9px` / `6px` | Card corners / small controls |
| `--space-1..4` | `4/8/12/16px` | The only spacing scale -- don't add arbitrary px values |

Full token tables for dark/dracula/nord/high-contrast: [references/themes.md](references/themes.md).

## Typography

Two fonts, loaded via Google Fonts in `src/renderer/index.html`:

- **Manrope** (`--font-ui`) — everything: labels, prose, buttons
- **IBM Plex Mono** (`--font-mono`) — anything data-shaped: tool args, code, timestamps, metrics pills

Don't reach for system fonts or a third typeface.

## Component Conventions (grep theme.css for the exact rules)

| Concern | Classes | Notes |
|---|---|---|
| Composer | `.composer`, `.composer-topbar`, `.composer-auto-btn(.is-active)` | Rounded card, `max-width: 900px`, centered. `is-busy` pulses the border red while a turn runs. |
| Tool approval | `.approval-panel`, `.approval-panel-main/text/title/input/actions/queue-hint`, `.approval-skip`, `.approval-allow` | Inline card docked **above the composer**, styled like it (same radius/shadow) -- deliberately not a full-screen modal, so switching sessions/tabs stays possible. |
| Transcript rows | `.chat-line(.is-user/.is-error/.is-markdown/.is-thinking)`, `.turn-bubble` | User turns are right-aligned bubbles; errors/denials are monospace danger-red text, not a separate visual language. |
| Tool-call timeline | `.timeline-row`, `.timeline-dot(.is-running/.is-done/.is-error)`, `.timeline-tool-icon`, `.timeline-row-header/title/summary/metrics` | Connected vertical line of reasoning+tool-call steps; per-tool icon replaces the plain status dot when one exists. |
| Settings toggles | `.settings-row`, `.settings-row-text/title/desc`, `.switch/.switch-track/.switch-thumb` | Bordered row-list groups (`.settings-group`), not cards-in-a-grid. |
| Status bar | `.statusbar`, `.statusbar-brand`, `.statusbar-version`, `.statusbar-dev-badge` | Bottom strip: brand+version on the left, current scope on the right. |
| Popovers | `.context-usage-popover` (pattern reused for stats/tools/model menus) | Anchored `position: absolute` card off a trigger badge, `280px`-ish wide, the one heavier shadow in the app. Use for any "click a badge to see detail" need. |
| Sidebar tree | `.sidebar`, `.sidebar-header`, `.project-box(-header/-toggle/-label/-chevron)`, `.tabs`/`.tab(.is-active)` | Collapsible project→repo→session tree; open sessions render as tabs across the top of the editor area, not a second sidebar. |
| Titlebar | `.titlebar`, `.titlebar-btn`, `.titlebar-home` | Custom-drawn (native OS frame disabled), always the fixed dark palette (`--titlebar-fixed-*`) regardless of active theme — a deliberate exception to "everything follows the theme." |

## Icons

Inline SVG React components in `src/renderer/src/components/icons.tsx` — ~35 of them (`ReadIcon`,
`WriteIcon`, `EditIcon`, `TerminalIcon`, `SearchIcon`, `FolderIcon`, `ListIcon`, `ChevronIcon`,
`SendIcon`, `StopIcon`, `GearIcon`, provider marks, etc). Two conventions:

- **Tool-action icons** (read/write/edit/bash/grep/find/ls): 12×12 viewBox, `stroke="currentColor"`, `stroke-width="1.4"`, no fill.
- **UI glyphs** (send, stop, chevron, gear): 16×16 (or 10×10 for tiny ones) viewBox, `fill="currentColor"`.

Copy the exact `<path>` data from that file into mockups/new components instead of drawing new
icons — the whole app's icon set reads as one hand precisely because nothing is improvised here.

## Building a Standalone HTML Design Artifact

1. Grep `theme.css` for every class the new surface touches; don't rely on memory of past designs (class names get restructured).
2. Copy the literal light-theme token *values* into a `:root { --token: value; }` block at the top of the artifact, then use `var(--token)` everywhere below it -- keeps the artifact self-contained (opens in any browser, no build step) while staying visually identical to the real app.
3. Reuse the app's actual class names (`approval-panel`, `composer-auto-btn`, etc.) verbatim on the replicated markup, so a side-by-side with a real screenshot lines up structurally, not just by eye.
4. Load the same Google Fonts `<link>` (Manrope + IBM Plex Mono) the real app uses.
5. Keep any artifact-only scaffolding (section headers, captions, state labels) in visually distinct chrome so it's obvious what's "real app" vs. "artifact narration."

## Common Mistakes

| Mistake | Fix |
|---|---|
| Picking a "close enough" hex color | Grep the exact `--token` value from `theme.css` instead |
| Using a full-screen modal for a lightweight, single-session interaction | This app favors inline cards docked near the relevant control (see the approval panel) |
| Drawing a new icon | Copy the existing SVG path from `icons.tsx` |
| Hardcoding spacing like `10px`/`14px` | Use the `--space-1..4` scale (4/8/12/16px) — there is no fifth value |
| Assuming light-theme values work for dark/dracula/nord/high-contrast | Check [references/themes.md](references/themes.md) — the same variable names resolve very differently |
