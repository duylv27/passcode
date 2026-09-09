# PassCode "Ledger" UI Kit — Design Spec

**Goal:** Replace PassCode's current visual language (IBM Plex trio + violet
accent, which reads too close to generic AI-tool/Claude-Code chrome) with a
distinctive, own-brand identity called **Ledger** — a working-tool aesthetic
set like an accountant's ledger or a terminal session log, applied
consistently across every component in the app.

**Approved via:** interactive HTML catalog (3 candidate directions —
Ledger, Ink & Brass, Circuit Trace — rendered with real components). User
picked Ledger, then iterated twice: (1) cool-neutral paper + Moonstone
silver-blue accent instead of the initial warm-cream/rust-amber pass, (2)
softened corners/shadows/ink-weight after "too rigid" feedback. This spec
captures the final, approved v3.

## Scope

- **Light and dark are the flagship themes** — both get the full Ledger
  treatment below (palette + type + shape).
- **Dracula, Nord, and high-contrast keep their own palettes** (accent,
  backgrounds, borders unchanged) but inherit the new **shape language**:
  the new `--radius`/`--radius-sm` tokens and the `--font-mono`/`--font-ui`
  swap apply globally, since those are typeface/shape decisions, not
  per-theme colors.
- Out of scope: app icon/logo/favicon, onboarding/marketing surfaces. This
  pass is the in-app component design language only (chat, tabs, sidebar,
  composer, popovers, buttons) — matches the user's earlier explicit choice
  of "component design language first" over a brand-identity-first pass.

## Concept

Ledger treats the chat transcript as a record, not a conversation bubble
thread: hairline rules instead of heavy borders, softly-rounded (not sharp,
not pill-everywhere) corners, a typewriter mono for all UI chrome/labels/data
(tabs, timestamps, tool-call labels, badges), and a quiet reading serif for
the actual prose (user messages, assistant replies). The accent is
**Moonstone silver-blue** — a muted, desaturated steel-blue tied to Cancer's
Moon rulership (the user's personal reference point for "iconic"), calm and
unmistakably not the violet/blue-gradient default every AI chat tool reaches
for.

## Typography

Loaded via Google Fonts in `src/renderer/index.html` (replacing the current
IBM Plex Sans/Mono/Serif `<link>`):

- **`--font-mono`**: `'Courier Prime', Consolas, 'Cascadia Code', ui-monospace, monospace`
  — a real typewriter face (not a coding-IDE mono like the current IBM Plex
  Mono), used everywhere `--font-mono` is already used today: tab labels,
  timeline labels (`think`/`tool`), tool-call text, badges, session
  timestamps, popover data rows, the reasoning-slider segment labels, the
  titlebar menu, skill-source badges, diff view, code blocks. This token is
  already applied pervasively across `theme.css` (~35 call sites) — swapping
  its value is most of the "Ledger voice" in one change.
- **`--font-ui`**: `'Newsreader', Georgia, 'Times New Roman', serif` —
  replaces IBM Plex Sans as the general body/UI face: chat bubble text,
  assistant markdown replies, buttons, menus, composer placeholder text,
  settings rows. Newsreader is a quiet reading serif, not a display face —
  it should read as considered, not decorative, even on buttons.
- **`--font-serif`**: keep the token but point it at the same value as
  `--font-ui` (`'Newsreader', Georgia, 'Times New Roman', serif`) rather
  than removing it — it's only used at two minor empty-state icon spots
  (`theme.css:388`, `theme.css:836`) and Newsreader is now the app's one
  serif/prose face, so a distinct third family there adds nothing.
- Weights needed from Google Fonts: Courier Prime `400;700`; Newsreader
  `opsz,wght@0,6..72,400;0,6..72,500;1,6..72,500` (the italic 500 covers the
  assistant name label treatment, see Components below).

## Color tokens

New values for `:root` (light) and `:root[data-theme='dark']` in
`theme.css`. Every other existing token not listed here (e.g. `--success`,
`--danger`, `--warning`, `--space-*`) is unchanged. Dracula/Nord/high-contrast
blocks are untouched entirely.

**Light (`:root`):**
| Token | New value | Was |
|---|---|---|
| `--bg` | `#f4f5f3` | `#ffffff` |
| `--sheet-bg` | `#eceeea` | `#fbfbf9` |
| `--activitybar-bg` | `#eceeea` | `#fbfbf9` |
| `--activitybar-fg` | `#8b9094` | `#9b9c99` |
| `--activitybar-fg-active` | `#55677a` | `#6c38e8` |
| `--sidebar-bg` | `#eceeea` | `#fbfbf9` |
| `--sidebar-header-fg` | `#8b9094` | `#9b9c99` |
| `--editor-bg` | `#f4f5f3` | `#ffffff` |
| `--titlebar-bg` | `#eceeea` | `#ffffff` |
| `--statusbar-bg` | `#eceeea` | `#fbfbf9` |
| `--statusbar-fg` | `#5c6268` | `#5f6066` |
| `--border` | `#c7ccc7` | `#d9dad5` |
| `--border-subtle` | `#dadedb` | `#e6e6e1` |
| `--fg` | `#20242a` | `#17181c` |
| `--fg-dim` | `#5c6268` | `#5f6066` |
| `--fg-faint` | `#8b9094` | `#9b9c99` |
| `--fg-bright` | `#0b0d0f` | `#000000` |
| `--accent` | `#55677a` | `#6c38e8` |
| `--accent-wash` | `rgba(85, 103, 122, 0.09)` | `rgba(108, 56, 232, 0.08)` |
| `--list-hover` | `#e3e6e2` | `#eeeeec` |
| `--list-active` | `rgba(85, 103, 122, 0.07)` | `rgba(108, 56, 232, 0.09)` |
| `--input-bg` | `#fbfcfb` | `#ffffff` |
| `--button-bg` | `#55677a` | `#6c38e8` |
| `--button-hover` | `#44525f` | `#5b2ad1` |

**Dark (`:root[data-theme='dark']`):**
| Token | New value | Was |
|---|---|---|
| `--bg` | `#0d0f10` | `#010409` |
| `--sheet-bg` | `#141718` | `#0d1117` |
| `--activitybar-bg` | `#141718` | `#0d1117` |
| `--activitybar-fg` | `#6b7072` | `#6e7681` |
| `--activitybar-fg-active` | `#9fb3c4` | `#58a6ff` |
| `--sidebar-bg` | `#141718` | `#0d1117` |
| `--sidebar-header-fg` | `#6b7072` | `#6e7681` |
| `--editor-bg` | `#0d0f10` | `#010409` |
| `--titlebar-bg` | `#141718` | `#010409` |
| `--statusbar-bg` | `#141718` | `#0d1117` |
| `--statusbar-fg` | `#a9adaf` | `#8b949e` |
| `--border` | `#383d40` | `#3d444d` |
| `--border-subtle` | `#2a2e30` | `#21262d` |
| `--fg` | `#eef0f1` | `#f0f6fc` |
| `--fg-dim` | `#a9adaf` | `#9198a1` |
| `--fg-faint` | `#6b7072` | `#6e7681` |
| `--fg-bright` | `#ffffff` | `#ffffff` (unchanged) |
| `--accent` | `#9fb3c4` | `#58a6ff` |
| `--accent-wash` | `rgba(159, 179, 196, 0.14)` | `rgba(88, 166, 255, 0.12)` |
| `--list-hover` | `#1a1e1f` | `#161b22` |
| `--list-active` | `rgba(159, 179, 196, 0.1)` | `rgba(88, 166, 255, 0.15)` |
| `--input-bg` | `#191c1e` | `#0d1117` |
| `--button-bg` | `#9fb3c4` | `#1f6feb` |
| `--button-hover` | `#b5c6d3` | `#388bfd` |

Note: `--button-bg`/`--button-hover` in dark mode are now a *light* accent on
a dark surface (Moonstone reads best light-on-dark), so button text color
needs to flip to a dark ink (`#0c1116`) wherever `--button-bg` is used as a
background — check `.btn-primary`-equivalent rules in `theme.css` for a
hardcoded white text color that would now be illegible.

## Shape language (applies to ALL themes, including Dracula/Nord/high-contrast)

Two new tokens in the base `:root` block (not per-theme):

```css
--radius: 9px;
--radius-sm: 6px;
```

Softened per explicit "too rigid" feedback — not the sharp 2px corners from
the first Ledger pass. Sweep `theme.css` and repoint hardcoded radii that
belong to this "card/control" family onto these tokens: buttons, popovers,
input/composer fields, session-list rows, tab corners, model-picker options,
context-usage/session-stats/tools popovers, skill-picker menu. **Leave
existing `999px` pill shapes alone** (tab bookmark/close, badges, the
reasoning-slider track/segments, the provider status pip) — those are
deliberate pill accents, not part of the corner-softening pass, and were
kept as pills through both approved catalog rounds.

Also soften shadow weight app-wide on floating surfaces (popovers, menus):
reduce opacity/spread on the heaviest `box-shadow` rules by roughly the same
proportion as the catalog's frame shadow (`0 12px 32px -18px rgba(0,0,0,0.35)`
→ `0 16px 40px -22px rgba(0,0,0,0.22)`) — lighter, more spread, less harsh.

