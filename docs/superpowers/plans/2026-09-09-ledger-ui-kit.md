# Ledger UI Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved "Ledger" visual direction (spec:
`docs/superpowers/specs/2026-09-09-ledger-ui-kit-design.md`) across PassCode
— new fonts, a cool-neutral/Moonstone-accent color palette for light+dark,
and a softened two-tier corner-radius scale — with Dracula/Nord/high-contrast
keeping their existing colors but inheriting the new shape language.

**Architecture:** This is a pure design-token change. Every component in
`ChatPanel.tsx` and friends already reads its colors, fonts, and (mostly)
radii from CSS custom properties defined in `src/renderer/src/theme.css`, so
no `.tsx` files change — the work is entirely `src/renderer/index.html`
(font `<link>`) and `src/renderer/src/theme.css` (tokens + a mechanical
sweep of hardcoded `border-radius` values onto the two new tokens).

**Tech Stack:** Plain CSS custom properties, Google Fonts, Electron/Vite dev
server, `tsc --noEmit` for a renderer-config sanity check (no `.tsx` is
touched, but a stale `out/` build could otherwise mask this).

## Global Constraints

- Light (`:root`) and dark (`:root[data-theme='dark']`) are the only theme
  blocks whose *colors* change. `:root[data-theme='dracula']`,
  `:root[data-theme='nord']`, and `:root[data-theme='high-contrast']` are
  never edited in this plan.
- The new `--radius: 9px` / `--radius-sm: 6px` tokens go in the base
  `:root` block (not per-theme) and apply to **every** theme, including
  Dracula/Nord/high-contrast, since shape is theme-independent per the spec.
- Any existing `border-radius: 999px` or `border-radius: 50%` is a pill or a
  circular avatar/dot — **never** touch these; they are explicitly excluded
  in the spec's Shape language section.
- `md-inline-code`, the two markdown code-block rules (`theme.css:991-995`,
  `theme.css:1010-1014`), and `.chat-line.is-markdown .md-body img`
  (`theme.css:2811-2813`) are typographic/content rules, not chrome — leave
  their radii untouched (the spec lists chrome components only: buttons,
  popovers, inputs, session rows, tabs, model-picker, stats/tools/context
  popovers, skill-picker menu, chat bubble — plus every other dialog/menu of
  the same "control chrome" family, which this plan sweeps for consistency).
- No `.tsx` file changes and no test changes are expected — this is
  token-only CSS work. Still run `tsc --noEmit -p tsconfig.web.json` at the
  end as a sanity check that nothing else broke.
- Never simulate mouse clicks/drags against the running app (established
  project rule) — verification is a passive, window-bounded screenshot only.

---

### Task 1: Swap the font `<link>` to Courier Prime + Newsreader

**Files:**
- Modify: `src/renderer/index.html:8-11`

**Interfaces:**
- Produces: the `Courier Prime` and `Newsreader` families become available
  to `theme.css`'s `--font-mono` / `--font-ui` / `--font-serif` tokens,
  which Task 2 repoints. Until Task 2 runs, the fonts are loaded but unused.

- [ ] **Step 1: Replace the Google Fonts `<link>`**

Open `src/renderer/index.html` and replace lines 8-11:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap"
      rel="stylesheet"
    />
```

with:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,500&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 2: Verify the file parses**

Run: `npx tsc --noEmit -p tsconfig.web.json` (from
`C:\Users\duy_le\projects\pi-agent-desktop`)
Expected: no output, exit code 0 (this file isn't type-checked, but this
confirms the surrounding toolchain is still healthy before further edits).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(ui): load Courier Prime + Newsreader for the Ledger UI kit"
```

---

### Task 2: Update light + dark color tokens

**Files:**
- Modify: `src/renderer/src/theme.css:8-49` (`:root`, light theme)
- Modify: `src/renderer/src/theme.css:54-86` (`:root[data-theme='dark']`)

