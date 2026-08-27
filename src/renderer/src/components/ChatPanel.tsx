import { useEffect, useRef, useState } from 'react'
import type { ChatEvent, Repo } from '../../../shared/types'

interface ChatLine {
  kind: 'user' | 'text' | 'tool' | 'error'
  text: string
}

interface Props {
  repo: Repo
  onTurnEnd?: () => void
}

export function ChatPanel({ repo, onTurnEnd }: Props): JSX.Element {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [input, setInput] = useState('')
  const currentTextRef = useRef<string>('')

  useEffect(() => {
    setLines([])
    currentTextRef.current = ''
    window.api.session.open(repo.id)

    const unsubscribe = window.api.session.onEvent((eventRepoId, event: ChatEvent) => {
      if (eventRepoId !== repo.id) return

      if (event.type === 'text_delta') {
        currentTextRef.current += event.delta
        setLines((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'text') {
            next[next.length - 1] = { kind: 'text', text: currentTextRef.current }
          } else {
            next.push({ kind: 'text', text: currentTextRef.current })
          }
          return next
        })
      } else if (event.type === 'tool_start') {
        currentTextRef.current = ''
        setLines((prev) => [...prev, { kind: 'tool', text: `Running: ${event.toolName}` }])
      } else if (event.type === 'error') {
        setLines((prev) => [...prev, { kind: 'error', text: event.message }])
      } else if (event.type === 'turn_end') {
        currentTextRef.current = ''
        onTurnEnd?.()
      }
    })

    return unsubscribe
  }, [repo.id, onTurnEnd])

  async function handleSend(): Promise<void> {
    if (!input.trim()) return
    setLines((prev) => [...prev, { kind: 'user', text: input }])
    currentTextRef.current = ''
    const text = input
    setInput('')
    await window.api.session.prompt(repo.id, text)
  }

  return (
    <div className="chat">
      <div className="chat-scroll">
        {lines.length === 0 ? (
          <div className="chat-empty">Ask it to explore the code, run something, or make a change.</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={`chat-line is-${line.kind}`}>
              {line.text}
            </div>
          ))
        )}
      </div>
      <div className="chat-input">
        <input
          className="field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend()
          }}
          placeholder={`Message the agent about ${repo.name}`}
        />
        <button className="btn" onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  )
}
