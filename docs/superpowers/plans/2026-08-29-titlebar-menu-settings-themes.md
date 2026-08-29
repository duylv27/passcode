# Custom Title Bar, Hamburger Menu, Settings Modal & Theme Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native OS window frame with a custom title bar (hamburger menu + drag region + custom window controls), convert Settings from an embedded panel into a left-nav modal with a status-dot provider display, and add three new selectable themes (Dracula, Nord, High Contrast) alongside the existing Light/Dark/System.

**Architecture:** Main-process `frame: false` plus new `window:*`/`app:getVersion` IPC channels drive a renderer `TitleBar` component (drag region, hamburger dropdown, window controls). `App.tsx` drops its now-fully-native `activity` state (Settings stops being an "activity" and becomes an overlay) and gains a `settingsOpen` boolean rendering a new `SettingsModal` wrapper around a restructured `SettingsPanel` (adds an internal left-nav over its three existing groups). `theme.css` gains three new `:root[data-theme='…']` token blocks; `useTheme.ts`'s type widens to match.

**Tech Stack:** React 18, TypeScript, Electron IPC (existing `contextBridge`/`ipcMain.handle` pattern).

## Global Constraints

- No automated tests for this feature. Consistent with every other renderer-UI component in this project (no jsdom, no component tests for `SettingsPanel.tsx`/`ChatPanel.tsx`/etc.). Verification is `npm run build` per task, plus a dedicated manual-verification task at the end (this one needs more manual checking than most — frameless-window drag regions are fiddly).
- Follow existing conventions exactly:
  - Icons: `src/renderer/src/components/icons.tsx`, `{ className }: IconProps` returning inline SVG, `viewBox="0 0 16 16"`, matching the existing line-icon (`stroke="currentColor"`) or filled (`fill="currentColor"`) styles already in the file.
  - IPC: one `ipcMain.handle('namespace:verb', ...)` per action in `src/main/ipc/register.ts`, mirrored by one `ipcRenderer.invoke(...)` per action in `src/preload/index.ts`'s `api` object, typed on `Api` in `src/shared/types.ts`. Event push channels (main → renderer) use `ipcRenderer.on`/`removeListener` returning an unsubscribe function, per the existing `session:event`/`approvals:request`/`settings:copilotChallenge` pattern.
  - CSS tokens: `var(--...)` from the token list in `theme.css`'s `:root` block; new theme blocks must define the exact same token set as the existing `:root[data-theme='dark']` block (`--bg`, `--sheet-bg`, `--activitybar-bg`, `--activitybar-fg`, `--activitybar-fg-active`, `--sidebar-bg`, `--sidebar-header-fg`, `--editor-bg`, `--titlebar-bg`, `--statusbar-bg`, `--statusbar-fg`, `--border`, `--border-subtle`, `--fg`, `--fg-dim`, `--fg-faint`, `--fg-bright`, `--accent`, `--accent-wash`, `--list-hover`, `--list-active`, `--input-bg`, `--button-bg`, `--button-hover`, `--success`, `--danger`) — no partial theme blocks.
  - Overlay/modal chrome: `position: fixed; inset: 0` backdrop + centered card, matching `.approval-overlay`/`.approval-dialog` and `.zoom-viewer-overlay`/`.zoom-viewer-content`.
  - Dropdown menus: matching `.model-picker-menu`/`.model-picker-option` (absolute-positioned card, click-outside-to-close via a `mousedown` listener on `document` checking a `ref.current.contains(e.target)` guard, exact pattern already in `ChatPanel.tsx`).
- Out of scope (do not touch): the "manual approval doesn't prompt" bug (Permissions section keeps its current logic, only its visual location moves), session tabs moving into the title bar (they stay in the editor area, unchanged), macOS-specific frameless handling (best-effort only, not verified), real global keyboard accelerators for menu items (labels are cosmetic in this plan).
- All new/modified `.ts`/`.tsx` files must type-check cleanly under this project's strict `tsconfig.web.json`/`tsconfig.node.json` (no implicit `any`, no unused locals) — verified via `npm run build`, which runs both.

---

### Task 1: Window control IPC (main process)

**Files:**
- Create: `src/main/ipc/windowHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Produces: `Api.window.{minimize, toggleMaximize, close, isMaximized, onMaximizeChange}` and `Api.app.getVersion` on `window.api`, callable from any renderer component in later tasks.

- [ ] **Step 1: Add the window/app namespaces to the `Api` type**

In `src/shared/types.ts`, add after the existing `approvals` block (the last property before the closing `}` of `Api`):

```ts
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizeChange(listener: (maximized: boolean) => void): () => void
  }
  app: {
    getVersion(): Promise<string>
  }
```

- [ ] **Step 2: Create the window handlers module**

Create `src/main/ipc/windowHandlers.ts`:

```ts
import type { BrowserWindow } from 'electron'

export interface WindowHandlers {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): boolean
}

// Takes a getter rather than the BrowserWindow directly -- main/index.ts
// reassigns its window reference on 'activate' (e.g. after the last window
// closes on non-mac and a new one is created), so handlers must always
// resolve the *current* window, not the one that existed when they were
// constructed.
export function createWindowHandlers(getWindow: () => BrowserWindow): WindowHandlers {
  return {
    minimize() {
      getWindow().minimize()
    },
    toggleMaximize() {
      const win = getWindow()
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    },
    close() {
      getWindow().close()
    },
    isMaximized() {
      return getWindow().isMaximized()
    }
  }
}
```

- [ ] **Step 3: Register the IPC channels**

In `src/main/ipc/register.ts`, add the import:

```ts
import { app, ipcMain } from 'electron'
```

(replacing the existing `import { ipcMain } from 'electron'` line)

Add to the `IpcHandlers` interface:

```ts
export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
  settings: SettingsHandlers
  models: ModelsHandlers
  skills: SkillsHandlers
  files: FilesHandlers
  approvals: ApprovalHandlers
  window: WindowHandlers
}
```

Add the import for `WindowHandlers` at the top alongside the other handler type imports:

```ts
import type { WindowHandlers } from './windowHandlers'
```

At the end of `registerIpcHandlers`, before the function's closing `}`, add:

```ts
  ipcMain.handle('window:minimize', () => handlers.window.minimize())
  ipcMain.handle('window:toggleMaximize', () => handlers.window.toggleMaximize())
  ipcMain.handle('window:close', () => handlers.window.close())
  ipcMain.handle('window:isMaximized', () => handlers.window.isMaximized())

  ipcMain.handle('app:getVersion', () => app.getVersion())
