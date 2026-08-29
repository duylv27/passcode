# Diagram/Image Zoom Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click a rendered Mermaid diagram or a markdown image in chat to open a fullscreen overlay where they can zoom (scroll wheel or buttons) and pan (drag) to inspect detail.

**Architecture:** A `ZoomViewerProvider` React context, mounted once in `ChatPanel`, exposes an `open(content)` function. `Mermaid.tsx` and a new `img` renderer in `Markdown.tsx` call it on click. The provider renders a fullscreen `ImageViewerOverlay` (built on `react-zoom-pan-pinch`'s `TransformWrapper`/`TransformComponent`) when content is set.

**Tech Stack:** React 18, TypeScript, `react-zoom-pan-pinch` (new dependency, v4.0.4).

## Global Constraints

- No automated tests for this feature. This project has no renderer-UI test coverage today — `Mermaid.tsx` and `DiffView.tsx` (the closest comparable components) have none, and the vitest config runs with `environment: 'node'` (no jsdom installed), so component tests aren't feasible without adding a new test dependency, which is out of scope. Each task below is instead verified with `npm run build` (a full `tsc` type-check via electron-vite) and, for the final task, a manual smoke check.
- Follow existing code conventions exactly: icon components go in `src/renderer/src/components/icons.tsx` as `{ className }: IconProps` functional components returning inline SVG (see existing `EditIcon`/`TrashIcon` for the line-icon style: `viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"`). CSS custom properties come from the token list at the top of `src/renderer/src/theme.css` (`--space-1..4`, `--sidebar-bg`, `--border`, `--fg`, `--fg-dim`, `--list-hover`, `--accent`) — never hardcode a color that has an existing token.
- All new/modified `.tsx` files must type-check cleanly under the project's existing `tsconfig.web.json` (strict mode is on — no implicit `any`, no unused locals).

---

### Task 1: Add the `react-zoom-pan-pinch` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: the `react-zoom-pan-pinch` package (`TransformWrapper`, `TransformComponent` exports) available to import in later tasks.

- [ ] **Step 1: Install the package**

Run: `npm install react-zoom-pan-pinch@4.0.4`

Expected: `package.json`'s `dependencies` gains `"react-zoom-pan-pinch": "^4.0.4"` (or the exact installed version), and `package-lock.json` updates accordingly. (If already installed from prior exploration, this command is a no-op that confirms it's present — check `grep react-zoom-pan-pinch package.json` shows it either way.)

- [ ] **Step 2: Verify the build still type-checks**

Run: `npm run build`

Expected: build completes with no errors (same as before — this step only adds a dependency, nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add react-zoom-pan-pinch dependency for the diagram/image zoom viewer"
```

---

### Task 2: Add close/zoom-in/zoom-out icons

**Files:**
- Modify: `src/renderer/src/components/icons.tsx`

**Interfaces:**
- Produces: `CloseIcon`, `ZoomInIcon`, `ZoomOutIcon` — each `({ className }: IconProps) => JSX.Element`, matching the existing icon export pattern in this file.

- [ ] **Step 1: Add the three icons**

Append to the end of `src/renderer/src/components/icons.tsx`:

```tsx
export function CloseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

export function ZoomInIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14M7 4.8v4.4M4.8 7h4.4" strokeLinecap="round" />
    </svg>
  )
}

export function ZoomOutIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14M4.8 7h4.4" strokeLinecap="round" />
    </svg>
  )
}
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/icons.tsx
git commit -m "Add close/zoom-in/zoom-out icons"
```

---

### Task 3: Create the `ZoomViewer` context and overlay component

**Files:**
- Create: `src/renderer/src/components/ZoomViewer.tsx`

**Interfaces:**
- Consumes: `TransformWrapper`, `TransformComponent` from `react-zoom-pan-pinch` (Task 1); `CloseIcon`, `ZoomInIcon`, `ZoomOutIcon` from `./icons` (Task 2).
- Produces:
  - `type ViewerContent = { type: 'image'; src: string; alt?: string } | { type: 'svg'; markup: string }`
  - `ZoomViewerProvider({ children }: { children: ReactNode }): JSX.Element` — wraps its children and renders the overlay when open.
  - `useZoomViewer(): { open: (content: ViewerContent) => void }` — throws if called outside `ZoomViewerProvider`.

- [ ] **Step 1: Write the file**

Create `src/renderer/src/components/ZoomViewer.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { CloseIcon, ZoomInIcon, ZoomOutIcon } from './icons'

export type ViewerContent = { type: 'image'; src: string; alt?: string } | { type: 'svg'; markup: string }

interface ZoomViewerContextValue {
  open: (content: ViewerContent) => void
}

const ZoomViewerContext = createContext<ZoomViewerContextValue | null>(null)

export function useZoomViewer(): ZoomViewerContextValue {
  const ctx = useContext(ZoomViewerContext)
  if (!ctx) throw new Error('useZoomViewer must be used within a ZoomViewerProvider')
  return ctx
}

