import { useEffect, useState } from 'react'

let diagramCounter = 0

export function Mermaid({ chart }: { chart: string }): JSX.Element {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    diagramCounter += 1
    const id = `mermaid-diagram-${diagramCounter}`

    import('mermaid').then(async (mod) => {
      const mermaid = mod.default
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
      try {
        const result = await mermaid.render(id, chart)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    })

    return () => {
      cancelled = true
    }
  }, [chart])

  if (error) return <pre className="md-pre mermaid-error">Diagram error: {error}</pre>
  if (!svg) return <div className="mermaid-loading">Rendering diagram…</div>
  // eslint-disable-next-line react/no-danger
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}