```

- [ ] **Step 4: Wire it up in main/index.ts**

In `src/main/index.ts`, add the import:

```ts
import { createWindowHandlers } from './ipc/windowHandlers'
```

Find `let mainWindow = createWindow()` inside `app.whenReady().then(...)` and, immediately after it, add the maximize/unmaximize event forwarding (the renderer's title bar needs to know real window state, e.g. after a double-click-title-bar maximize or an OS-level resize, not just clicks on its own buttons):

```ts
  let mainWindow = createWindow()
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizeChanged', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizeChanged', false))
```

In the `registerIpcHandlers({...})` call, add the new `window` entry alongside the existing ones (e.g. after `approvals: approvalHandlers`):

```ts
    approvals: approvalHandlers,
    window: createWindowHandlers(() => mainWindow)
```

Finally, in `createWindow()`'s `new BrowserWindow({...})` call, add `frame: false` as the first property:

```ts
  const win = new BrowserWindow({
    frame: false,
    width: 1200,
    height: 800,
```

- [ ] **Step 5: Expose it in the preload script**

In `src/preload/index.ts`, add to the `api` object, after the existing `approvals` block:

```ts
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (listener) => {
      const wrapped = (_e: unknown, maximized: boolean): void => listener(maximized)
      ipcRenderer.on('window:maximizeChanged', wrapped)
      return () => ipcRenderer.removeListener('window:maximizeChanged', wrapped)
    }
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
```

- [ ] **Step 6: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors. (Nothing in the renderer calls these yet, so this only confirms the main/preload/shared plumbing compiles.)

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/windowHandlers.ts src/main/ipc/register.ts src/main/index.ts src/preload/index.ts src/shared/types.ts
git commit -m "Add window control and app-version IPC channels"
```

---

### Task 2: TitleBar component shell (drag region + window controls, no menu content yet)

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`
- Create: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.window.*` (Task 1).
- Produces: `TitleBar({ onOpenMenu }: { onOpenMenu?: () => void }): JSX.Element` — a minimal shell for now (hamburger button that just calls `onOpenMenu` if given, drag region, working minimize/maximize/close buttons). Task 3 fills in the actual dropdown; this task proves the chrome and window-control wiring work first.

- [ ] **Step 1: Add the four new icons**

Append to `src/renderer/src/components/icons.tsx`:

```tsx
export function MenuIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />
    </svg>
  )
}

export function MinimizeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M3 12h10" strokeLinecap="round" />
    </svg>
  )
}

export function MaximizeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />
    </svg>
  )
}

export function RestoreIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5.5" y="2.5" width="7" height="7" rx="0.5" />
      <path d="M3.5 5.5v7a1 1 0 0 0 1 1h7" />
    </svg>
  )
}
```

(`CloseIcon` already exists, added for the zoom viewer feature — reuse it for the window close button.)

- [ ] **Step 2: Create the TitleBar shell**

Create `src/renderer/src/components/TitleBar.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { CloseIcon, MaximizeIcon, MenuIcon, MinimizeIcon, RestoreIcon } from './icons'

interface Props {
  onOpenMenu?: () => void
  menuButtonRef?: (el: HTMLButtonElement | null) => void
}

export function TitleBar({ onOpenMenu, menuButtonRef }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  return (
    <div className="titlebar">
      <button className="titlebar-btn" ref={menuButtonRef} onClick={onOpenMenu} title="Menu">
        <MenuIcon />
      </button>
      <div className="titlebar-drag" />
      <div className="titlebar-winctrls">
        <button className="titlebar-winbtn" onClick={() => window.api.window.minimize()} title="Minimize">
          <MinimizeIcon />
        </button>
        <button className="titlebar-winbtn" onClick={() => window.api.window.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="titlebar-winbtn is-close" onClick={() => window.api.window.close()} title="Close">
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Style the title bar**

Append to `src/renderer/src/theme.css`:

```css
/* ---------------------------------------------------------------------
   Title bar -- replaces the native OS window frame (frame: false).
   --------------------------------------------------------------------- */
.titlebar {
  display: flex;
  align-items: center;
  height: 36px;
  flex-shrink: 0;
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--border);
  padding: 0 4px;
  -webkit-app-region: drag;
}

.titlebar-btn {
  -webkit-app-region: no-drag;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--fg-dim);
}

.titlebar-btn:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.titlebar-drag {
  flex: 1;
  height: 100%;
}

.titlebar-winctrls {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: stretch;
  height: 100%;
}

.titlebar-winbtn {
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--fg-dim);
}

