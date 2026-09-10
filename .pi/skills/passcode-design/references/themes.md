# PassCode Theme Tokens — Full Palette Reference

Source: `src/renderer/src/theme.css`, the `:root[data-theme='...']` blocks. Every theme defines the
same variable names; only values change (plus `color-scheme` and, in dark themes, whether
`--activitybar-fg-active` doubles as a second accent-ish color for the sidebar rail icon).

Applying a theme sets `data-theme` on `<html>`; there is no light-theme attribute (light is the
bare `:root` with no `data-theme`).

## Light ("Ledger", default)

```
color-scheme: light
--bg: #f4f5f3            --sheet-bg: #eceeea
--activitybar-bg: #eceeea        --activitybar-fg: #8b9094      --activitybar-fg-active: #55677a
--sidebar-bg: #eceeea            --sidebar-header-fg: #8b9094
--editor-bg: #f4f5f3
--titlebar-bg: #eceeea            --statusbar-bg: #eceeea        --statusbar-fg: #5c6268
--border: #c7ccc7                --border-subtle: #dadedb
--fg: #20242a  --fg-dim: #5c6268  --fg-faint: #8b9094  --fg-bright: #0b0d0f
--accent: #55677a                --accent-wash: rgba(85,103,122,.09)
--list-hover: #e3e6e2            --list-active: rgba(85,103,122,.07)
--input-bg: #fbfcfb
--button-bg: #55677a  --button-hover: #44525f  --button-fg: #ffffff
--success: #2e7d32  --danger: #c0392b  --warning: #a3690f
```

## Dark ("Ledger" dark — same shape, Moonstone accent light-on-dark)

```
color-scheme: dark
--bg: #0d0f10                    --sheet-bg: #141718
--activitybar-bg: #141718        --activitybar-fg: #6b7072      --activitybar-fg-active: #9fb3c4
--sidebar-bg: #141718            --sidebar-header-fg: #6b7072
--editor-bg: #0d0f10
--titlebar-bg: #141718           --statusbar-bg: #141718        --statusbar-fg: #a9adaf
--border: #383d40                --border-subtle: #2a2e30
--fg: #eef0f1  --fg-dim: #a9adaf  --fg-faint: #6b7072  --fg-bright: #ffffff
--accent: #9fb3c4                --accent-wash: rgba(159,179,196,.14)
--list-hover: #1a1e1f            --list-active: rgba(159,179,196,.1)
--input-bg: #191c1e
--button-bg: #9fb3c4  --button-hover: #b5c6d3  --button-fg: #0c1116
--success: #3fb950  --danger: #f85149  --warning: #d29922
```

## Dracula (draculatheme.com palette)

```
color-scheme: dark
--bg: #282a36                    --sheet-bg: #21222c
--activitybar-bg: #21222c        --activitybar-fg: #6272a4      --activitybar-fg-active: #ff79c6
--sidebar-bg: #21222c            --sidebar-header-fg: #6272a4
--editor-bg: #282a36
--titlebar-bg: #21222c           --statusbar-bg: #21222c        --statusbar-fg: #f8f8f2
--border: #44475a                --border-subtle: #383a4c
--fg: #f8f8f2  --fg-dim: #bfbfd4  --fg-faint: #6272a4  --fg-bright: #ffffff
--accent: #bd93f9                --accent-wash: rgba(189,147,249,.14)
--list-hover: #2c2e3d            --list-active: rgba(189,147,249,.16)
--input-bg: #21222c
--button-bg: #bd93f9  --button-hover: #a679f0  (--button-fg not overridden -- inherits light's #ffffff)
--success: #50fa7b  --danger: #ff5555  --warning: #ffb86c
```

## Nord (nordtheme.com palette)

```
color-scheme: dark
--bg: #2e3440                    --sheet-bg: #3b4252
--activitybar-bg: #3b4252        --activitybar-fg: #81899b      --activitybar-fg-active: #88c0d0
--sidebar-bg: #3b4252            --sidebar-header-fg: #81899b
--editor-bg: #2e3440
--titlebar-bg: #3b4252           --statusbar-bg: #3b4252        --statusbar-fg: #e5e9f0
--border: #4c566a                --border-subtle: #434c5e
--fg: #eceff4  --fg-dim: #c4cad6  --fg-faint: #81899b  --fg-bright: #ffffff
--accent: #88c0d0                --accent-wash: rgba(136,192,208,.14)
--list-hover: #414859             --list-active: rgba(136,192,208,.16)
--input-bg: #3b4252
--button-bg: #5e81ac  --button-hover: #81a1c1  (button-fg inherited)
--success: #a3be8c  --danger: #bf616a  --warning: #d08770
```

## High Contrast (pure black, accessibility)

```
color-scheme: dark
--bg: #000000                    --sheet-bg: #000000
--activitybar-bg: #000000        --activitybar-fg: #ffffff      --activitybar-fg-active: #ffff00
--sidebar-bg: #000000            --sidebar-header-fg: #ffffff
--editor-bg: #000000
--titlebar-bg: #000000           --statusbar-bg: #000000        --statusbar-fg: #ffffff
--border: #ffffff                --border-subtle: #6e6e6e
--fg: #ffffff  --fg-dim: #e0e0e0  --fg-faint: #a6a6a6  --fg-bright: #ffffff
--accent: #ffff00                --accent-wash: rgba(255,255,0,.16)
--list-hover: #1a1a1a            --list-active: rgba(255,255,0,.2)
--input-bg: #000000
--button-bg: #ffff00  --button-hover: #e6e600  (button-fg inherited)
--success: #00ff00  --danger: #ff3b3b  --warning: #ffcc00
```

## Theme-invariant tokens (same value in every theme)

```
--font-ui: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
--font-mono: 'IBM Plex Mono', Consolas, 'Cascadia Code', ui-monospace, monospace
--font-serif: same stack as --font-ui (no separate serif in this app despite the name)
--radius: 9px          --radius-sm: 6px
--space-1: 4px  --space-2: 8px  --space-3: 12px  --space-4: 16px

--titlebar-fixed-bg: #1e1f22            (the custom titlebar strip is dark in every theme,
--titlebar-fixed-border: #393b40         by deliberate design choice -- it does NOT follow
--titlebar-fixed-fg: #9da0a8             --titlebar-bg above)
--titlebar-fixed-fg-hover: #dfe1e5
--titlebar-fixed-hover-bg: #2b2d30
```

## Practical implications

- **Never assume the light-theme accent (`#55677a`, a muted blue-grey) reads well elsewhere** — dracula's accent is a saturated purple, nord's a cyan, high-contrast's a pure yellow. Always reference `var(--accent)`, never hardcode `#55677a` in real component CSS.
- **`--button-fg` is only explicitly set in light and dark** — dracula/nord/high-contrast inherit light's `#ffffff`, which happens to still contrast fine against their button-bg colors. If you introduce a new theme, don't forget to check this contrast explicitly rather than assuming inheritance is fine.
- **The titlebar is the one intentional exception to "everything follows the theme"** — it's always the same dark strip regardless of `data-theme`, per an explicit product decision (see the code comment in `theme.css` right above `--titlebar-fixed-bg`).
