# Diagram/Image Zoom Viewer — Design

## Problem

Mermaid diagrams and markdown images in chat replies render at a fixed, often small,
inline size with no way to inspect detail. Users need to zoom in, zoom out, and pan
around them.

## Goals

- Click a rendered Mermaid diagram or a markdown image to open a fullscreen,
  zoomable/pannable preview.
- Zoom via scroll wheel (centered on cursor) or on-screen +/−/reset buttons.
- Pan via click-and-drag.
- Close via Esc, a close button, or clicking the dimmed backdrop.

## Non-goals

- Inline (non-modal) zoom/pan — out of scope per the approved design.
- Touch/pinch gestures — this is a desktop Electron app; mouse/trackpad-wheel and
  drag are sufficient.
- Automated tests — this is a pure UI/interaction feature. Neither `Mermaid.tsx`
  nor `DiffView.tsx` (the existing comparable renderer components) have test
  coverage; this follows the same convention and will be verified by hand in the
  running app.

## Approach

Use `react-zoom-pan-pinch`, a small, actively maintained library purpose-built for
cursor-centered zoom, drag-panning, and boundary clamping, instead of hand-rolling
that math. It wraps arbitrary content (an `<img>`, or a `dangerouslySetInnerHTML`
div for a Mermaid SVG) with `TransformWrapper`/`TransformComponent`.

## Components

### `ZoomViewerProvider` / `useZoomViewer` (new: `src/renderer/src/components/ZoomViewer.tsx`)

A React context mounted once in `ChatPanel`, since the two things that need to open
the viewer — `Mermaid.tsx` and `Markdown.tsx`'s image rendering — live deep in
nested components, while the overlay itself must render at the top level (fullscreen,
above everything else in the chat panel).

Exposes:

```ts
type ViewerContent = { type: 'image'; src: string; alt?: string } | { type: 'svg'; markup: string }
useZoomViewer(): { open: (content: ViewerContent) => void }
```

Internally holds `viewerContent: ViewerContent | null` state; renders
`<ImageViewerOverlay content={viewerContent} onClose={...} />` when non-null.

### `ImageViewerOverlay` (same file)

- Fullscreen fixed-position backdrop (dimmed, matching the app's existing modal
  conventions — see `ApprovalDialog.tsx` for the current dialog/overlay pattern).
- `TransformWrapper` (wheel zoom enabled, centered on cursor; pan via drag) wrapping
  a `TransformComponent` that renders either:
  - `<img src={content.src} alt={content.alt} />`, or
  - `<div dangerouslySetInnerHTML={{ __html: content.markup }} />` for the SVG case
    (same pattern already used in `Mermaid.tsx` for the inline render).
- Zoom controls (+/−/reset) pinned bottom-right, close (✕) button top-right.
- Closes on: close-button click, backdrop click (not content click), Esc keydown.

## Wiring

- **`Mermaid.tsx`**: the rendered `<div className="mermaid-diagram">` (the
  successful-SVG case only — not the loading/error states) becomes clickable;
  `onClick` calls `useZoomViewer().open({ type: 'svg', markup: svg })`. Add a
  `cursor: zoom-in` affordance via a new class.
- **`Markdown.tsx`**: add an `img` component override (none exists today — images
  currently fall through to the browser default) that renders a clickable `<img>`
  calling `open({ type: 'image', src, alt })` on click, in addition to normal
  inline display.

## Data flow

Click on diagram/image → `open(content)` sets provider state → `ImageViewerOverlay`
mounts with fresh zoom/pan state (key it on a change counter or the content itself
so re-opening always resets to 1x) → user zooms/pans → close → state resets to
`null` → overlay unmounts, listeners cleaned up.

## Styling

New rules in `theme.css` following existing token conventions (`var(--...)`):
overlay backdrop, content container sizing (`max-width`/`max-height` with
`object-fit: contain` for images), control button styling consistent with the
app's existing icon-button look (see `.model-picker-trigger`,
`.composer-send` for reference).

## New dependency

`react-zoom-pan-pinch` — added to `package.json`.

## Risks / open questions

- `Mermaid.tsx`'s SVG is injected via `dangerouslySetInnerHTML`; the overlay reuses
  the same already-sanitized markup (mermaid is configured with
  `securityLevel: 'strict'`), so no new XSS surface.
- Markdown images are only ever assistant-authored URLs (same trust boundary as
  the rest of the rendered markdown today); no new validation needed beyond what
  already applies to link rendering.