**Interfaces:**
- Consumes: nothing from Task 1 directly (fonts and colors are independent
  edits to the same file's different rule blocks).
- Produces: `--bg`, `--sheet-bg`, `--activitybar-bg`, `--activitybar-fg`,
  `--activitybar-fg-active`, `--sidebar-bg`, `--sidebar-header-fg`,
  `--editor-bg`, `--titlebar-bg`, `--statusbar-bg`, `--statusbar-fg`,
  `--border`, `--border-subtle`, `--fg`, `--fg-dim`, `--fg-faint`,
  `--fg-bright`, `--accent`, `--accent-wash`, `--list-hover`,
  `--list-active`, `--input-bg`, `--button-bg`, `--button-hover` all take
  new values in both blocks. `--font-ui`, `--font-mono`, `--font-serif`
  (defined once, in the base `:root`) are repointed to the new families.
  Task 5 adds one more token (`--button-fg`) to these same two blocks.

- [ ] **Step 1: Replace the light theme's color block**

Open `src/renderer/src/theme.css`. Replace lines 8-49 (the whole `:root`
block, including its header comment) with:

```css
/* ---------------------------------------------------------------------
   Tokens — "Ledger": a cool-neutral paper palette instead of an IDE's
   dark chrome or a warm editorial cream. Hairline borders, a single
   Moonstone silver-blue accent, and a type mix of Courier Prime (all UI
   chrome/labels/data) and Newsreader (prose) rather than IBM Plex.
   --------------------------------------------------------------------- */
:root {
  color-scheme: light;

  --bg: #f4f5f3;
  --sheet-bg: #eceeea;

  --activitybar-bg: #eceeea;
  --activitybar-fg: #8b9094;
  --activitybar-fg-active: #55677a;
  --sidebar-bg: #eceeea;
  --sidebar-header-fg: #8b9094;
  --editor-bg: #f4f5f3;
  --titlebar-bg: #eceeea;
  --statusbar-bg: #eceeea;
  --statusbar-fg: #5c6268;
  --border: #c7ccc7;
  --border-subtle: #dadedb;
  --fg: #20242a;
  --fg-dim: #5c6268;
  --fg-faint: #8b9094;
  --fg-bright: #0b0d0f;
  --accent: #55677a;
  --accent-wash: rgba(85, 103, 122, 0.09);
  --list-hover: #e3e6e2;
  --list-active: rgba(85, 103, 122, 0.07);
  --input-bg: #fbfcfb;
  --button-bg: #55677a;
  --button-hover: #44525f;

  --success: #2e7d32;
  --danger: #c0392b;
  --warning: #a3690f;

  --font-ui: 'Newsreader', Georgia, 'Times New Roman', serif;
  --font-mono: 'Courier Prime', Consolas, 'Cascadia Code', ui-monospace, monospace;
  --font-serif: 'Newsreader', Georgia, 'Times New Roman', serif;

  --radius: 9px;
  --radius-sm: 6px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
}
```

Note `--success`/`--danger`/`--warning` are copied through unchanged (they
are semantic status colors, not the brand accent — spec explicitly keeps
these separate).

- [ ] **Step 2: Replace the dark theme's color block**

Immediately below (still lines that were originally 51-86, now shifted by
however many lines Step 1 added/removed — locate by the comment
`/* GitHub Dark High Contrast-inspired palette` and the
`:root[data-theme='dark'] {` rule that follows it), replace the whole block
with:

```css
/* Ledger dark — same shape/type as light, Moonstone accent goes light-on-dark. */
:root[data-theme='dark'] {
  color-scheme: dark;

  --bg: #0d0f10;
  --sheet-bg: #141718;

  --activitybar-bg: #141718;
  --activitybar-fg: #6b7072;
  --activitybar-fg-active: #9fb3c4;
  --sidebar-bg: #141718;
  --sidebar-header-fg: #6b7072;
  --editor-bg: #0d0f10;
  --titlebar-bg: #141718;
  --statusbar-bg: #141718;
  --statusbar-fg: #a9adaf;
  --border: #383d40;
  --border-subtle: #2a2e30;
  --fg: #eef0f1;
  --fg-dim: #a9adaf;
  --fg-faint: #6b7072;
  --fg-bright: #ffffff;
  --accent: #9fb3c4;
  --accent-wash: rgba(159, 179, 196, 0.14);
  --list-hover: #1a1e1f;
  --list-active: rgba(159, 179, 196, 0.1);
  --input-bg: #191c1e;
  --button-bg: #9fb3c4;
  --button-hover: #b5c6d3;

  --success: #3fb950;
  --danger: #f85149;
  --warning: #d29922;
}
```

Do not touch the `:root[data-theme='dracula']`, `:root[data-theme='nord']`,
or `:root[data-theme='high-contrast']` blocks that follow — they keep their
current colors verbatim.

- [ ] **Step 3: Confirm the other theme blocks are untouched**

Run: `git diff src/renderer/src/theme.css | grep -c "^-.*data-theme='dracula'\|^-.*data-theme='nord'\|^-.*data-theme='high-contrast'"`
Expected: `0` (no lines inside those blocks were removed/changed).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "feat(ui): apply Ledger color palette to light and dark themes"
```

---

### Task 3: Add radius tokens and sweep hardcoded corner radii

**Files:**
- Modify: `src/renderer/src/theme.css` (radius tokens already added to
  `:root` in Task 2, Step 1 — this task only does the sweep below)

**Interfaces:**
- Consumes: `--radius` (9px) and `--radius-sm` (6px), defined in Task 2.
- Produces: no new tokens; every listed selector now reads its corner
  radius from one of the two tokens instead of a literal.

The table below is the complete sweep. Each row is one `border-radius`
declaration to change, identified by its selector and current line number
(line numbers are from the file state *before* Task 2's edits — since Task
2 only changed line *count* inside the two theme blocks near the top of the
file, re-locate each selector by name with your editor's search rather than
trusting the exact number if it has drifted). Rows not listed (999px pills,
50% circles, and the three markdown/code-block exceptions named in Global
Constraints) are left exactly as they are — do not change them.

| Selector | Old | New |
|---|---|---|
| `.sidebar-nav-item` (~line 425) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.project-box` (~line 458) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.composer-field` (~line 632) | `border-radius: 2px;` | `border-radius: var(--radius-sm);` |
| `.btn` (~line 650) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| `.tab` (~line 700) | `border-radius: 7px 7px 0 0;` | `border-radius: var(--radius-sm) var(--radius-sm) 0 0;` |
| `.turn-bubble` (~line 854) | `border-radius: 10px;` | `border-radius: var(--radius);` |
| `.turn-image-thumb` (~line 880) | `border-radius: 10px;` | `border-radius: var(--radius);` |
| tool-call detail box (~line 1323, `background: var(--sidebar-bg)` block under a tool row) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| tool-call error box (~line 1361) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| diff-stat or similar detail box (~line 1389) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| session-preview card (~line 1445) | `border-radius: 10px;` | `border-radius: var(--radius);` |
| `.composer-tools-badge`-style chip (~line 1525) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| `.composer-image-chip img` (~line 1533) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| icon button near composer (~line 1546) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| skill-picker menu container (~line 1586) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| skill-picker option row (~line 1600) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.tab-select`-style element (~line 1727) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| model-picker menu container (~line 1763) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| icon button (~line 1826) | `border-radius: 3px;` | `border-radius: var(--radius-sm);` |
| session-stats grid (~line 1979) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| context-usage popover container (~line 2040) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| context-usage compact button (~line 2154) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| icon button (~line 2271) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| auth/status box (~line 2358) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| `.settings-input` (~line 2537) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.settings-btn` (~line 2555) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| approval dialog container (~line 2638) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.approval-input` (~line 2652) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| `.approval-skip` (~line 2679) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| `.approval-allow` (~line 2692) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| provider row box (~line 2725) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| provider row box (~line 2745) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| provider row box (~line 2759) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| icon button (~line 2774) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| icon button (~line 2840) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| titlebar menu container (~line 2893) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| titlebar menu item (~line 2923) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| `.about-dialog` (~line 2961) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| `.about-close` (~line 2995) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.new-project-dialog` (~line 3021) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| skills dialog container (~line 3078) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| `.settings-dialog`-style container (~line 3149) | `border-radius: 8px;` | `border-radius: var(--radius);` |
| `.toast` (~line 3168) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.settings-nav-item` (~line 3209) | `border-radius: 5px;` | `border-radius: var(--radius-sm);` |
| `.settings-close` (~line 3251) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| theme-picker row box (~line 3293) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| `.theme-swatch-preview` (~line 3304) | `border-radius: 4px;` | `border-radius: var(--radius-sm);` |
| icon button (~line 3484) | `border-radius: 3px;` | `border-radius: var(--radius-sm);` |
| context-menu container (~line 3508) | `border-radius: 6px;` | `border-radius: var(--radius-sm);` |
| context-menu item (~line 3520) | `border-radius: 3px;` | `border-radius: var(--radius-sm);` |

**Rows to explicitly skip (do not edit these lines):**
- `::-webkit-scrollbar-thumb` (999px), `.repo-status-dot` (50%),
  `.close-icon`-style buttons at ~517-521 that are perfectly round icon
  triggers using `3px` on a non-circular hit area — check each `50%`/`999px`
  row individually and skip it; if a row's value is `50%` or `999px`, it is
  never in the table above and must not be changed.
- `.md-inline-code` (~984), the two code-block rules (~995, ~1014), and
  `.chat-line.is-markdown .md-body img` (~2813) — leave at their current
  values (typographic content, not chrome, per Global Constraints).
- `.timeline-row-metrics`, `.thinking-slider-segments`,
  `.thinking-slider-segment.is-current`, `.composer-auto-btn`,
  `.context-usage-track`, `.context-usage-fill`,
  `.context-usage-window-track`, `.context-usage-window-fill`,
  `.copilot-quota-pill`, `.copilot-quota-bar`, `.copilot-quota-bar-fill`,
  `.switch-track`, `.segmented`, `.segmented-option` — all already `999px`
  pills, skip.
- Every `50%` row (avatars, status dots, provider dots, the switch thumb,
  the context-usage ring/dot) — skip.

- [ ] **Step 1: Apply every row in the table above**

Use your editor's find-and-replace per selector (not a blind global
`border-radius: 6px` → token replace — several `6px`/`8px`/`4px` values
belong to the skip list above and must stay literal).

