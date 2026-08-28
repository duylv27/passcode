import { useEffect, useRef, useState } from 'react'
import type { ChatEvent, SessionRecord } from '../../../shared/types'
import { ChevronIcon, SendIcon, StopIcon, SpinnerIcon, CheckIcon, ErrorIcon } from './icons'

type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      toolCallId: string
      toolName: string
      args: unknown
      status: 'running' | 'done' | 'error'
      result?: unknown
      startedAt: number
      endedAt?: number
    }
  | { kind: 'error'; id: string; text: string }
  | { kind: 'usage'; id: string; input: number; output: number; label: string }

interface Props {
  session: SessionRecord
  repoName: string
  onTurnEnd?: () => void
}

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `item-${idCounter}`
}

export function ChatPanel({ session, repoName, onTurnEnd }: Props): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  async function sendNow(text: string): Promise<void> {
    setItems((prev) => [...prev, { kind: 'user', id: newId(), text }])
    setBusy(true)
    setThinking(true)
    await window.api.session.prompt(session.id, text)
  }

  useEffect(() => {
    setItems([])
    setBusy(false)
    setThinking(false)
    setQueue([])
    window.api.session.open(session.id)

    const unsubscribe = window.api.session.onEvent((eventSessionId, event: ChatEvent) => {
      if (eventSessionId !== session.id) return

      if (event.type === 'text_delta') {
        setThinking(false)
        setItems((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'text') {
            next[next.length - 1] = { ...last, text: last.text + event.delta }
          } else {
            next.push({ kind: 'text', id: newId(), text: event.delta })
          }
          return next
        })
      } else if (event.type === 'tool_start') {
        setThinking(false)
        setItems((prev) => [
          ...prev,
          {
            kind: 'tool',
            id: newId(),
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            status: 'running',
            startedAt: Date.now()
          }
        ])
      } else if (event.type === 'tool_end') {
        setItems((prev) =>
          prev.map((item) =>
            item.kind === 'tool' && item.toolCallId === event.toolCallId
              ? {
                  ...item,
                  status: event.isError ? 'error' : 'done',
                  result: event.result,
                  endedAt: Date.now()
                }
              : item
          )
        )
      } else if (event.type === 'error') {
        setThinking(false)
        setBusy(false)
        setItems((prev) => [...prev, { kind: 'error', id: newId(), text: event.message }])
      } else if (event.type === 'turn_end') {
        setThinking(false)
        setBusy(false)
        if (event.usage) {
          const usage = event.usage
          setItems((prev) => {
            let label = 'Response'
            for (let i = prev.length - 1; i >= 0; i--) {
              const prior = prev[i]
              if (prior.kind === 'usage') break
              if (prior.kind === 'tool') {
                label = prior.toolName
                break
              }
            }
            return [...prev, { kind: 'usage', id: newId(), input: usage.input, output: usage.output, label }]
          })
        }
        onTurnEnd?.()
      }
    })

    return unsubscribe
  }, [session.id, onTurnEnd])

  useEffect(() => {
    if (busy || queue.length === 0) return
    const [next, ...rest] = queue
    setQueue(rest)
    sendNow(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, queue])

  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text) return
    setInput('')
    if (busy) {
      setQueue((prev) => [...prev, text])
    } else {
      await sendNow(text)
    }
  }

  async function handleStop(): Promise<void> {
    setQueue([])
    setBusy(false)
    setThinking(false)
    await window.api.session.abort(session.id)
  }

  function toggleExpanded(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="chat">
      <div className="chat-scroll">
        {items.length === 0 && !thinking ? (
          <div className="chat-empty">Ask it to explore the code, run something, or make a change.</div>
        ) : (
          items.map((item) => (
            <TranscriptRow
              key={item.id}
              item={item}
              expanded={expandedIds.has(item.id)}
              onToggle={() => toggleExpanded(item.id)}
            />
          ))
        )}
        {thinking && (
          <div className="chat-line is-thinking">
            <SpinnerIcon className="spin" /> Thinking…
          </div>
        )}
      </div>
      <div className="composer">
        <input
          className="composer-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend()
          }}
          placeholder={busy ? 'Queue another message…' : `Message the agent about ${repoName}`}
        />
        <div className="composer-toolbar">
          <span className="composer-hint">
            {queue.length > 0 ? `${queue.length} queued` : session.title}
          </span>
          {busy && (
            <button className="composer-stop" onClick={handleStop} title="Stop now">
              <StopIcon /> Stop
            </button>
          )}
          <button
            className="composer-send"
            onClick={handleSend}
            disabled={!input.trim()}
            title={busy ? 'Queue message' : 'Send'}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function TranscriptRow({
  item,
  expanded,
  onToggle
}: {
  item: TranscriptItem
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  if (item.kind === 'user') return <div className="chat-line is-user">{item.text}</div>
  if (item.kind === 'text') return <div className="chat-line is-text">{item.text}</div>
  if (item.kind === 'error') return <div className="chat-line is-error">{item.text}</div>
  if (item.kind === 'usage') {
    return (
      <div className="usage-card">
        <span className="usage-card-label">{item.label}</span>
        <span className="usage-card-tokens">
          ↑ {item.input.toLocaleString()} · ↓ {item.output.toLocaleString()}
        </span>
      </div>
    )
  }

  const duration = item.endedAt ? ((item.endedAt - item.startedAt) / 1000).toFixed(1) + 's' : null

  return (
    <div className="tool-card">
      <button className="tool-card-header" onClick={onToggle}>
        {item.status === 'running' && <SpinnerIcon className="spin tool-status is-running" />}
        {item.status === 'done' && <CheckIcon className="tool-status is-done" />}
        {item.status === 'error' && <ErrorIcon className="tool-status is-error" />}
        <span className="tool-card-name">{item.toolName}</span>
        {duration && <span className="tool-card-duration">{duration}</span>}
        <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
      </button>
      {expanded && (
        <div className="tool-card-body">
          <pre>{stringifyDetail(item.args)}</pre>
          {item.result !== undefined && <pre>{stringifyDetail(item.result)}</pre>}
        </div>
      )}
    </div>
  )
}

function stringifyDetail(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
