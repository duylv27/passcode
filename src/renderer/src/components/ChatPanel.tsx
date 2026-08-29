import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, HistoryItem, ModelInfo, SessionRecord, SkillInfo } from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { ChevronIcon, SendIcon, StopIcon, SpinnerIcon, PlusIcon, SlashIcon } from './icons'
import { Markdown } from './Markdown'
import { DiffView, diffStats } from './DiffView'

const LAST_MODEL_KEY = 'passcode-last-model'

const THINKING_WORDS = [
  'Thinking',
  'Scheming',
  'Pondering',
  'Noodling',
  'Ruminating',
  'Percolating',
  'Puzzling',
  'Mulling'
]

type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string; startedAt: number; endedAt?: number }
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
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const skillPickerRef = useRef<HTMLDivElement>(null)
  const [attachedFile, setAttachedFile] = useState<string | null>(null)
  const [autoMode, setAutoMode] = useState(false)
  const [thinkingWord, setThinkingWord] = useState(THINKING_WORDS[0])
  const chatScrollRef = useRef<HTMLDivElement>(null)

  async function sendNow(text: string): Promise<void> {
    // Matches what the main process actually shows for this turn once
    // history is reconstructed (see promptBuilder.ts's label) -- a skill
    // reference plus the typed text, not the skill's full instructions.
    const label = selectedSkill ? `/${selectedSkill.name} ${text}` : text
    setItems((prev) => [...prev, { kind: 'user', id: newId(), text: label }])
    setBusy(true)
    setThinking(true)
    const options = {
      skillFilePath: selectedSkill?.filePath,
      skillName: selectedSkill?.name,
      attachedFilePath: attachedFile ?? undefined
    }
    setSelectedSkill(null)
    setAttachedFile(null)
    await window.api.session.prompt(session.id, text, options)
  }

  const modelsRef = useRef(models)
  modelsRef.current = models

  useEffect(() => {
    window.api.models.list().then(setModels)
  }, [])

  useEffect(() => {
    window.api.skills.list(session.repoId).then(setSkills)
  }, [session.repoId])

  useEffect(() => {
    window.api.approvals.getPolicy().then((policy) => {
      setAutoMode(KNOWN_TOOL_NAMES.every((name) => policy.autoApprove[name]))
    })
  }, [])

  useEffect(() => {
    if (!thinking) return
    setThinkingWord(THINKING_WORDS[Math.floor(Math.random() * THINKING_WORDS.length)])
    const interval = setInterval(() => {
      setThinkingWord((prev) => {
        const options = THINKING_WORDS.filter((w) => w !== prev)
        return options[Math.floor(Math.random() * options.length)]
      })
    }, 1800)
    return () => clearInterval(interval)
  }, [thinking])

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight })
  }, [items, thinking])

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
    if (!skillMenuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setSkillMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [skillMenuOpen])

  useEffect(() => {
    setItems([])
    setBusy(false)
    setThinking(false)
    setQueue([])
    setCurrentModel(null)
    window.api.session.open(session.id)

    // Whether this session has any prior turns, known only once the
    // 'history' event (always sent before 'model' on open) arrives -- a
    // session with none is "new" and should inherit the last-picked model
    // rather than the SDK's own default. Applying this from the 'model'
    // handler (instead of a separate effect keyed on `models`) guarantees
    // our setModel call is always sequenced after the default one, so it
    // can't lose a race with it.
    let hasPriorTurns = false
    let restoredModel = false

    // Streamed text/thinking arrives token-by-token; applying each token as
    // its own state update forces a full markdown re-parse + re-highlight
    // per token, which is what made streamed responses feel janky. Buffer
    // consecutive deltas and flush at most once per animation frame instead.
    const pendingRef: { current: { kind: 'text' | 'thinking'; text: string } | null } = { current: null }
    let rafId: number | null = null

    function flushPending(): void {
      const pending = pendingRef.current
      if (!pending) return
      pendingRef.current = null
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      if (pending.kind === 'text') {
        setItems((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'text') {
            next[next.length - 1] = { ...last, text: last.text + pending.text }
          } else {
            next.push({ kind: 'text', id: newId(), text: pending.text })
          }
          return next
        })
      } else {
        setItems((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.kind === 'thinking') {
            next[next.length - 1] = { ...last, text: last.text + pending.text }
          } else {
            next.push({ kind: 'thinking', id: newId(), text: pending.text, startedAt: Date.now() })
          }
          return next
        })
      }
    }

    function scheduleFlush(): void {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        flushPending()
      })
    }

    const unsubscribe = window.api.session.onEvent((eventSessionId, event: ChatEvent) => {
      if (eventSessionId !== session.id) return

      if (event.type === 'text_delta') {
        setThinking(false)
        if (pendingRef.current?.kind === 'thinking') flushPending()
        pendingRef.current = { kind: 'text', text: (pendingRef.current?.text ?? '') + event.delta }
        scheduleFlush()
        return
      }

      if (event.type === 'thinking_delta') {
        setThinking(false)
        if (pendingRef.current?.kind === 'text') flushPending()
        pendingRef.current = { kind: 'thinking', text: (pendingRef.current?.text ?? '') + event.delta }
        scheduleFlush()
        return
      }

      flushPending()

      if (event.type === 'thinking_end') {
        setItems((prev) => {
          const next = [...prev]
          for (let i = next.length - 1; i >= 0; i--) {
            const item = next[i]
            if (item.kind === 'thinking' && item.endedAt === undefined) {
              next[i] = { ...item, endedAt: Date.now() }
              break
            }
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
      } else if (event.type === 'history') {
        hasPriorTurns = event.items.length > 0
        setItems(mapHistory(event.items))
      } else if (event.type === 'model') {
        setCurrentModel({ provider: event.provider, id: event.id, name: event.name })
        if (!restoredModel && !hasPriorTurns) {
          restoredModel = true
          const stored = localStorage.getItem(LAST_MODEL_KEY)
          if (stored) {
            try {
              const { provider, id } = JSON.parse(stored) as { provider: string; id: string }
              if (provider !== event.provider || id !== event.id) {
                const match = modelsRef.current.find((m) => m.provider === provider && m.id === id)
                if (match) handleModelChange(match)
              }
            } catch {
              // ignore malformed storage
            }
          }
        }
      } else if (event.type === 'busy') {
        // Restores the stop button/pulsing state after switching away from
        // a session and back while a turn was still running server-side --
        // the reset above otherwise always leaves this false.
        setBusy(event.busy)
      }
    })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      unsubscribe()
    }
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
    // Typing "/" opens the skill picker inline; Enter here should pick a
    // skill (when there's exactly one match) rather than send "/query" as
    // a literal message.
    if (input.startsWith('/')) {
      if (filteredSkills.length === 1) handleSelectSkill(filteredSkills[0])
      return
    }
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
    localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ provider: model.provider, id: model.id }))
  }

  function handleSelectSkill(skill: SkillInfo): void {
    setSelectedSkill(skill)
    setSkillMenuOpen(false)
    // A skill picked while typing "/name" leaves the query behind as a chip
    // represents it now; a skill picked via the toolbar icon shouldn't
    // clobber whatever the user was otherwise typing.
    if (input.startsWith('/')) setInput('')
  }

  async function handleAttachFile(): Promise<void> {
    const path = await window.api.files.pickFile()
    if (path) setAttachedFile(path)
  }

  async function handleToggleAuto(): Promise<void> {
    const next = !autoMode
    setAutoMode(next)
    const autoApprove: Record<string, boolean> = {}
    for (const name of KNOWN_TOOL_NAMES) autoApprove[name] = next
    await window.api.approvals.setPolicy({ autoApprove })
  }

  const toggleExpanded = useCallback((id: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const visibleItems = items.filter((item) => !(item.kind === 'thinking' && !item.text.trim()))

  // Typing "/" as the start of the message opens the skill picker inline,
  // filtered by whatever follows -- the standard slash-command convention.
  const slashQuery = input.startsWith('/') ? input.slice(1) : null
  const filteredSkills =
    slashQuery === null
      ? skills
      : skills.filter(
          (s) =>
            s.name.toLowerCase().includes(slashQuery.toLowerCase()) ||
            s.description.toLowerCase().includes(slashQuery.toLowerCase())
        )
  const showSkillMenu = skills.length > 0 && (skillMenuOpen || slashQuery !== null) && filteredSkills.length > 0

  return (
    <div className="chat">
      <div className="chat-scroll" ref={chatScrollRef}>
        {visibleItems.length === 0 && !thinking ? (
          <div className="chat-empty">Ask it to explore the code, run something, or make a change.</div>
        ) : (
          groupForRender(visibleItems).map((group) =>
            group.type === 'timeline' ? (
              <div className="timeline" key={group.items[0].id}>
                {group.items.map((item) => (
                  <TimelineRow
                    key={item.id}
                    item={item}
                    expanded={expandedIds.has(item.id)}
                    onToggle={toggleExpanded}
                  />
                ))}
              </div>
            ) : (
              <TranscriptRow key={group.item.id} item={group.item} />
            )
          )
        )}
        {thinking && (
          <div className="chat-line is-thinking">
            <SpinnerIcon className="spin" /> {thinkingWord}…
          </div>
        )}
      </div>
      <div className={`composer${busy ? ' is-busy' : ''}`} ref={skillPickerRef}>
        {showSkillMenu && (
          <div className="skill-picker-menu" role="listbox">
            {filteredSkills.map((skill) => (
              <button
                key={skill.filePath}
                type="button"
                role="option"
                className="skill-picker-option"
                onClick={() => handleSelectSkill(skill)}
              >
                <span className="skill-picker-option-name">{skill.name}</span>
                <span className="skill-picker-option-desc">{skill.description}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-topbar">
          <button
            type="button"
            className={`composer-auto-btn${autoMode ? ' is-active' : ''}`}
            onClick={handleToggleAuto}
            title="Toggle auto-approve for all tools"
          >
            {autoMode ? 'Auto' : 'Manual'}
          </button>
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
                    const isSelected = currentModel?.provider === m.provider && currentModel?.id === m.id
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
        </div>
        {(selectedSkill || attachedFile) && (
          <div className="composer-chips">
            {selectedSkill && (
              <span className="composer-chip">
                <SlashIcon /> {selectedSkill.name}
                <button
                  type="button"
                  className="composer-chip-remove"
                  onClick={() => setSelectedSkill(null)}
                  title="Remove skill"
                >
                  ×
                </button>
              </span>
            )}
            {attachedFile && (
              <span className="composer-chip">
                <PlusIcon /> {attachedFile.split(/[/\\]/).pop()}
                <button
                  type="button"
                  className="composer-chip-remove"
                  onClick={() => setAttachedFile(null)}
                  title="Remove attachment"
                >
                  ×
                </button>
              </span>
            )}
          </div>
        )}
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
          <button type="button" className="composer-icon-btn" onClick={handleAttachFile} title="Attach a file">
            <PlusIcon />
          </button>
          {skills.length > 0 && (
            <button
              type="button"
              className="composer-icon-btn"
              onClick={() => setSkillMenuOpen((v) => !v)}
              title="Use a skill"
            >
              <SlashIcon />
            </button>
          )}
          {busy && <SpinnerIcon className="spin composer-busy-spinner" />}
          <span className="composer-hint">
            {queue.length > 0 ? `${queue.length} queued` : session.title}
          </span>
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

type TimelineItem = Extract<TranscriptItem, { kind: 'thinking' | 'tool' }>
type SingleItem = Exclude<TranscriptItem, { kind: 'thinking' | 'tool' }>

/** Everything that isn't part of the reasoning/action timeline: the user's
 * own turns (a shaded, right-aligned bubble) and the agent's prose replies
 * (plain, full-width) -- alignment and shading alone signal who's speaking,
 * with no "You"/"Agent" label needed. */
const TranscriptRow = memo(function TranscriptRow({ item }: { item: SingleItem }): JSX.Element {
  if (item.kind === 'user') {
    return (
      <div className="chat-line is-user">
        <div className="turn-bubble">{item.text}</div>
      </div>
    )
  }
  if (item.kind === 'text') {
    return (
      <div className="chat-line is-markdown">
        <div className="md-body">
          <Markdown text={item.text} />
        </div>
      </div>
    )
  }
  return <div className="chat-line is-error">{item.text}</div>
})

type RenderGroup = { type: 'timeline'; items: TimelineItem[] } | { type: 'single'; item: SingleItem }

/** Groups consecutive reasoning/tool-call items into one connected
 * timeline, matching how an agent actually works: think, act, think, act.
 * Conversational turns (user bubbles, prose replies) break the chain. */
function groupForRender(items: TranscriptItem[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  for (const item of items) {
    if (item.kind === 'thinking' || item.kind === 'tool') {
      const last = groups[groups.length - 1]
      if (last?.type === 'timeline') last.items.push(item)
      else groups.push({ type: 'timeline', items: [item] })
    } else {
      groups.push({ type: 'single', item })
    }
  }
  return groups
}

const TimelineRow = memo(function TimelineRow({
  item,
  expanded,
  onToggle
}: {
  item: TimelineItem
  expanded: boolean
  onToggle: (id: string) => void
}): JSX.Element {
  const handleToggle = useCallback(() => onToggle(item.id), [onToggle, item.id])

  if (item.kind === 'thinking') {
    const label = item.endedAt
      ? `Thought for ${Math.max(1, Math.round((item.endedAt - item.startedAt) / 1000))}s`
      : 'Reasoning'
    return (
      <div className="timeline-row">
        <span className="timeline-dot" />
        <button className="timeline-row-header" onClick={handleToggle}>
          <span className="timeline-row-title is-muted">{label}</span>
          <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
        </button>
        {expanded && <div className="timeline-row-body">{item.text}</div>}
      </div>
    )
  }

  const duration = item.endedAt ? ((item.endedAt - item.startedAt) / 1000).toFixed(1) + 's' : null
  const summary = summarizeToolCall(item.toolName, item.args)
  const isShell = item.toolName === 'bash' || item.toolName === 'powershell'
  const resultSummary = item.status !== 'running' ? summarizeToolResult(item.toolName, item.result) : null
  const runOutput = isShell && typeof item.result === 'string' ? truncateOutput(item.result) : null
  const stat =
    item.status !== 'running' ? computeToolDiffStats(item.toolName, item.args) : null

  return (
    <div className="timeline-row">
      <span className={`timeline-dot is-${item.status}`} />
      <button className="timeline-row-header" onClick={handleToggle}>
        <span className="timeline-row-title">{toolActionLabel(item.toolName)}</span>
        {summary && <span className="timeline-row-summary">{summary}</span>}
        {stat && (
          <span className="timeline-row-diffstat">
            {stat.adds > 0 && <span className="is-add">+{stat.adds}</span>}
            {stat.dels > 0 && <span className="is-del">-{stat.dels}</span>}
          </span>
        )}
        {duration && <span className="timeline-row-duration">{duration}</span>}
        <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
      </button>
      {resultSummary && !expanded && <div className="timeline-row-result">{resultSummary}</div>}
      {expanded && isShell && (summary || runOutput) && (
        <div className="timeline-terminal">
          {summary && (
            <div className="timeline-terminal-row">
              <span className="timeline-terminal-label">IN</span>
              <span className="timeline-terminal-value">{summary}</span>
            </div>
          )}
          {runOutput && (
            <div className="timeline-terminal-row">
              <span className="timeline-terminal-label">RUN</span>
              <span className="timeline-terminal-value">{runOutput}</span>
            </div>
          )}
        </div>
      )}
      {expanded && !isShell && (
        <div className="timeline-row-body">{renderToolDetail(item.toolName, item.args, item.result)}</div>
      )}
    </div>
  )
})

/** A short preview of shell output for the always-visible terminal box --
 * the full output remains available by expanding the row. */
function truncateOutput(text: string, maxLines = 6, maxCharsPerLine = 160): string {
  const lines = text.trim().split('\n').slice(0, maxLines)
  const truncated = lines.map((line) => (line.length > maxCharsPerLine ? `${line.slice(0, maxCharsPerLine)}…` : line))
  const hasMore = text.trim().split('\n').length > maxLines
  return truncated.join('\n') + (hasMore ? '\n…' : '')
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

/** A one-line summary of the completed call's output, shown under the
 * header even while collapsed so the outcome doesn't require expanding. */
function summarizeToolResult(toolName: string, result: unknown): string | null {
  if (typeof result !== 'string') return null
  const text = result.trim()
  if (!text) return null
  switch (toolName) {
    case 'grep':
    case 'find':
    case 'ls': {
      const lines = text.split('\n').filter(Boolean).length
      return `${lines} line${lines === 1 ? '' : 's'} of output`
    }
    case 'read': {
      const lines = text.split('\n').length
      return `${lines} line${lines === 1 ? '' : 's'}`
    }
    case 'bash':
    case 'powershell': {
      const lines = text.split('\n').filter(Boolean)
      return lines.length > 1 ? `${lines.length} lines of output` : lines[0].slice(0, 120)
    }
    default:
      return null
  }
}

/** Added/removed line counts for edit/write calls, shown as a "+N -N"
 * badge in the row header -- visible without expanding the row. */
function computeToolDiffStats(toolName: string, args: unknown): { adds: number; dels: number } | null {
  const a = args as { content?: string; edits?: { oldText: string; newText: string }[] } | undefined

  if (toolName === 'edit' && a?.edits?.length) {
    let adds = 0
    let dels = 0
    for (const edit of a.edits) {
      const stat = diffStats(edit.oldText, edit.newText)
      adds += stat.adds
      dels += stat.dels
    }
    return { adds, dels }
  }

  if (toolName === 'write' && typeof a?.content === 'string') {
    return diffStats('', a.content)
  }

  return null
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
    if (item.kind === 'thinking') return { kind: 'thinking', id: newId(), text: item.text, startedAt: Date.now() }
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