- [ ] **Step 2: Confirm no skipped selector was touched**

Run: `grep -n "border-radius: 999px\|border-radius: 50%" src/renderer/src/theme.css | wc -l`
Expected: `31` (the same count as before this task — none of the pill/circle
rows should have changed). If the count differs, find which skip-list
selector was accidentally edited and revert it.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "feat(ui): repoint chrome border-radius values onto --radius/--radius-sm"
```

---

### Task 4: Soften the heaviest popover/menu shadows

**Files:**
- Modify: `src/renderer/src/theme.css` (`box-shadow` rules on floating
  surfaces)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new tokens — this is a value-only edit on existing
  `box-shadow` declarations.

- [ ] **Step 1: Find the floating-surface shadow rules**

Run: `grep -n "box-shadow:" src/renderer/src/theme.css`

Expected output includes (among possibly others) shadow rules on the
context-usage popover, session-stats popover, tools popover, model-picker
menu, skill-picker menu, and any dialog/menu container. For each rule whose
`box-shadow` has an alpha (the last number in its `rgba(...)`) of `0.3` or
higher, reduce the alpha by roughly a third and increase the blur radius by
roughly 20%, matching the spec's example transform:
`0 12px 32px -18px rgba(0,0,0,0.35)` → `0 16px 40px -22px rgba(0,0,0,0.22)`.
Apply the same proportional change to each matching rule found by the grep
above (do not touch shadow rules with alpha already below `0.3` — they are
already soft).

- [ ] **Step 2: Visually confirm no popover lost its shadow entirely**

Run: `grep -n "box-shadow:" src/renderer/src/theme.css` again and read each
changed line — every one must still have a non-zero blur and a non-zero
alpha. A popover with `box-shadow: none` would blend into the page behind
it, which is not the intent (softer, not gone).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "feat(ui): soften popover and menu shadow weight"
```