export function ZoomViewerProvider({ children }: { children: ReactNode }): JSX.Element {
  const [content, setContent] = useState<ViewerContent | null>(null)
  // Bumped on every open() so re-opening (even with identical content) always
  // remounts the overlay with a fresh TransformWrapper -- otherwise a second
  // diagram opened while still zoomed in on the first would inherit its scale.
  const [openId, setOpenId] = useState(0)

  const open = useCallback((next: ViewerContent) => {
    setContent(next)
    setOpenId((id) => id + 1)
  }, [])

  const close = useCallback(() => setContent(null), [])

  const value = useMemo(() => ({ open }), [open])

  return (
    <ZoomViewerContext.Provider value={value}>
      {children}
      {content && <ImageViewerOverlay key={openId} content={content} onClose={close} />}
    </ZoomViewerContext.Provider>
  )
}

function ImageViewerOverlay({
  content,
  onClose
}: {
  content: ViewerContent
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="zoom-viewer-overlay" onClick={onClose}>
      <button className="zoom-viewer-close" onClick={onClose} title="Close" aria-label="Close">
        <CloseIcon />
      </button>
      {/* Stops propagation so clicking/dragging the diagram itself doesn't
          also trigger the backdrop's onClose. */}
      <div className="zoom-viewer-content" onClick={(e) => e.stopPropagation()}>
        <TransformWrapper initialScale={1} minScale={0.2} maxScale={8} wheel={{ step: 0.2 }} doubleClick={{ disabled: true }}>
          {({ zoomIn, zoomOut, resetTransform }) => (
            <>
              <div className="zoom-viewer-controls">
                <button onClick={() => zoomOut()} title="Zoom out" aria-label="Zoom out">
                  <ZoomOutIcon />
                </button>
                <button className="zoom-viewer-reset" onClick={() => resetTransform()} title="Reset zoom">
                  Reset
                </button>
                <button onClick={() => zoomIn()} title="Zoom in" aria-label="Zoom in">
                  <ZoomInIcon />
                </button>
              </div>
              <TransformComponent wrapperClass="zoom-viewer-wrapper" contentClass="zoom-viewer-transform">
                {content.type === 'image' ? (
                  <img src={content.src} alt={content.alt ?? ''} />
                ) : (
                  // eslint-disable-next-line react/no-danger
                  <div dangerouslySetInnerHTML={{ __html: content.markup }} />
                )}
              </TransformComponent>
            </>
          )}
        </TransformWrapper>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors. (Nothing imports `ZoomViewer.tsx` yet, so this only confirms the new file itself compiles.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ZoomViewer.tsx
git commit -m "Add ZoomViewerProvider and fullscreen zoom/pan overlay"
```

---

### Task 4: Mount `ZoomViewerProvider` in `ChatPanel`

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx:1-5` (imports), `:395-396` and `:546-552` (root JSX)

**Interfaces:**
- Consumes: `ZoomViewerProvider` from `./ZoomViewer` (Task 3).

- [ ] **Step 1: Import `ZoomViewerProvider`**

In `src/renderer/src/components/ChatPanel.tsx`, add to the imports at the top of the file:

```tsx
import { ZoomViewerProvider } from './ZoomViewer'
```

- [ ] **Step 2: Wrap the component's root JSX**

Find (around line 395-396):

```tsx
  return (
    <div className="chat">
```

Replace with:

```tsx
  return (
    <ZoomViewerProvider>
      <div className="chat">
```

Find the matching close (around line 546-552 — the actual file has *three* closing `</div>` tags here: the send button's wrapper, the composer wrapper, and finally `<div className="chat">` itself, immediately followed by the closing `)` of the `return`):

```tsx
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Replace with (the three original `</div>` closes are unchanged — only `</ZoomViewerProvider>` is added, after the last one):

```tsx
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
        </div>
      </div>
      </div>
    </ZoomViewerProvider>
  )
}
```

(Re-indent the inner lines by two spaces if you want to keep formatting tidy — indentation doesn't affect correctness here.)

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx
git commit -m "Mount ZoomViewerProvider around the chat panel"
```

---

### Task 5: Make rendered Mermaid diagrams clickable

**Files:**
- Modify: `src/renderer/src/components/Mermaid.tsx`

**Interfaces:**
- Consumes: `useZoomViewer` from `./ZoomViewer` (Task 3).

- [ ] **Step 1: Wire the click handler**

In `src/renderer/src/components/Mermaid.tsx`, add the import:

```tsx
import { useZoomViewer } from './ZoomViewer'
```

Add the hook call inside the component body (right after the existing `useState` calls):

```tsx
export function Mermaid({ chart, streaming }: { chart: string; streaming?: boolean }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { open } = useZoomViewer()
```

Replace the final render line:

```tsx
  if (!svg) return <div className="mermaid-loading">Rendering diagram…</div>
  // eslint-disable-next-line react/no-danger
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
```

with:

```tsx
  if (!svg) return <div className="mermaid-loading">Rendering diagram…</div>
  return (
    <div
      className="mermaid-diagram is-zoomable"
      role="button"
      tabIndex={0}
      title="Click to zoom"
      onClick={() => open({ type: 'svg', markup: svg })}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open({ type: 'svg', markup: svg })
      }}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Mermaid.tsx
git commit -m "Open the zoom viewer when a rendered mermaid diagram is clicked"
```

---

### Task 6: Make markdown images clickable

**Files:**
- Modify: `src/renderer/src/components/Markdown.tsx`

**Interfaces:**
- Consumes: `useZoomViewer` from `./ZoomViewer` (Task 3).
- Produces: `img` markdown elements now render via a new internal `ZoomableImage` component instead of the browser default.

- [ ] **Step 1: Add the import and `ZoomableImage` helper**

In `src/renderer/src/components/Markdown.tsx`, add the import:

```tsx
import { useZoomViewer } from './ZoomViewer'
```

Add this function above `export const Markdown = memo(...)`:

```tsx
function ZoomableImage({ src, alt }: { src?: string; alt?: string }): JSX.Element | null {
  const { open } = useZoomViewer()
  if (!src) return null
  return (
    <img
      className="md-image"
      src={src}
      alt={alt ?? ''}
      onClick={() => open({ type: 'image', src, alt })}
    />
  )
}
```

- [ ] **Step 2: Register the `img` component override**

In the `components={{ ... }}` object passed to `ReactMarkdown`, add an `img` entry alongside the existing `pre`, `code`, and `a` entries:

```tsx
        img: ({ src, alt }) => <ZoomableImage src={src} alt={alt} />,
```

(Place it directly after the `code` entry and before `a`, matching the order the other overrides appear in.)

- [ ] **Step 3: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Markdown.tsx
git commit -m "Open the zoom viewer when a markdown image is clicked"
```

---

### Task 7: Style the overlay, controls, and clickable affordances

**Files:**
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: CSS classes produced by Tasks 3, 5, 6 (`zoom-viewer-overlay`, `zoom-viewer-close`, `zoom-viewer-content`, `zoom-viewer-controls`, `zoom-viewer-reset`, `zoom-viewer-wrapper`, `zoom-viewer-transform`, `mermaid-diagram.is-zoomable`, `md-image`).

- [ ] **Step 1: Add the overlay styles**

Append to the end of `src/renderer/src/theme.css`:

```css
.zoom-viewer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.zoom-viewer-close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--fg);
  cursor: pointer;
  z-index: 1;
}

