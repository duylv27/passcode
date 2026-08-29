import { useEffect, useState } from 'react'

let diagramCounter = 0

/** A fenced ```mermaid block is syntactically invalid until its closing
 * fence arrives, and `chart` keeps mutating on nearly every streamed frame
 * until then. mermaid.render() doesn't throw for that; it resolves with a
 * built-in "bomb + Syntax error" SVG instead, and internally renders
 * through a temporary node appended to document.body that isn't reliably
 * cleaned up when a new render starts before the previous one settles --
 * calling it on every streamed chunk leaked a stack of those nodes straight
 * into the page, outside React's tree entirely, and flashed a bomb icon on
 * every incomplete chunk in between. Callers pass `streaming: true` while
 * the reply is still arriving so this waits for the real, final source
 * instead of racing partial ones. */
const RENDER_DEBOUNCE_MS = 500

export function Mermaid({ chart, streaming }: { chart: string; streaming?: boolean }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (streaming) return
    let cancelled = false
    const timer = setTimeout(() => {
      diagramCounter += 1
      const id = `mermaid-diagram-${diagramCounter}`

      import('mermaid').then(async (mod) => {
        if (cancelled) return
        const mermaid = mod.default
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
        try {
          const result = await mermaid.render(id, chart)
          if (cancelled) return
          // mermaid resolves (doesn't throw) with its own error diagram on
          // invalid syntax -- treat that the same as a thrown error instead
          // of rendering its bomb-icon SVG.
          if (result.svg.includes('Syntax error in text')) {
            setError('Invalid diagram syntax')
          } else {
            setSvg(result.svg)
          }
        } catch (err) {
          if (!cancelled) setError((err as Error).message)
        }
      })
    }, RENDER_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [chart, streaming])

  if (streaming) return <div className="mermaid-loading">Waiting for diagram to finish…</div>
  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-message">Couldn't render this diagram: {error}</div>
        <pre className="md-pre">
          <code>{chart}</code>
        </pre>
      </div>
    )
  }
  if (!svg) return <div className="mermaid-loading">Rendering diagram…</div>
  // eslint-disable-next-line react/no-danger
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
