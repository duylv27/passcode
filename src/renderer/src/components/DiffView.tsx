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
