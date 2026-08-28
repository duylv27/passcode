import { useEffect, useRef, useState } from 'react'
import type { ChatEvent, HistoryItem, ModelInfo, SessionRecord } from '../../../shared/types'
import { ChevronIcon, SendIcon, StopIcon, SpinnerIcon } from './icons'
import { Markdown } from './Markdown'
import { DiffView } from './DiffView'

type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string }
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
}

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `item-${idCounter}`
}

export function ChatPanel({ session, repoName }: Props): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelInfo[]>([])
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)

  async function sendNow(text: string): Promise<void> {
    setItems((prev) => [...prev, { kind: 'user', id: newId(), text }])
    setBusy(true)
    setThinking(true)
    await window.api.session.prompt(session.id, text)
  }

  useEffect(() => {
    window.api.models.list().then(setModels)
  }, [])

  useEffect(() => {
    if (!modelMenuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [modelMenuOpen])

  useEffect(() => {
    setItems([])
    setBusy(false)
    setThinking(false)
    setQueue([])
    setCurrentModel(null)
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
      } else if (event.type === 'thinking_delta') {
        setThinking(false)
        setItems((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'thinking') {
            next[next.length - 1] = { ...last, text: last.text + event.delta }
          } else {
            next.push({ kind: 'thinking', id: newId(), text: event.delta })
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
      } else if (event.type === 'history') {
        setItems(mapHistory(event.items))
      } else if (event.type === 'model') {
        setCurrentModel({ provider: event.provider, id: event.id, name: event.name })
      }
    })

    return unsubscribe
  }, [session.id])

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

  function handleModelChange(model: ModelInfo): void {
    setCurrentModel(model)
    setModelMenuOpen(false)
    window.api.session.setModel(session.id, model.provider, model.id)
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
          {models.length > 0 && (
            <div className="model-picker" ref={modelPickerRef}>
              <button
                type="button"
                className="model-picker-trigger"
                onClick={() => setModelMenuOpen((v) => !v)}
                title="Model"
              >
                <span className="model-picker-label">{currentModel ? currentModel.name : 'Model…'}</span>
                <ChevronIcon className={`chevron model-picker-chevron${modelMenuOpen ? ' is-open' : ''}`} />
              </button>
              {modelMenuOpen && (
                <div className="model-picker-menu" role="listbox">
                  {models.map((m) => {
                    const isSelected =
                      currentModel?.provider === m.provider && currentModel?.id === m.id
                    return (
                      <button
                        key={`${m.provider}/${m.id}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`model-picker-option${isSelected ? ' is-selected' : ''}`}
                        onClick={() => handleModelChange(m)}
                      >
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          <button
            className={`composer-send${busy ? ' is-stop' : ''}`}
            onClick={busy ? handleStop : handleSend}
            disabled={!busy && !input.trim()}
            title={busy ? 'Stop' : 'Send'}
          >
            {busy ? <StopIcon /> : <SendIcon />}
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
  if (item.kind === 'user') {
    return (
      <div className="chat-line is-user">
        <div className="turn-header">
          <span className="turn-dot is-user" />
          You
        </div>
        <div className="turn-bubble">{item.text}</div>
      </div>
    )
  }
  if (item.kind === 'text') {
    return (
      <div className="chat-line is-markdown">
        <div className="turn-header">
          <span className="turn-dot is-agent" />
          Agent
        </div>
        <div className="md-body">
          <Markdown text={item.text} />
        </div>
      </div>
    )
  }
  if (item.kind === 'thinking') {
    // A thinking block with no content yet (the delta stream just started,
    // or ended up empty) has nothing worth showing.
    if (!item.text.trim()) return <></>
    return (
      <div className="thinking-card">
        <button className="thinking-card-header" onClick={onToggle}>
          <span className="turn-dot is-reasoning" />
          <span className="thinking-card-label">Reasoning</span>
          <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
        </button>
        {expanded && <div className="thinking-card-body">{item.text}</div>}
      </div>
    )
  }
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
  const summary = summarizeToolCall(item.toolName, item.args)

  return (
    <div className="tool-card">
      <button className="tool-card-header" onClick={onToggle}>
        <span className={`status-dot is-${item.status}`} />
        <span className="tool-card-name">{toolActionLabel(item.toolName)}</span>
        {summary && <span className="tool-card-summary">{summary}</span>}
        {duration && <span className="tool-card-duration">{duration}</span>}
        <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
      </button>
      {expanded && <div className="tool-card-body">{renderToolDetail(item.toolName, item.args, item.result)}</div>}
    </div>
  )
}

const TOOL_ACTION_LABELS: Record<string, string> = {
  read: 'Read file',
  edit: 'Edit file',
  write: 'Create file',
  grep: 'Search text',
  find: 'Find files',
  ls: 'List directory',
  bash: 'Run command',
  powershell: 'Run command'
}

/** A plain-English name for the action, shown in place of the raw tool
 * identifier so the card reads as "what happened" at a glance. */
function toolActionLabel(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? toolName
}

/** A short, human-readable description of what the call is doing, shown
 * inline in the tool card's header so the action is legible without
 * expanding it. */
function summarizeToolCall(toolName: string, args: unknown): string | null {
  const a = args as Record<string, unknown> | undefined
  if (!a) return null
  switch (toolName) {
    case 'bash':
    case 'powershell':
      return typeof a.command === 'string' ? a.command : null
    case 'read':
    case 'edit':
    case 'write':
    case 'ls':
      return typeof a.path === 'string' ? a.path : null
    case 'grep':
    case 'find':
      return typeof a.pattern === 'string' ? a.pattern : null
    default:
      return null
  }
}

function renderToolDetail(toolName: string, args: unknown, result: unknown): JSX.Element {
  const a = args as { path?: string; content?: string; edits?: { oldText: string; newText: string }[] } | undefined

  if (toolName === 'edit' && a?.edits?.length) {
    return (
      <>
        {a.edits.map((edit, i) => (
          <DiffView key={i} oldText={edit.oldText} newText={edit.newText} />
        ))}
      </>
    )
  }

  if (toolName === 'write' && typeof a?.content === 'string') {
    return <DiffView oldText="" newText={a.content} />
  }

  return (
    <>
      <pre>{stringifyDetail(args)}</pre>
      {result !== undefined && <pre>{stringifyDetail(result)}</pre>}
    </>
  )
}

function mapHistory(items: HistoryItem[]): TranscriptItem[] {
  return items.map((item) => {
    if (item.kind === 'user') return { kind: 'user', id: newId(), text: item.text }
    if (item.kind === 'text') return { kind: 'text', id: newId(), text: item.text }
    if (item.kind === 'thinking') return { kind: 'thinking', id: newId(), text: item.text }
    return {
      kind: 'tool',
      id: newId(),
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      args: item.input,
      status: item.result === undefined ? 'running' : item.isError ? 'error' : 'done',
      result: item.result,
      startedAt: Date.now()
    }
  })
}

function stringifyDetail(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