---

### Task 5: Fix button text contrast in dark mode

**Files:**
- Modify: `src/renderer/src/theme.css:8-49` (add `--button-fg` to light
  `:root`)
- Modify: `src/renderer/src/theme.css:54-86` (add `--button-fg` to dark
  `:root[data-theme='dark']`)
- Modify: `src/renderer/src/theme.css` lines for `.btn-primary` (~668),
  `.settings-btn` (~2559), `.approval-allow` (~2695), `.about-close`
  (~2996)

**Interfaces:**
- Consumes: nothing new.
- Produces: `--button-fg` token, consumed by the four selectors listed
  above (and available to any future `--button-bg`-using rule).

In dark mode, `--button-bg` is now `#9fb3c4` (a light Moonstone silver-blue)
— a light background needs dark text, but three of the four
`--button-bg`-using rules currently hardcode `color: #ffffff` and the fourth
uses `color: var(--fg-bright)` (which is `#ffffff` in dark mode too). All
four would be illegible white-on-light-blue in dark mode without this fix.

- [ ] **Step 1: Add `--button-fg` to the light theme block**

In the `:root` block written in Task 2 Step 1, add one line after
`--button-hover: #44525f;`:

```css
  --button-hover: #44525f;
  --button-fg: #ffffff;
```

- [ ] **Step 2: Add `--button-fg` to the dark theme block**

