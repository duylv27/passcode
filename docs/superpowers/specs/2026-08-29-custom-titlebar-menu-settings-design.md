# Custom Title Bar, Hamburger Menu, Settings Modal & Theme Picker — Design

## Problem

The app currently uses the native OS window frame with no menu (the default Electron
File/Edit/View/Window menu bar was deliberately removed — see `Menu.setApplicationMenu(null)`
in `src/main/index.ts`). There's no way to reach app-level actions (new session, quit, toggle
sidebar, etc.) except through in-context UI. Settings is a panel that swaps into the editor
area rather than a modal. Appearance is a 3-way Light/Dark/System toggle. The user wants a
custom title bar with a hamburger menu (referencing OpenCode Desktop's UI as a starting point,
adapted to this app's actual feature set), a settings modal with a left-nav, provider status
shown as a dot instead of a text button, and 5 selectable themes.

## Goals

- Frameless window with a custom-drawn title bar: hamburger menu button, draggable region,
  custom minimize/maximize/close buttons.
- Hamburger menu with categories adapted to this app (not OpenCode's generic
  File/Edit/View/Go/Window/Help — "Edit" is dropped since nothing maps to it):
  - **File**: New Session, Close Tab, — , Quit
  - **View**: Toggle Sidebar
  - **Go**: Explorer, Settings, — , Next Tab, Previous Tab
  - **Window**: Minimize, Maximize/Restore, — , Close
  - **Help**: About PassCode
- Settings converts from an embedded editor-area panel to a centered modal dialog, still
  triggered by the existing activity-bar gear icon. Left-nav with three sections: General
  (theme picker), Providers (Anthropic/Copilot), Permissions (existing per-tool switches).
- Provider rows show a small status dot (connected = filled/green, not connected =
  outline/gray) instead of a "Connected" text button. Not-connected rows keep their
  Connect/Sign-in button.
- 5 selectable themes: Light and Dark (already exist) plus three new ones — Dracula, Nord,
  High Contrast — each a full CSS custom-property block matching the existing token set.
  "System" (auto light/dark) stays as a 6th option, unchanged behavior.

## Non-goals

- Session tabs do **not** move into the title bar and do **not** become global across
  scopes — they stay exactly where they are today (editor area, scoped to the selected
  repo/project). The title bar is hamburger + drag region + window controls only.
- Fixing the "manual approval doesn't actually prompt" bug is **out of scope for this
  spec** — it's a real functional bug in the approval flow, tracked separately, not part
  of this visual/structural redesign. The Permissions section's switches keep their
  current (buggy) behavior unchanged; only their visual placement moves into the modal.
- macOS-specific frameless-window handling (traffic-light repositioning, etc.) is not a
  goal — this project ships via `electron-builder`'s Windows target only (`dist:win`) and
  has no macOS testing in its history. Best-effort only if it happens to work; not verified.
- No new "reasoning summaries" or "expand tool parts" settings — those were OpenCode
  reference-screenshot items with no backing feature in this app; not added.
- The "About PassCode" item shows static info (name, version, logo) — no update-checking,
  no changelog, no external links required unless trivial to include.

## Approach

### Window chrome (main process)

`src/main/index.ts`'s `createWindow()` gains `frame: false`. A `TitleBar.tsx` renderer
component (new) renders a fixed-height draggable strip (`-webkit-app-region: drag` on the
bar itself, `no-drag` on every interactive child — hamburger button, window control
buttons) styled to match the existing VS Code-inspired chrome (`--sidebar-bg`, `--border`
tokens). New IPC channels let it drive real window state:

```
window:minimize()      -> win.minimize()
window:maximize()      -> win.isMaximized() ? win.unmaximize() : win.maximize()
window:close()         -> win.close()
window:isMaximized()   -> boolean
window:onMaximizeChange -> pushes true/false on 'maximize'/'unmaximize' window events,
                            so the title bar's restore/maximize icon reflects real state
                            (e.g. after double-clicking the title bar or an OS-level resize)
```

Exposed via `preload/index.ts` under a new `window` namespace on `Api`, following the
existing per-namespace `ipcRenderer.invoke`/`.on` pattern already used for `session`,
`approvals`, etc.

### Hamburger menu

A `TitleBarMenu.tsx` (new, or a section of `TitleBar.tsx` if small enough) renders the ☰
button and, on click, a dropdown positioned under it — same visual language as the existing
`.model-picker-menu`/`.skill-menu` dropdowns already in `ChatPanel.tsx` (bordered card,
`.zoom-viewer`-style but menu-shaped, click-outside-to-close). Categories are a flat
top-level list per the Goals section above (no nested/hover submenus — every item is a
single click), each item wired to existing app functions where they already exist:

- New Session / Close Tab: existing handlers already live in `App.tsx`/`SessionTabs.tsx`
  context — reuse them, don't duplicate.
- Toggle Sidebar: `App.tsx`'s existing `handleExplorerClick`.
- Explorer / Settings: `setActivity('explorer')` / opens the new Settings modal (see below).
- Next/Previous Tab: cycle `selectedSession` within the current `sessionsInScope` array
  (both already computed in `App.tsx`).
- Minimize / Maximize/Restore / Close: the same `window:*` IPC calls the title bar's own
  buttons use — one shared set of handlers, two UI entry points.
- About PassCode: a small modal/dialog showing app name, version (new `app:getVersion` IPC
  reading `app.getVersion()`), and the existing `LogoIcon`.

### Settings modal

`SettingsPanel.tsx` is restructured: its content moves into three named sections (General,
Providers, Permissions) matching the three existing groups (Appearance; Anthropic
key + Copilot login; per-tool switches) 1:1 — no new settings invented. A new
`SettingsModal.tsx` wraps it with a left-nav (`.pc-modal-nav`-style, per the approved
mockup) and renders as a fixed-position overlay (same `position: fixed; inset: 0` pattern
as `.approval-overlay`/`.zoom-viewer-overlay`), replacing the current
`activity === 'settings'` editor-area swap in `App.tsx`. The gear icon in the activity bar
keeps triggering it — just opens the modal instead of switching `activity`.

Provider rows (Anthropic, Copilot) replace their "Connected" text/button with a small
status dot: a filled `var(--success)`-colored circle when connected, an outline
`var(--border)`-colored circle when not, sitting inline next to the provider name. The
Connect/Sign-in button remains, shown only when not connected.

### Theme picker

`useTheme.ts`'s `ThemePreference` type expands from `'light' | 'dark' | 'system'` to
`'light' | 'dark' | 'dracula' | 'nord' | 'high-contrast' | 'system'`. `theme.css` gains
three new `:root[data-theme='dracula']`, `:root[data-theme='nord']`,
`:root[data-theme='high-contrast']` blocks, each defining the full existing token set
(`--bg`, `--sheet-bg`, `--activitybar-bg`, `--sidebar-bg`, `--editor-bg`, `--titlebar-bg`,
`--statusbar-bg`/`-fg`, `--border`/`-subtle`, `--fg`/`-dim`/`-faint`/`-bright`, `--accent`/
`-wash`, `--list-hover`/`-active`, `--input-bg`, `--button-bg`/`-hover`, `--success`,
`--danger`) — same shape as the existing `dark` block, new palette per the approved swatch
mockup (Dracula: `#282a36` bg, purple/pink accent; Nord: `#2e3440` bg, frost-blue accent;
High Contrast: pure black, yellow accent).

The Appearance row in Settings > General changes from a 3-way segmented control to a
swatch-card picker (per the approved mockup) showing all 6 options (5 explicit themes +
System) — small preview swatches, not a plain `<select>`, since the whole point is seeing
the palette before picking it.

## Risks / open questions

- The title-bar/hamburger-menu keyboard accelerators shown in the mockup (Ctrl+N, Ctrl+W,
  Ctrl+Tab, etc.) are visual labels only in this spec — actually binding global keyboard
  shortcuts is a separate concern (Electron accelerators vs. renderer-level listeners,
  potential conflicts with existing shortcuts like the app's Ctrl+±/0 zoom handling already
  in `main/index.ts`). Not committing to real keybindings here; the plan should treat the
  kbd labels as optional/deferred unless trivial.
- No automated tests for this feature, consistent with the rest of the renderer-UI layer in
  this project (no jsdom, no existing component tests for comparable pieces like
  `SettingsPanel.tsx`, `ChatPanel.tsx`). Verification is `npm run build` plus manual
  verification in the running app, same convention as the zoom-viewer feature.
- Frameless-window drag regions are notoriously fiddly to get pixel-perfect (dead zones
  where dragging doesn't work, buttons accidentally becoming part of the drag region). The
  plan should budget a manual-verification pass specifically for this, separate from the
  build-only checks used elsewhere.