.titlebar-winbtn:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.titlebar-winbtn.is-close:hover {
  background: var(--danger);
  color: #ffffff;
}
```

- [ ] **Step 4: Mount it (temporarily, without menu wiring) to verify the shell works**

In `src/renderer/src/App.tsx`, add the import:

```tsx
import { TitleBar } from './components/TitleBar'
```

Find the top of the returned JSX:

```tsx
  return (
    <div className="app-shell">
      <div className="workbench">
```

Replace with:

```tsx
  return (
    <div className="app-shell">
      <TitleBar />
      <div className="workbench">
```

This is intentionally a temporary, no-op-menu mount just to verify the chrome and window controls work end-to-end before Task 3 adds the dropdown and Task 5 wires `onOpenMenu` for real. Do not wire `onOpenMenu` yet.

- [ ] **Step 5: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/icons.tsx src/renderer/src/components/TitleBar.tsx src/renderer/src/theme.css src/renderer/src/App.tsx
git commit -m "Add frameless title bar shell with working minimize/maximize/close"
```

---

### Task 3: Hamburger dropdown menu (content + click-outside, actions stubbed)

**Files:**
- Modify: `src/renderer/src/components/TitleBar.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Produces: `TitleBar` grows a `menuActions` prop — an object of callbacks the dropdown's items call — so Task 5 (App.tsx wiring) can supply the real app behavior without this task needing to know App.tsx's internals. Each callback is optional; a missing one just disables/hides that item.

```ts
export interface TitleBarMenuActions {
  newSession?: () => void
  closeTab?: () => void
  quit?: () => void
  toggleSidebar?: () => void
  goExplorer?: () => void
  goSettings?: () => void
  nextTab?: () => void
  previousTab?: () => void
  showAbout?: () => void
}
```

- [ ] **Step 1: Rewrite TitleBar.tsx with the dropdown**

Replace the full contents of `src/renderer/src/components/TitleBar.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import { CloseIcon, MaximizeIcon, MenuIcon, MinimizeIcon, RestoreIcon } from './icons'

export interface TitleBarMenuActions {
  newSession?: () => void
  closeTab?: () => void
  quit?: () => void
  toggleSidebar?: () => void
  goExplorer?: () => void
  goSettings?: () => void
  nextTab?: () => void
  previousTab?: () => void
  showAbout?: () => void
}

interface MenuItem {
  label: string
  kbd?: string
  action?: () => void
}

function buildMenu(actions: TitleBarMenuActions): { category: string; items: MenuItem[] }[] {
  return [
    {
      category: 'File',
      items: [
        { label: 'New Session', kbd: 'Ctrl+N', action: actions.newSession },
        { label: 'Close Tab', kbd: 'Ctrl+W', action: actions.closeTab },
        { label: 'Quit', kbd: 'Alt+F4', action: actions.quit }
      ]
    },
    {
      category: 'View',
      items: [{ label: 'Toggle Sidebar', kbd: 'Ctrl+B', action: actions.toggleSidebar }]
    },
    {
      category: 'Go',
      items: [
        { label: 'Explorer', action: actions.goExplorer },
        { label: 'Settings', action: actions.goSettings },
        { label: 'Next Tab', kbd: 'Ctrl+Tab', action: actions.nextTab },
        { label: 'Previous Tab', kbd: 'Ctrl+Shift+Tab', action: actions.previousTab }
      ]
    },
    {
      category: 'Window',
      items: [
        { label: 'Minimize', action: () => window.api.window.minimize() },
        { label: 'Maximize/Restore', action: () => window.api.window.toggleMaximize() },
        { label: 'Close', action: () => window.api.window.close() }
      ]
    },
    {
      category: 'Help',
      items: [{ label: 'About PassCode', action: actions.showAbout }]
    }
  ]
}

interface Props {
  menuActions: TitleBarMenuActions
}

export function TitleBar({ menuActions }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    return window.api.window.onMaximizeChange(setMaximized)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function runAction(action?: () => void): void {
    setMenuOpen(false)
    action?.()
  }

  return (
    <div className="titlebar">
      <div className="titlebar-menu" ref={menuRef}>
        <button className="titlebar-btn" onClick={() => setMenuOpen((v) => !v)} title="Menu">
          <MenuIcon />
        </button>
        {menuOpen && (
          <div className="titlebar-menu-dropdown" role="menu">
            {buildMenu(menuActions).map((group) => (
              <div key={group.category} className="titlebar-menu-group">
                <div className="titlebar-menu-category">{group.category}</div>
                {group.items.map((item) => (
                  <button
                    key={item.label}
                    className="titlebar-menu-item"
                    disabled={!item.action}
                    onClick={() => runAction(item.action)}
                  >
                    <span>{item.label}</span>
                    {item.kbd && <span className="titlebar-menu-kbd">{item.kbd}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-winctrls">
        <button className="titlebar-winbtn" onClick={() => window.api.window.minimize()} title="Minimize">
          <MinimizeIcon />
        </button>
        <button className="titlebar-winbtn" onClick={() => window.api.window.toggleMaximize()} title={maximized ? 'Restore' : 'Maximize'}>
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button className="titlebar-winbtn is-close" onClick={() => window.api.window.close()} title="Close">
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Style the dropdown**

Append to `src/renderer/src/theme.css`:

```css
.titlebar-menu {
  position: relative;
  -webkit-app-region: no-drag;
}

.titlebar-menu-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 4px;
  min-width: 220px;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  padding: 6px;
  z-index: 200;
}

.titlebar-menu-group + .titlebar-menu-group {
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--border-subtle);
}

.titlebar-menu-category {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--fg-faint);
  padding: 4px 8px 2px;
}

.titlebar-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--fg);
  font-size: 12.5px;
  padding: 6px 8px;
}

.titlebar-menu-item:hover:not(:disabled) {
  background: var(--list-hover);
}

.titlebar-menu-item:disabled {
  color: var(--fg-faint);
  cursor: default;
}

.titlebar-menu-kbd {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-faint);
}
```

- [ ] **Step 3: Update the App.tsx mount to pass an empty actions object (real wiring is Task 5)**

In `src/renderer/src/App.tsx`, find:

```tsx
      <TitleBar />
```

Replace with:

```tsx
      <TitleBar menuActions={{}} />
```

- [ ] **Step 4: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors. Every menu item will render disabled (grayed out, per `disabled={!item.action}`) except Window's three items, which are wired directly since they don't need App.tsx state — this is expected at this point in the plan.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/TitleBar.tsx src/renderer/src/theme.css src/renderer/src/App.tsx
git commit -m "Add hamburger dropdown menu content (File/View/Go/Window/Help)"
```

---

### Task 4: About dialog

**Files:**
- Create: `src/renderer/src/components/AboutDialog.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.app.getVersion()` (Task 1).
- Produces: `AboutDialog({ onClose }: { onClose: () => void }): JSX.Element` — a small centered dialog, shown when the Help > About PassCode menu item fires (wired in Task 5).

- [ ] **Step 1: Create the dialog**

Create `src/renderer/src/components/AboutDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { LogoIcon } from './icons'

export function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [])

  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-dialog" onClick={(e) => e.stopPropagation()}>
        <LogoIcon className="about-logo" />
        <div className="about-name">PassCode</div>
        <div className="about-version">{version ? `Version ${version}` : 'Loading version…'}</div>
        <button className="about-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Style it**

Append to `src/renderer/src/theme.css`:

```css
.about-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 210;
}

.about-dialog {
  width: 260px;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--space-4);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--space-1);
}

.about-logo {
  width: 40px;
  height: 40px;
  color: var(--accent);
  margin-bottom: var(--space-2);
}

.about-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--fg);
}

.about-version {
  font-size: 12px;
  color: var(--fg-dim);
  margin-bottom: var(--space-3);
}

.about-close {
  width: 100%;
  padding: 7px 0;
  background: var(--button-bg);
  border: none;
  border-radius: 6px;
  color: #ffffff;
  font-size: 12.5px;
}

.about-close:hover {
  background: var(--button-hover);
}
```

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors. (Not mounted anywhere yet — Task 5 wires it up.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/AboutDialog.tsx src/renderer/src/theme.css
git commit -m "Add About dialog"
```

---

### Task 5: Wire the menu into App.tsx (real actions, drop the now-dead `activity` state)

**Files:**
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `TitleBarMenuActions` (Task 3), `AboutDialog` (Task 4).
- Produces: `App.tsx` gains `settingsOpen: boolean` state (Task 6 renders `SettingsModal` from it) and `aboutOpen: boolean` state.

- [ ] **Step 1: Read the current file, then apply these changes**

Read `src/renderer/src/App.tsx` in full first — this task touches many parts of it (imports, state, handlers, the activity bar's gear button, the sidebar's render condition, and the JSX bottom). The line numbers below match the file as of Task 2/3's edits (only `TitleBar`'s import and mount line changed since); re-locate each snippet by content if line numbers have drifted.

Replace the imports block:

```tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../shared/types'
import { RepoSwitcher, type Scope } from './components/RepoSwitcher'
import { SessionList } from './components/SessionList'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'

type Activity = 'explorer' | 'settings'
```

with:

```tsx
import { useEffect, useState } from 'react'
import type { Project, Repo, SessionRecord } from '../../shared/types'
import { RepoSwitcher, type Scope } from './components/RepoSwitcher'
import { SessionList } from './components/SessionList'
import { SessionTabs } from './components/SessionTabs'
import { ChatPanel } from './components/ChatPanel'
import { SettingsPanel } from './components/SettingsPanel'
import { ApprovalDialog } from './components/ApprovalDialog'
import { TitleBar } from './components/TitleBar'
import { AboutDialog } from './components/AboutDialog'
import { ExplorerIcon, GearIcon, LogoIcon } from './components/icons'
```

(`Activity` type is removed — Settings is no longer an "activity", see below.)

Replace the component's state declarations:

```tsx
  const [scope, setScope] = useState<Scope | null>(null)
  const [openSessions, setOpenSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)
  const [activity, setActivity] = useState<Activity>('explorer')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  function handleExplorerClick(): void {
    if (activity === 'explorer') {
      setSidebarCollapsed((collapsed) => !collapsed)
    } else {
      setActivity('explorer')
      setSidebarCollapsed(false)
    }
  }
```

with:

```tsx
  const [scope, setScope] = useState<Scope | null>(null)
  const [openSessions, setOpenSessions] = useState<SessionRecord[]>([])
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  // Bumped to force SessionList to refetch after a session is created from
  // outside its own "+ New session" button (the hamburger menu) -- SessionList
  // owns its own fetched list and has no other way to learn about that.
  const [sessionListRefreshKey, setSessionListRefreshKey] = useState(0)

  function handleExplorerClick(): void {
    setSidebarCollapsed((collapsed) => !collapsed)
  }
```

(Settings used to be a second `activity` value that swapped the editor-area content; it's now an independent overlay (`settingsOpen`), so `activity` had only one real value left (`'explorer'`) and its own conditionals were dead weight -- removed along with the `Activity` type.)

- [ ] **Step 2: Add the menu-action handlers**

After the existing `handleSessionRenamed` function (and before the `const sessionsInScope = ...` line), add:

```tsx
  async function handleCreateSessionFromMenu(): Promise<void> {
    if (!scope) return
    if (scope.kind === 'repo') {
      const created = await window.api.session.create(scope.repo.id)
      handleOpenSession(created, scope)
    } else {
      const result = await window.api.session.createProjectSession(scope.project.id)
      if (result.ok) handleOpenSession(result.session, scope)
    }
    setSessionListRefreshKey((k) => k + 1)
  }

  function handleCloseTabFromMenu(): void {
    if (selectedSession) handleCloseTab(selectedSession)
  }

  function cycleTab(direction: 1 | -1): void {
    if (sessionsInScope.length === 0) return
    const currentIndex = selectedSession ? sessionsInScope.findIndex((s) => s.id === selectedSession.id) : -1
    const nextIndex = (currentIndex + direction + sessionsInScope.length) % sessionsInScope.length
    setSelectedSession(sessionsInScope[nextIndex])
  }
```

Note: `sessionsInScope` is defined a few lines below where this is inserted (`const sessionsInScope = scope ? openSessions.filter(...) : []`). Move that `const sessionsInScope = ...` line (and the `scopeName` line right after it) to *before* this new block instead, so `cycleTab` can reference it without a forward-reference issue. The simplest way: cut the existing

```tsx
  const sessionsInScope = scope ? openSessions.filter((s) => sessionMatchesScope(s, scope)) : []
  const scopeName = scope ? (scope.kind === 'project' ? `${scope.project.name} (project)` : scope.repo.name) : null
```

from its current location (right before `return (`) and paste it immediately after `handleSessionRenamed`'s closing `}`, then add the three new functions above after that.

- [ ] **Step 3: Mount TitleBar with real actions, and the modals**

Find:

```tsx
      <TitleBar menuActions={{}} />
```

Replace with:

```tsx
      <TitleBar
        menuActions={{
          newSession: scope ? handleCreateSessionFromMenu : undefined,
          closeTab: selectedSession ? handleCloseTabFromMenu : undefined,
          quit: () => window.api.window.close(),
          toggleSidebar: handleExplorerClick,
          goExplorer: () => setSidebarCollapsed(false),
          goSettings: () => setSettingsOpen(true),
          nextTab: sessionsInScope.length > 0 ? () => cycleTab(1) : undefined,
          previousTab: sessionsInScope.length > 0 ? () => cycleTab(-1) : undefined,
          showAbout: () => setAboutOpen(true)
        }}
      />
```

(`quit` closes the single window rather than calling a separate `app.quit()` IPC channel -- this app has no secondary windows, and `window-all-closed` in `main/index.ts` already calls `app.quit()` on non-mac, so closing the window is equivalent and avoids adding a redundant IPC channel.)

- [ ] **Step 4: Fix the gear icon and sidebar/settings rendering**

Find:

```tsx
          <button
            className={`activitybar-icon${activity === 'explorer' && !sidebarCollapsed ? ' is-active' : ''}`}
            onClick={handleExplorerClick}
            title={activity === 'explorer' && !sidebarCollapsed ? 'Hide Explorer' : 'Explorer'}
          >
            <ExplorerIcon />
          </button>
          <div className="activitybar-spacer" />
          <button
            className={`activitybar-icon${activity === 'settings' ? ' is-active' : ''}`}
            onClick={() => setActivity('settings')}
            title="Settings"
          >
            <GearIcon />
          </button>
```

Replace with:

```tsx
          <button
            className={`activitybar-icon${!sidebarCollapsed ? ' is-active' : ''}`}
            onClick={handleExplorerClick}
            title={!sidebarCollapsed ? 'Hide Explorer' : 'Explorer'}
          >
            <ExplorerIcon />
          </button>
          <div className="activitybar-spacer" />
          <button
            className={`activitybar-icon${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <GearIcon />
          </button>
```

Find:

```tsx
        {activity === 'explorer' && (
          <div className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
            <div className="sidebar-header">SESSIONS</div>
            <RepoSwitcher scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
            <div className="sidebar-scroll">
              {scope ? (
                <SessionList
                  scope={scope}
                  activeSessionId={selectedSession?.id}
                  onOpenSession={(session) => handleOpenSession(session, scope)}
                  onSessionDeleted={handleSessionDeleted}
                  onSessionRenamed={handleSessionRenamed}
                />
              ) : (
                <div className="sidebar-empty">Pick a repo or project above to see its sessions.</div>
              )}
            </div>
          </div>
        )}

        <div className="editor-area">
          {activity === 'settings' ? (
            <SettingsPanel />
          ) : scope ? (
```

Replace with:

```tsx
        <div className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`}>
          <div className="sidebar-header">SESSIONS</div>
          <RepoSwitcher scope={scope} onSelectRepo={handleSelectRepo} onSelectProject={handleSelectProject} />
          <div className="sidebar-scroll">
            {scope ? (
              <SessionList
                key={sessionListRefreshKey}
                scope={scope}
                activeSessionId={selectedSession?.id}
                onOpenSession={(session) => handleOpenSession(session, scope)}
                onSessionDeleted={handleSessionDeleted}
                onSessionRenamed={handleSessionRenamed}
              />
            ) : (
              <div className="sidebar-empty">Pick a repo or project above to see its sessions.</div>
            )}
          </div>
        </div>

        <div className="editor-area">
          {scope ? (
```

(`SettingsPanel` is no longer rendered inline here -- Task 6 renders it as a modal, mounted separately below.)

- [ ] **Step 5: Mount the modals at the bottom**

Find:

```tsx
      <ApprovalDialog />
    </div>
  )
}
```

Replace with:

```tsx
      <ApprovalDialog />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}
```

(`SettingsPanel` gaining an `onClose` prop and rendering as its own overlay, rather than a separate `SettingsModal` wrapper component, is Task 6's job -- this task just changes the call site to expect that shape.)

- [ ] **Step 6: Verify the build type-checks**

Run: `npm run build`

Expected: this will **fail** at this point, because `SettingsPanel` doesn't accept an `onClose` prop yet (that's Task 6) -- confirm the only error reported is about `SettingsPanel`'s props (e.g. `Property 'onClose' does not exist on type ...` or similar), not anything else in this file. Do not attempt to fix `SettingsPanel` in this task; that's Task 6's job. If you see *other* errors (not about `SettingsPanel`'s missing prop), stop and report them -- something else is wrong with this task's edit.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "Wire hamburger menu actions and drop the now-dead activity state"
```

Note in your report that `npm run build` fails with exactly one expected error class (missing `onClose` on `SettingsPanel`), and quote the exact error text -- the task reviewer needs this to confirm it's the *expected* failure, not a different bug.

---

### Task 6: Settings modal (left-nav + status-dot providers)

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: `SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element` -- resolves Task 5's build failure.

- [ ] **Step 1: Restructure SettingsPanel.tsx**

Read the current `src/renderer/src/components/SettingsPanel.tsx` in full (unchanged since the start of this plan). Replace its entire contents with:

```tsx
import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge, ToolApprovalPolicy } from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { useTheme, type ThemePreference } from '../hooks/useTheme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'system', label: 'System' }
]

const TOOL_LABELS: Record<(typeof KNOWN_TOOL_NAMES)[number], string> = {
  read: 'Read',
  grep: 'Grep',
  find: 'Find',
  ls: 'List directory',
  bash: 'Bash',
  powershell: 'PowerShell',
  edit: 'Edit',
  write: 'Write'
}

type Section = 'general' | 'providers' | 'permissions'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Providers' },
  { value: 'permissions', label: 'Permissions' }
]

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}

function StatusDot({ connected }: { connected: boolean }): JSX.Element {
  return <span className={`provider-dot${connected ? ' is-connected' : ''}`} title={connected ? 'Connected' : 'Not connected'} />
}

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('general')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [anthropicError, setAnthropicError] = useState<string | null>(null)
  const [copilotError, setCopilotError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)
  const [theme, setTheme] = useTheme()

  async function refresh(): Promise<void> {
    setStatus(await window.api.settings.getAuthStatus())
  }

  useEffect(() => {
    refresh()
    window.api.approvals.getPolicy().then(setPolicy)
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    return unsubscribe
  }, [])

  async function toggleAutoApprove(toolName: string): Promise<void> {
    if (!policy) return
    const next: ToolApprovalPolicy = {
      autoApprove: { ...policy.autoApprove, [toolName]: !policy.autoApprove[toolName] }
    }
    setPolicy(next)
    await window.api.approvals.setPolicy(next)
  }

  async function handleSaveKey(): Promise<void> {
    setAnthropicError(null)
    const result = await window.api.settings.setAnthropicApiKey(apiKey)
    if (!result.ok) {
      setAnthropicError(result.error)
      return
    }
    setApiKey('')
    await refresh()
  }

  async function handleCopilotLogin(): Promise<void> {
    setCopilotError(null)
    setLoggingIn(true)
    setChallenge(null)
    const result = await window.api.settings.loginCopilot()
    setLoggingIn(false)
    setChallenge(null)
    if (!result.ok) {
      setCopilotError(result.error)
      return
    }
    await refresh()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.value}
              className={`settings-nav-item${section === s.value ? ' is-active' : ''}`}
              onClick={() => setSection(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          <div className="settings-content-header">
            <h2 className="settings-light-title">{SECTIONS.find((s) => s.value === section)!.label}</h2>
            <button className="settings-close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>

          {section === 'general' && (
            <div className="settings-group">
              <div className="settings-row settings-row-theme">
                <div className="settings-row-text">
                  <span className="settings-row-title">Appearance</span>
                  <span className="settings-row-desc">Color scheme for the app window</span>
                </div>
              </div>
              <div className="theme-swatches">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`theme-swatch theme-swatch-${opt.value}${theme === opt.value ? ' is-selected' : ''}`}
                    onClick={() => setTheme(opt.value)}
                  >
                    <span className="theme-swatch-preview" />
                    <span className="theme-swatch-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {section === 'providers' && (
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    Anthropic API Key
                    <StatusDot connected={!!status?.anthropic} />
                  </span>
                  <span className="settings-row-desc">Used for direct Anthropic model access</span>
                  {anthropicError && <span className="settings-row-error">{anthropicError}</span>}
                </div>
                <div className="settings-row-control settings-key-control">
                  <input
                    className="settings-input"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveKey()
                    }}
                    placeholder="sk-ant-..."
                  />
                  <button className="settings-btn" onClick={handleSaveKey}>
                    Save
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    GitHub Copilot
                    <StatusDot connected={!!status?.copilot} />
                  </span>
                  <span className="settings-row-desc">Sign in with a device code</span>
                  {challenge && (
                    <span className="settings-row-hint">
                      Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
                    </span>
                  )}
                  {copilotError && <span className="settings-row-error">{copilotError}</span>}
                </div>
                {!status?.copilot && (
                  <div className="settings-row-control">
                    <button className="settings-btn" onClick={handleCopilotLogin} disabled={loggingIn}>
                      {loggingIn ? 'Signing in…' : 'Sign in'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'permissions' && (
            <div className="settings-group">
              {KNOWN_TOOL_NAMES.map((toolName) => {
                const requiresApproval = policy ? !policy.autoApprove[toolName] : false
                return (
                  <div key={toolName} className="settings-row">
                    <div className="settings-row-text">
                      <span className="settings-row-title">{TOOL_LABELS[toolName]}</span>
                      <span className="settings-row-desc">
                        {requiresApproval ? 'Pauses and asks before running' : 'Runs automatically'}
                      </span>
                    </div>
                    <div className="settings-row-control">
                      <Switch checked={requiresApproval} onChange={() => toggleAutoApprove(toolName)} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
```

This keeps every existing piece of state, IPC call, and business logic unchanged (per the spec's Non-goal: the approval-flow bug is not touched here) -- it only adds `section` state, the left-nav, the overlay wrapper, and swaps the "Connected" text for `StatusDot`. The theme options list grows from 3 to 6 to match Task 8's new `ThemePreference` type (this task references `'dracula' | 'nord' | 'high-contrast'` as values now, which don't exist on `ThemePreference` until Task 8 -- see the build-failure note in Step 3 below).

- [ ] **Step 2: Add the new CSS**

Append to `src/renderer/src/theme.css` (the `theme-swatch-*` background rules are placeholders here -- Task 8 fills in the real per-theme preview colors once those theme blocks exist; for now give them a neutral shared look so this task's build/visual check isn't blocked on Task 8):

```css
/* ---------------------------------------------------------------------
   Settings modal
   --------------------------------------------------------------------- */
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 150;
}

.settings-dialog {
  width: 640px;
  max-width: calc(100vw - 48px);
  height: 480px;
  max-height: calc(100vh - 48px);
  background: var(--sheet-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 170px;
  flex-shrink: 0;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
  padding: var(--space-3) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav-item {
  text-align: left;
  padding: 7px 10px;
  border-radius: 5px;
  background: transparent;
  border: none;
  color: var(--fg-dim);
  font-size: 13px;
}

.settings-nav-item:hover {
  background: var(--list-hover);
}

.settings-nav-item.is-active {
  background: var(--list-active);
  color: var(--fg);
  font-weight: 600;
}

.settings-content {
  flex: 1;
  padding: var(--space-4);
  overflow-y: auto;
}

.settings-content-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.settings-close {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: var(--fg-dim);
}

.settings-close:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.provider-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 8px;
  border: 1.5px solid var(--border);
  background: transparent;
  vertical-align: middle;
}

.provider-dot.is-connected {
  border-color: var(--success);
  background: var(--success);
}

.theme-swatches {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.theme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: var(--space-2);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
}

.theme-swatch.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.theme-swatch-preview {
  width: 100%;
  height: 32px;
  border-radius: 4px;
  background: var(--border-subtle);
}

.theme-swatch-label {
  font-size: 11.5px;
  color: var(--fg-dim);
}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`

Expected: this build will **also fail** -- `useTheme`'s `ThemePreference` type doesn't yet include `'dracula' | 'nord' | 'high-contrast'` (that's Task 8). Confirm the only error is about `THEME_OPTIONS`/`ThemePreference` type mismatch (e.g. `Type '"dracula"' is not assignable to type 'ThemePreference'`), not anything else. This resolves Task 5's `onClose` error from the previous task -- confirm that specific error is now gone.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/theme.css
git commit -m "Restructure Settings into a left-nav modal with status-dot providers"
```

Note in your report the exact remaining build error (about `ThemePreference`) and confirm it's the only one -- this is expected and resolved by Task 8, not this task.

---

### Task 7: Theme tokens (Dracula, Nord, High Contrast)

**Files:**
- Modify: `src/renderer/src/hooks/useTheme.ts`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Produces: `ThemePreference` widens to `'light' | 'dark' | 'dracula' | 'nord' | 'high-contrast' | 'system'` -- resolves Task 6's build failure.

- [ ] **Step 1: Widen ThemePreference and its resolution logic**

In `src/renderer/src/hooks/useTheme.ts`, replace:

```ts
export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'passcode-theme'

function applyTheme(pref: ThemePreference): void {
  const isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (isDark) {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}
```

with:

```ts
export type ThemePreference = 'light' | 'dark' | 'dracula' | 'nord' | 'high-contrast' | 'system'

const STORAGE_KEY = 'passcode-theme'

function applyTheme(pref: ThemePreference): void {
  if (pref === 'system') {
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    if (isDark) document.documentElement.setAttribute('data-theme', 'dark')
    else document.documentElement.removeAttribute('data-theme')
    return
  }
  if (pref === 'light') {
    document.documentElement.removeAttribute('data-theme')
    return
  }
  document.documentElement.setAttribute('data-theme', pref)
}
```

(`'light'` has no `data-theme` attribute at all, same as before -- it's the bare `:root` block. Every other explicit value sets `data-theme` to its own name, matching a new `:root[data-theme='...']` block below.)

- [ ] **Step 2: Add the three new theme blocks**

In `src/renderer/src/theme.css`, find the existing dark theme block:

```css
:root[data-theme='dark'] {
  color-scheme: dark;
  ...
  --danger: #f85149;
}
```

Immediately after its closing `}`, insert:

```css
/* Dracula -- https://draculatheme.com palette. */
:root[data-theme='dracula'] {
  color-scheme: dark;

  --bg: #282a36;
  --sheet-bg: #21222c;

  --activitybar-bg: #21222c;
  --activitybar-fg: #6272a4;
  --activitybar-fg-active: #ff79c6;
  --sidebar-bg: #21222c;
  --sidebar-header-fg: #6272a4;
  --editor-bg: #282a36;
  --titlebar-bg: #21222c;
  --statusbar-bg: #21222c;
  --statusbar-fg: #f8f8f2;
  --border: #44475a;
  --border-subtle: #383a4c;
  --fg: #f8f8f2;
  --fg-dim: #bfbfd4;
  --fg-faint: #6272a4;
  --fg-bright: #ffffff;
  --accent: #bd93f9;
  --accent-wash: rgba(189, 147, 249, 0.14);
  --list-hover: #2c2e3d;
  --list-active: rgba(189, 147, 249, 0.16);
  --input-bg: #21222c;
  --button-bg: #bd93f9;
  --button-hover: #a679f0;

  --success: #50fa7b;
  --danger: #ff5555;
}

/* Nord -- https://www.nordtheme.com palette. */
:root[data-theme='nord'] {
  color-scheme: dark;

  --bg: #2e3440;
  --sheet-bg: #3b4252;

  --activitybar-bg: #3b4252;
  --activitybar-fg: #81899b;
  --activitybar-fg-active: #88c0d0;
  --sidebar-bg: #3b4252;
  --sidebar-header-fg: #81899b;
  --editor-bg: #2e3440;
  --titlebar-bg: #3b4252;
  --statusbar-bg: #3b4252;
  --statusbar-fg: #e5e9f0;
  --border: #4c566a;
  --border-subtle: #434c5e;
  --fg: #eceff4;
  --fg-dim: #c4cad6;
  --fg-faint: #81899b;
  --fg-bright: #ffffff;
  --accent: #88c0d0;
  --accent-wash: rgba(136, 192, 208, 0.14);
  --list-hover: #414859;
  --list-active: rgba(136, 192, 208, 0.16);
  --input-bg: #3b4252;
  --button-bg: #5e81ac;
  --button-hover: #81a1c1;

  --success: #a3be8c;
  --danger: #bf616a;
}

/* High Contrast -- pure black, accessibility-focused. */
:root[data-theme='high-contrast'] {
  color-scheme: dark;

  --bg: #000000;
  --sheet-bg: #000000;

  --activitybar-bg: #000000;
  --activitybar-fg: #ffffff;
  --activitybar-fg-active: #ffff00;
  --sidebar-bg: #000000;
  --sidebar-header-fg: #ffffff;
  --editor-bg: #000000;
  --titlebar-bg: #000000;
  --statusbar-bg: #000000;
  --statusbar-fg: #ffffff;
  --border: #ffffff;
  --border-subtle: #6e6e6e;
  --fg: #ffffff;
  --fg-dim: #e0e0e0;
  --fg-faint: #a6a6a6;
  --fg-bright: #ffffff;
  --accent: #ffff00;
  --accent-wash: rgba(255, 255, 0, 0.16);
  --list-hover: #1a1a1a;
  --list-active: rgba(255, 255, 0, 0.2);
  --input-bg: #000000;
  --button-bg: #ffff00;
  --button-hover: #e6e600;

  --success: #00ff00;
  --danger: #ff3b3b;
}
```

(`--button-bg`/`--button-hover` on High Contrast use black-on-yellow via the button text color already being set elsewhere to a fixed `#ffffff` in some places, e.g. `.about-close` -- that's a known follow-up for High Contrast specifically, noted in this task's report, not blocking: white text on a yellow button fails contrast. Flag it; do not silently "fix" it by inventing a new token not in the constraint's exact list.)

- [ ] **Step 3: Fill in the real theme-swatch preview colors**

In `src/renderer/src/theme.css`, find the placeholder rule added in Task 6:

```css
.theme-swatch-preview {
  width: 100%;
  height: 32px;
  border-radius: 4px;
  background: var(--border-subtle);
}
```

Replace with:

```css
.theme-swatch-preview {
  width: 100%;
  height: 32px;
  border-radius: 4px;
  background: var(--border-subtle);
}

.theme-swatch-light .theme-swatch-preview { background: linear-gradient(135deg, #ffffff 50%, #6c38e8 50%); }
.theme-swatch-dark .theme-swatch-preview { background: linear-gradient(135deg, #010409 50%, #58a6ff 50%); }
.theme-swatch-dracula .theme-swatch-preview { background: linear-gradient(135deg, #282a36 50%, #bd93f9 50%); }
.theme-swatch-nord .theme-swatch-preview { background: linear-gradient(135deg, #2e3440 50%, #88c0d0 50%); }
.theme-swatch-high-contrast .theme-swatch-preview { background: linear-gradient(135deg, #000000 50%, #ffff00 50%); }
.theme-swatch-system .theme-swatch-preview { background: linear-gradient(135deg, #ffffff 50%, #010409 50%); }
```

(These are fixed hex pairs, not `var(--...)` tokens, deliberately -- each swatch previews a *specific* theme's colors regardless of which theme is currently active, so it can't reference the live `--bg`/`--accent` tokens, which always resolve to whatever theme is *currently* applied to `:root`.)

- [ ] **Step 4: Verify the build**

Run: `npm run build`

Expected: build completes with **no errors** now -- this resolves Task 6's `ThemePreference` type error, and no earlier task left any other error outstanding.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/hooks/useTheme.ts src/renderer/src/theme.css
git commit -m "Add Dracula, Nord, and High Contrast themes"
```

---

### Task 8: Manual verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: clean build, matching Task 7's final state.

- [ ] **Step 2: Ask the user to relaunch and verify by hand**

This feature touches window chrome (frameless drag regions are notoriously fiddly) and several interactive UI pieces with no automated coverage (per Global Constraints). Ask the user to fully quit and relaunch the app from this worktree, then check:

- The window has no native OS title bar; the custom one (hamburger + drag strip + minimize/maximize/close) renders instead.
- Dragging an empty part of the title bar moves the window; dragging the hamburger button or window-control buttons does *not* move the window (they should feel like normal buttons, not drag handles).
- Minimize, maximize/restore, and close all work from the custom buttons. Double-clicking the empty title bar area also maximizes/restores (native OS behavior for a drag region — if it doesn't, note it, but don't treat it as a hard requirement to fix in this pass).
- After maximizing via double-click (not the button), the title bar's own maximize button icon updates to the "restore" icon (proves `onMaximizeChange` wiring works, not just click-driven state).
- Hamburger menu opens on click, closes on an outside click, and every category (File/View/Go/Window/Help) shows its items; disabled items (e.g. New Session/Close Tab with nothing selected) render grayed out and don't respond to clicks.
- File > New Session creates a session (when a repo/project is selected) and it appears both as an open tab and in the sidebar list.
- Go > Next Tab / Previous Tab cycles through open tabs in the current scope, wrapping around at both ends.
- Help > About PassCode shows a dialog with the real app version (compare against `package.json`'s `"version"` field).
- Settings still opens from the gear icon, now as a centered modal with a left-nav (General/Providers/Permissions) instead of swapping the editor area.
- Settings > General shows all 6 theme swatches; clicking each one actually changes the app's colors, and the swatch's own preview colors stay correct regardless of which theme is currently active.
- Settings > Providers shows a status dot (not "Connected" text) next to Anthropic/Copilot; connecting a provider updates its dot without a page reload.
- Settings > Permissions still shows the per-tool switches, functionally unchanged from before this plan (the "manual doesn't prompt" bug, if present, should behave identically to before — not better, not worse).
- Closing Settings (✕ button or clicking the backdrop) returns to the normal chat view with no leftover overlay.

- [ ] **Step 3: Fix any issues found, then commit**

If verification finds a bug, fix it in the relevant file from Tasks 1-7, re-run `npm run build`, and commit the fix with a message describing what was wrong. Repeat until all checks in Step 2 pass.