## Component notes (from the approved catalog mockup)

- **Tabs**: unchanged structure/behavior (active tab = accent underline via
  `box-shadow: inset 0 -2px 0 var(--accent)`), just the new mono font,
  softened corner radius, and new colors.
- **Sidebar session rows**: unchanged structure; timestamps in
  `--font-mono`, title text in `--font-ui` (Newsreader).
- **Chat bubbles**: user bubble (`.turn-bubble`, `theme.css:852`) keeps its
  current structure — `background: var(--list-active)`, `color: var(--fg)`,
  `border-radius: 10px` — just repoint that radius to `var(--radius)` and it
  inherits the new Moonstone-tinted wash and softened ink automatically via
  the token changes above. No inverted/chip treatment; that was a mockup
  simplification, not a real requirement. Assistant reply text is plain
  Newsreader; no bubble chrome (matches current behavior).
- **Timeline (thinking/tool chain)**: keep the existing vertical connector
  line + small round node per row (this is the Ledger direction — circle
  nodes, not the diamond/rotated-square nodes shown in the rejected Circuit
  Trace direction). Thinking rows stay italic Newsreader; tool rows stay
  `--font-mono`.
- **Reasoning slider**: no structural change from the already-shipped
  segmented-pill design (`ThinkingSlider` component, `.thinking-slider-*`
  classes) — it picks up the new accent, mono font, and radius tokens
  automatically since it already uses those variables.
- **Composer**: icon buttons, model badge, and send button pick up the new
  radius/accent automatically; no structural change.
- **Popovers** (context usage, session stats, tools, model picker): new
  radius/shadow per Shape language section above; internal data rows stay
  `--font-mono`, headings move to `--font-ui` (Newsreader).

## Non-goals / explicitly deferred

- No new app icon, favicon, or wordmark in this pass.
- No changes to Dracula/Nord/high-contrast color values.
- No changes to the OTel/session/backend logic — this is a pure `theme.css`
  + `src/renderer/index.html` (font link) + any hardcoded-radius call sites
  in component CSS pass.