In the `:root[data-theme='dark']` block written in Task 2 Step 2, add one
line after `--button-hover: #b5c6d3;`:

```css
  --button-hover: #b5c6d3;
  --button-fg: #0c1116;
```

- [ ] **Step 3: Repoint the four hardcoded button text colors**

`.btn-primary` (~line 668):
```css
.btn-primary {
  background: var(--button-bg);
  border-color: transparent;
  color: var(--button-fg);
}
```

`.settings-btn` (~line 2552-2559), change only the `color` line:
```css
  color: var(--button-fg);
```

`.approval-allow` (~line 2690-2698), change only the `color` line:
```css
  color: var(--button-fg);
```

`.about-close` (~line 2990-2998), change only the `color` line:
```css
  color: var(--button-fg);
```

- [ ] **Step 4: Confirm no other hardcoded button-bg text color was missed**

Run: `grep -n -B4 "color: #ffffff\|color: var(--fg-bright)" src/renderer/src/theme.css | grep -B4 "button-bg"`
Expected: no output (every `--button-bg` rule's text color now reads
`var(--button-fg)`).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "fix(ui): add --button-fg so button text stays legible in dark mode"
```

---

### Task 6: Verify build and visually confirm both themes

**Files:** none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: nothing — this is the plan's final check.

- [ ] **Step 1: Type-check the renderer**

Run: `npx tsc --noEmit -p tsconfig.web.json` (from
`C:\Users\duy_le\projects\pi-agent-desktop`)
Expected: no output, exit code 0.

- [ ] **Step 2: Restart the dev server**

Kill any stale dev-server/Electron processes first (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -match 'electron-vite|npm-cli.js.*run dev' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

Then start it (Bash, backgrounded):

```bash
cd "/c/Users/duy_le/projects/pi-agent-desktop" && unset ELECTRON_RUN_AS_NODE; npm run dev > /tmp/dev-log-ledger-ui-kit.txt 2>&1 &
```

Expected in `/tmp/dev-log-ledger-ui-kit.txt`: "dev server running for the
electron renderer process" and "start electron app..." with no errors
above those lines.

- [ ] **Step 3: Take a window-bounded screenshot of the light theme**

Per this project's established safety rule, never simulate clicks/drags to
drive the app. Take a passive, window-bounded screenshot only (PowerShell,
Win32 `GetWindowRect` + `CopyFromScreen` cropped to the PassCode window's
own rect, matching on `MainWindowTitle -eq "PassCode"`), and visually
confirm: cool-neutral paper background (not the old warm cream or pure
white), Moonstone silver-blue accent on the active tab underline and send
button, softened ~9px corners on the composer field and popovers (not sharp
2-4px corners), Courier Prime on tab labels/timestamps, Newsreader on chat
text.

- [ ] **Step 4: Toggle to dark mode and repeat the screenshot**

The app's own theme switcher (Settings → Appearance, or however the running
build already exposes it) sets `data-theme="dark"` — since this task cannot
click through the UI itself, ask the user to toggle dark mode once, or read
`localStorage`'s `passcode-theme` key logic in `src/renderer/index.html:15`
to confirm which stored value produces dark mode, and have the user confirm
visually: dark near-black paper, light Moonstone silver-blue accent and
button, and legible (dark-on-light) text on the accent-colored button from
Task 5.

- [ ] **Step 5: Report findings to the user**

Summarize what the screenshot(s) show and ask the user to confirm both
themes look correct before considering the plan complete. Do not mark this
task complete until the user confirms — this task has no automated pass/fail
signal.

---

## Post-plan note

No git commit is needed for Task 6 (verification only, no file changes). If
the user requests changes after reviewing the screenshots, make them as
follow-up edits to the same `theme.css` rules and re-run Task 6's
verification steps.
