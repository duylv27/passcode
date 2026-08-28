import { diffLines } from 'diff'

interface DiffLine {
  text: string
  kind: 'add' | 'del' | 'ctx'
}

function toDiffLines(oldText: string, newText: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const part of diffLines(oldText, newText)) {
    const kind = part.added ? 'add' : part.removed ? 'del' : 'ctx'
    for (const line of part.value.replace(/\n$/, '').split('\n')) {
      lines.push({ text: line, kind })
    }
  }
  return lines
}

/** Added/removed line counts for a change, shown as a "+N -N" badge so a
 * timeline row's collapsed header is obvious about what changed without
 * needing to expand it. */
export function diffStats(oldText: string, newText: string): { adds: number; dels: number } {
  let adds = 0
  let dels = 0
  for (const line of toDiffLines(oldText, newText)) {
    if (line.kind === 'add') adds += 1
    else if (line.kind === 'del') dels += 1
  }
  return { adds, dels }
}

export function DiffView({ oldText, newText }: { oldText: string; newText: string }): JSX.Element {
  const lines = toDiffLines(oldText, newText)
  return (
    <pre className="diff-view">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line is-${line.kind}`}>
          <span className="diff-gutter">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}</span>
          <span className="diff-text">{line.text}</span>
        </div>
      ))}
    </pre>
  )
}