.zoom-viewer-close:hover {
  background: var(--list-hover);
}

.zoom-viewer-content {
  position: relative;
  width: 90vw;
  height: 85vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-viewer-controls {
  position: absolute;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: var(--space-2);
  z-index: 1;
}

.zoom-viewer-controls button {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--fg);
  cursor: pointer;
  border-radius: 4px;
}

.zoom-viewer-controls button:hover {
  background: var(--list-hover);
}

.zoom-viewer-controls .zoom-viewer-reset {
  width: auto;
  padding: 0 var(--space-2);
  font-size: 12px;
  color: var(--fg-dim);
}

.zoom-viewer-wrapper,
.zoom-viewer-transform {
  width: 100%;
  height: 100%;
}

.zoom-viewer-transform {
  display: flex;
  align-items: center;
  justify-content: center;
}

.zoom-viewer-transform img,
.zoom-viewer-transform svg {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.mermaid-diagram.is-zoomable {
  cursor: zoom-in;
}

.chat-line.is-markdown .md-body img {
  max-width: 100%;
  border-radius: 4px;
  cursor: zoom-in;
}
```

- [ ] **Step 2: Verify the build type-checks**

Run: `npm run build`

Expected: build completes with no errors (CSS isn't type-checked, but this confirms the change didn't break anything else in the build pipeline).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/theme.css
git commit -m "Style the diagram/image zoom viewer overlay and controls"
```

---

### Task 8: Manual verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: build completes with no errors, matching every prior task's build check.

- [ ] **Step 2: Ask the user to relaunch and verify by hand**

This is a renderer-UI feature with no automated test coverage (see Global Constraints), so final verification is manual, in the running app — the agent implementing this plan cannot launch the Electron GUI itself if running in a sandboxed environment (`ELECTRON_RUN_AS_NODE=1` forces `electron.exe` into headless Node mode, as encountered earlier in this project). Ask the user to fully quit and relaunch the app from this worktree, then check:

- Clicking a rendered Mermaid diagram opens the fullscreen overlay.
- Clicking a markdown image (if the current conversation has one, or after asking the agent to include one) opens the same overlay.
- Scroll wheel zooms in/out centered on the cursor; the +/−/Reset buttons work too.
- Click-and-drag pans the content.
- Esc, the close button, and clicking the dimmed backdrop all close the overlay.
- Clicking the diagram/image *inside* the overlay (not the backdrop) does not close it.
- Reopening a diagram after zooming into a previous one starts back at 1x, not the previous zoom level.

- [ ] **Step 3: Fix any issues found, then commit**

If verification finds a bug, fix it in the relevant file from Tasks 3-7, re-run `npm run build`, and commit the fix with a message describing what was wrong (e.g. `git commit -m "Fix overlay not closing on Esc"`). Repeat until all checks in Step 2 pass.
