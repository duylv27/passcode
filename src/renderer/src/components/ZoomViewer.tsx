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
