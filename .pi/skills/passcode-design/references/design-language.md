# PassCode Design Language & App Anatomy

## Design Language / Aesthetic

The theme is internally named **"Ledger"** — a cool-neutral paper palette, not an IDE's dark
chrome and not a warm editorial cream. That name is the whole design brief in one word: think a
physical accounting ledger or a well-typeset document, not a code editor or a SaaS dashboard.
Concretely, that means:

- **Hairline borders everywhere, no heavy chrome.** Dividers are 1px `--border`/`--border-subtle`, never thick panels or drop-shadow-heavy cards. The one exception is floating popovers (`box-shadow: 0 4px 16px rgba(0,0,0,.18)`) and the composer (`0 1px 4px rgba(0,0,0,.06)`) — both still subtle.
- **One accent color, used sparingly.** `--accent` marks the active state (selected tab, active sidebar icon, focused ring, checked switch) — it is not sprinkled around as decoration. Everything else is grayscale (`--fg`/`--fg-dim`/`--fg-faint`/`--fg-bright`).
- **Two fonts, strict split by content type.** Manrope for everything you'd call "UI" (labels, buttons, prose replies); IBM Plex Mono for anything data-shaped (tool args, timestamps, token counts, metrics pills, sidebar section headers in uppercase-tracked caps). Mixing them the other way (e.g. mono for a button label) reads as wrong immediately.
- **Restrained radii.** Two values only: `9px` (cards, composer, popovers) and `6px` (small controls, inline code blocks). Never a bespoke third radius.
- **A faint dotted-grid texture on the main content area** (`.editor-area`'s `radial-gradient` of 1px dots at 22px spacing) — the one deliberately textural touch, evoking ledger-paper graph lines. Subtle enough to be nearly subliminal; don't make new surfaces busier than this.
- **Flat, not skeuomorphic.** No gradients-as-depth, no bevels. Depth comes only from the hairline border + a very soft shadow, never from color gradients.
- **Chat transcript reads as a document, not chat bubbles for everything.** Only the user's own turns are right-aligned bubbles (`--list-active` fill); the agent's prose replies are full-width plain text, and its actions (tool calls + reasoning) render as a connected vertical timeline of small steps — closer to a build log or diff review than a messaging app.
- **Inline over modal.** The app avoids full-screen blocking dialogs for anything scoped to a single session/tool-call (see the approval panel) — prefer a card docked near the relevant control, so switching sessions/tabs never gets blocked.

## App Anatomy (layout regions, outside-in)

```
┌ .titlebar (36px, always-dark #1e1f22 regardless of theme; native frame replaced) ─────────┐
├ .activitybar (48px icon rail) │ .sidebar (resizable/collapsible) │ .editor-area ───────────┤
│  - icon per view, active = │  - .sidebar-header: mono,      │  - dotted-grid background   │
│    left accent border +    │    uppercase, letter-spaced    │  - session tabs (.tabs/.tab) │
│    accent-colored icon      │  - .project-box: collapsible   │    across the top            │
│                             │    tree rows (projects→repos→  │  - ChatPanel fills the rest: │
│                             │    sessions), or a flat list   │    transcript, approval      │
│                             │  - resize handle on the edge   │    panel, composer            │
├─────────────────────────────┴─────────────────────────────────────────────────────────────┤
│ .statusbar (32px): brand + version on the left, current repo/project scope on the right    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Popovers** (context-usage, session stats, active tools, model picker menu) anchor to their trigger badge/button, floating `280px`-ish cards with `border-radius: var(--radius)` and the one heavier shadow (`0 4px 16px rgba(0,0,0,.18)`) in the whole app — reach for this pattern for any "click a badge, see a small panel" need instead of a modal.
- **Welcome screen** replaces auto-jumping into the last session on every launch — a centered wordmark + tagline + primary/secondary action buttons + a "recent sessions" list, not a dashboard of widgets.
- **Settings** is a single scrollable column of bordered row-groups (`.settings-group` → `.settings-row`), each row a title+description on the left and a control (switch, segmented control, text field) on the right — never tabs or a sidebar-within-a-sidebar.

## Session/tab conventions

- Open sessions render as horizontal `.tab` pills across the top of the editor area (`.tabs`), not a second sidebar list — closing/pinning/bookmarking happens via a row of small icon buttons on the active tab, not a context menu-only flow.
- The sidebar's own list (`.project-box`) is a collapsible tree: project → repo → session, each level toggled by a chevron, distinguished from a session tab by staying in the sidebar rather than the top bar.

## Motion

The app uses very little animation — a pulsing border for `busy` composer state, a pulsing dot/icon for `running` timeline steps, a spin keyframe for loading spinners, and a smooth `200ms` border/shadow transition on focus. There is no slide-in/fade-in choreography for panels/popovers appearing — they just render, instantly, matching the "flat document" feel rather than a polished SaaS app's motion design.
