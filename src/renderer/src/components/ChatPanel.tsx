import {
  Component,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode
} from 'react'
import type {
  ChatEvent,
  CompactionThresholds,
  ContextUsage,
  HistoryItem,
  ModelInfo,
  SessionRecord,
  SessionStats,
  SkillInfo,
  SkillSource,
  ThinkingInfo,
  ThinkingLevel,
  ToolInfo,
  TokenUsage
} from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { readBlobAsDataUrl, resizeImageDataUrl, splitDataUrl, type PastedImage } from '../lib/imageAttachment'
import {
  ChevronIcon,
  SendIcon,
  StopIcon,
  SpinnerIcon,
  PlusIcon,
  SlashIcon,
  AnthropicIcon,
  GitHubIcon,
  GeminiIcon,
  ReadIcon,
  WriteIcon,
  EditIcon,
  SearchIcon,
  FolderIcon,
  ListIcon,
  TerminalIcon
} from './icons'
import { Markdown } from './Markdown'
import { DiffView, diffStats } from './DiffView'
import { ZoomViewerProvider, useZoomViewer } from './ZoomViewer'

const LAST_MODEL_KEY = 'passcode-last-model'

// Generous fixed bounds rather than deriving from the model's own default --
// an override is meant to force earlier compaction for testing, and the
// model's true default is always one Reset click away regardless of where
// the slider currently sits.
const CONTEXT_WINDOW_MIN = 4_000
const CONTEXT_WINDOW_MAX = 1_000_000
const CONTEXT_WINDOW_STEP = 1_000

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
  | { kind: 'user'; id: string; text: string; images?: { dataUrl: string }[] }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'thinking'; id: string; text: string; startedAt: number; endedAt?: number }
  | {
      kind: 'tool'
      id: string
      toolCallId: string
      toolName: string
      args: unknown
      usage?: TokenUsage
      usageScope?: 'model response' | 'turn total'
      status: 'running' | 'done' | 'error'
      result?: unknown
      startedAt: number
      endedAt?: number
    }
  | { kind: 'error'; id: string; text: string }

interface Props {
  session: SessionRecord
  repoName: string
  /** Bumped by App.tsx when Settings closes, so a provider key saved while
   * it was open (making new models available) shows up without a reload. */
  modelsRefreshKey: number
}

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `item-${idCounter}`
}

// A crash rendering one transcript row (e.g. malformed tool-call data from
// an interrupted turn in saved history) used to take the entire app down to
// a blank screen, since nothing caught it. Scoping the boundary to a single
// row means the rest of the transcript still renders even if one item's
// data is bad.
class RowErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    console.error('Failed to render a transcript row:', error)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <div className="timeline-row-error">Couldn't display this item.</div>
    }
    return this.props.children
  }
}

export function ChatPanel({ session, repoName, modelsRefreshKey }: Props): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelInfo[]>([])
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactionThresholds, setCompactionThresholds] = useState<CompactionThresholds | null>(null)
  const [contextPopoverOpen, setContextPopoverOpen] = useState(false)
  const [contextWindowInput, setContextWindowInput] = useState('')
  const contextPopoverRef = useRef<HTMLDivElement>(null)
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null)
  const [statsPopoverOpen, setStatsPopoverOpen] = useState(false)
  const statsPopoverRef = useRef<HTMLDivElement>(null)
  const [toolsInfo, setToolsInfo] = useState<{ all: ToolInfo[]; active: string[] } | null>(null)
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false)
  const toolsPopoverRef = useRef<HTMLDivElement>(null)
  const [thinkingInfo, setThinkingInfo] = useState<ThinkingInfo | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const skillPickerRef = useRef<HTMLDivElement>(null)
  const [attachedFile, setAttachedFile] = useState<string | null>(null)
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([])
  const [autoMode, setAutoMode] = useState(false)
  const [thinkingWord, setThinkingWord] = useState(THINKING_WORDS[0])
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const turnActionIdsRef = useRef<string[]>([])
  const composerFieldRef = useRef<HTMLTextAreaElement>(null)

  async function sendNow(text: string): Promise<void> {
    // Matches what the main process actually shows for this turn once
    // history is reconstructed (see promptBuilder.ts's label) -- a skill
    // reference plus the typed text, not the skill's full instructions.
    const label = selectedSkill ? `/${selectedSkill.name} ${text}` : text
    const sentImages = pastedImages.map((img) => ({ dataUrl: img.dataUrl }))
    setItems((prev) => [
      ...prev,
      { kind: 'user', id: newId(), text: label, ...(sentImages.length > 0 ? { images: sentImages } : {}) }
    ])
    setBusy(true)
    setThinking(true)
    const options = {
      skillFilePath: selectedSkill?.filePath,
      skillName: selectedSkill?.name,
      attachedFilePath: attachedFile ?? undefined,
      images: pastedImages.length > 0 ? pastedImages.map((img) => splitDataUrl(img.dataUrl)) : undefined
    }
    setSelectedSkill(null)
    setAttachedFile(null)
    setPastedImages([])
    await window.api.session.prompt(session.id, text, options)
  }

  const modelsRef = useRef(models)
  modelsRef.current = models

  useEffect(() => {
    window.api.models.list().then(setModels)
  }, [modelsRefreshKey])

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

  // Grows the composer with its content instead of scrolling text
  // horizontally inside a fixed single line -- reset to 'auto' first so a
  // shrink (e.g. after sending) isn't blocked by the previous scrollHeight.
  useEffect(() => {
    const el = composerFieldRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

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
    if (!contextPopoverOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (contextPopoverRef.current && !contextPopoverRef.current.contains(e.target as Node)) {
        setContextPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextPopoverOpen])

  useEffect(() => {
    if (!statsPopoverOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (statsPopoverRef.current && !statsPopoverRef.current.contains(e.target as Node)) {
        setStatsPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [statsPopoverOpen])

  useEffect(() => {
    if (!toolsPopoverOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (toolsPopoverRef.current && !toolsPopoverRef.current.contains(e.target as Node)) {
        setToolsPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [toolsPopoverOpen])

  useEffect(() => {
    setItems([])
    setBusy(false)
    setThinking(false)
    setCurrentModel(null)
    setContextUsage(null)
    setAutoCompactEnabled(false)
    setCompacting(false)
    setCompactionThresholds(null)
    setContextPopoverOpen(false)
    setContextWindowInput('')
    setSessionStats(null)
    setStatsPopoverOpen(false)
    setToolsInfo(null)
    setToolsPopoverOpen(false)
    setThinkingInfo(null)
    turnActionIdsRef.current = []
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
        const id = newId()
        turnActionIdsRef.current.push(id)
        setItems((prev) => [
          ...prev,
          {
            kind: 'tool',
            id,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            usage: event.usage,
            usageScope: event.usage ? 'model response' : undefined,
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
        // NOT the end of the whole agent run -- the SDK emits one turn_end
        // per model round-trip, and a single prompt can span several turns
        // via tool use before the loop actually finishes. Clearing `busy`
        // here made the Stop button go disabled mid-run, after the first
        // turn, while the agent kept working underneath. The main process's
        // 'busy' event (sent once session.prompt()'s promise actually
        // resolves, i.e. the whole loop is done) is the authoritative signal
        // for that -- see the `event.type === 'busy'` handler below.
        setThinking(false)
        const usage = event.usage
        const actionIds = turnActionIdsRef.current
        turnActionIdsRef.current = []
        if (usage) {
          setItems((prev) =>
            prev.map((item) =>
              item.kind === 'tool' && actionIds.includes(item.id) && !item.usage
                ? { ...item, usage, usageScope: 'turn total' as const }
                : item
            )
          )
        }
      } else if (event.type === 'history') {
        hasPriorTurns = event.items.length > 0
        setItems(mapHistory(event.items))
      } else if (event.type === 'model') {
        // The 'model' event itself doesn't carry providerName (sessionHandlers.ts
        // only knows provider/id/name at that point) -- look it up from the
        // already-fetched models list, falling back to the raw provider id
        // if that list hasn't loaded yet.
        const matched = modelsRef.current.find((m) => m.provider === event.provider && m.id === event.id)
        setCurrentModel({
          provider: event.provider,
          providerName: matched?.providerName ?? event.provider,
          id: event.id,
          name: event.name
        })
        // Thinking support/available-levels are per-model -- refetch on
        // every model change (manual switch or override) rather than
        // trying to derive them client-side.
        window.api.session.getThinkingInfo(session.id).then(setThinkingInfo)
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
      } else if (event.type === 'context_usage') {
        setContextUsage(event.usage)
      } else if (event.type === 'compaction_status') {
        setCompacting(event.status === 'start')
      } else if (event.type === 'auto_compaction') {
        setAutoCompactEnabled(event.enabled)
      } else if (event.type === 'thinking_level') {
        setThinkingInfo((prev) => (prev ? { ...prev, level: event.level } : prev))
      }
    })

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      unsubscribe()
    }
  }, [session.id])

  async function handleSend(): Promise<void> {
    const text = input.trim()
    if (!text && pastedImages.length === 0) return
    // Typing "/" opens the skill picker inline; Enter here should pick a
    // skill (when there's exactly one match) rather than send "/query" as
    // a literal message.
    if (input.startsWith('/')) {
      if (filteredSkills.length === 1) handleSelectSkill(filteredSkills[0])
      return
    }
    setInput('')
    // Sending while busy steers the live turn (see sessionHandlers.ts's
    // sendPrompt) instead of waiting -- no local queue needed, the agent
    // picks the message up before its next turn.
    await sendNow(text)
  }

  async function handleStop(): Promise<void> {
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

  function handleToggleModelMenu(): void {
    setModelMenuOpen((v) => !v)
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

  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    // Collect real image files synchronously, before any await -- the
    // clipboard event's DataTransfer is invalidated once this handler
    // yields, so getAsFile() must not be deferred past the first await
    // (deferring it silently drops every image after the first on a
    // multi-image paste). Filtering on kind === 'file' (not just the MIME
    // type) also avoids swallowing a mixed clipboard -- e.g. copying a
    // rich selection that carries both a text/html flavor and an image
    // bitmap flavor -- where treating the image flavor as the whole paste
    // would discard the user's actual text.
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    // Only intercept the paste when it actually carries image data -- a
    // normal text paste must fall through to the textarea's default
    // handling untouched.
    e.preventDefault()
    try {
      for (const file of files) {
        const dataUrl = await readBlobAsDataUrl(file)
        const resized = await resizeImageDataUrl(dataUrl, file.type)
        const { mimeType } = splitDataUrl(resized)
        setPastedImages((prev) => [...prev, { id: newId(), dataUrl: resized, mimeType }])
      }
    } catch (err) {
      setItems((prev) => [
        ...prev,
        { kind: 'error', id: newId(), text: `Couldn't read the pasted image: ${(err as Error).message}` }
      ])
    }
  }

  async function handleToggleAuto(): Promise<void> {
    const next = !autoMode
    setAutoMode(next)
    const autoApprove: Record<string, boolean> = {}
    for (const name of KNOWN_TOOL_NAMES) autoApprove[name] = next
    await window.api.approvals.setPolicy({ autoApprove })
  }

  async function handleOpenContextPopover(): Promise<void> {
    const next = !contextPopoverOpen
    setContextPopoverOpen(next)
    if (next && !compactionThresholds) {
      setCompactionThresholds(await window.api.session.getCompactionThresholds(session.id))
    }
  }

  async function handleOpenStatsPopover(): Promise<void> {
    const next = !statsPopoverOpen
    setStatsPopoverOpen(next)
    // Refetched every open (not cached-forever like thresholds) since,
    // unlike thresholds, these numbers change constantly during a session.
    if (next) setSessionStats(await window.api.session.getSessionStats(session.id))
  }

  async function handleOpenToolsPopover(): Promise<void> {
    const next = !toolsPopoverOpen
    setToolsPopoverOpen(next)
    if (next) setToolsInfo(await window.api.session.getToolsInfo(session.id))
  }

  async function handleToggleTool(toolName: string): Promise<void> {
    if (!toolsInfo) return
    const nextActive = toolsInfo.active.includes(toolName)
      ? toolsInfo.active.filter((t) => t !== toolName)
      : [...toolsInfo.active, toolName]
    setToolsInfo({ ...toolsInfo, active: nextActive })
    await window.api.session.setActiveTools(session.id, nextActive)
  }

  async function handleThinkingLevelCommit(level: ThinkingLevel): Promise<void> {
    if (!thinkingInfo || level === thinkingInfo.level) return
    setThinkingInfo({ ...thinkingInfo, level })
    await window.api.session.setThinkingLevel(session.id, level)
  }

  // Reseeds the editable field whenever the popover opens or the effective
  // window changes (our own override applying, or a reset) -- not on every
  // context_usage event, since tokens/percent change far more often than
  // contextWindow and would otherwise stomp on whatever the user is typing.
  useEffect(() => {
    if (contextPopoverOpen && contextUsage) {
      setContextWindowInput(String(contextUsage.contextWindow))
    }
  }, [contextPopoverOpen, contextUsage?.contextWindow])


  async function handleContextWindowSliderCommit(value: string): Promise<void> {
    const parsed = Math.round(Number(value))
    if (!Number.isFinite(parsed) || parsed <= 0) return
    await window.api.session.setContextWindowOverride(session.id, parsed)
  }

  async function handleResetContextWindow(): Promise<void> {
    await window.api.session.setContextWindowOverride(session.id, null)
  }

  async function handleCompactNow(): Promise<void> {
    if (compacting || busy) return
    // Set optimistically (before the round-trip to the SDK's own
    // `compaction_start` event) so a second rapid click can't slip through
    // the `compacting` guard above while the first click's IPC call is
    // still in flight. `compaction_status` remains the source of truth for
    // clearing this back to false.
    setCompacting(true)
    await window.api.session.compact(session.id)
  }

  async function handleToggleAutoCompaction(): Promise<void> {
    const next = !autoCompactEnabled
    setAutoCompactEnabled(next)
    await window.api.session.setAutoCompactionEnabled(session.id, next)
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

  // Grouped by provider (in the order providers first appear in `models`,
  // which already reflects the registry's own ordering) rather than a flat
  // list with a tag repeated on every row -- with GitHub Copilot alone able
  // to proxy half a dozen Claude variants, a per-row provider label got
  // noisy and pushed names onto a second line in a narrow menu.
  const modelGroups: { providerName: string; models: ModelInfo[] }[] = []
  for (const m of models) {
    const group = modelGroups.find((g) => g.providerName === m.providerName)
    if (group) group.models.push(m)
    else modelGroups.push({ providerName: m.providerName, models: [m] })
  }

  return (
    <ZoomViewerProvider>
      <div className="chat">
      <div className="chat-scroll" ref={chatScrollRef}>
        {visibleItems.length === 0 && !thinking ? (
          <div className="chat-empty">Ask it to explore the code, run something, or make a change.</div>
        ) : (
          groupForRender(visibleItems).map((group) =>
            group.type === 'timeline' ? (
              <div className="timeline" key={group.items[0].id}>
                {group.items.map((item) => (
                  <RowErrorBoundary key={item.id}>
                    <TimelineRow item={item} expanded={expandedIds.has(item.id)} onToggle={toggleExpanded} />
                  </RowErrorBoundary>
                ))}
              </div>
            ) : (
              <RowErrorBoundary key={group.item.id}>
                <TranscriptRow
                  item={group.item}
                  streaming={busy && group.item.id === visibleItems[visibleItems.length - 1]?.id}
                />
              </RowErrorBoundary>
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
                <span className="skill-picker-option-title">
                  <span className="skill-picker-option-name">{skill.name}</span>
                  <span className={`skill-source-badge is-${skill.source}`}>{skillSourceLabel(skill.source)}</span>
                </span>
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
                onClick={handleToggleModelMenu}
                title="Model"
              >
                {currentModel && (
                  <span className={`model-provider-icon is-${currentModel.provider}`}>
                    <ProviderMark provider={currentModel.provider} providerName={currentModel.providerName} />
                  </span>
                )}
                <span className="model-picker-label">{currentModel ? currentModel.name : 'Model…'}</span>
                <ChevronIcon className={`chevron model-picker-chevron${modelMenuOpen ? ' is-open' : ''}`} />
              </button>
              {modelMenuOpen && (
                <div className="model-picker-menu" role="listbox">
                  {modelGroups.map((group) => (
                    <div key={group.providerName} className="model-picker-group">
                      <div className="model-picker-group-label">
                        <span className={`model-provider-icon is-${group.models[0].provider}`}>
                          <ProviderMark provider={group.models[0].provider} providerName={group.providerName} />
                        </span>
                        {group.providerName}
                      </div>
                      {group.models.map((m) => {
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
                  ))}
                </div>
              )}
            </div>
          )}
          {thinkingInfo?.supported && thinkingInfo.available.length > 1 && (
            <ThinkingSlider info={thinkingInfo} onCommit={handleThinkingLevelCommit} />
          )}
          {contextUsage && (
            <div className="context-usage" ref={contextPopoverRef}>
              <button
                type="button"
                className="context-usage-badge"
                onClick={handleOpenContextPopover}
                title="Context window usage"
              >
                <span
                  className={`context-usage-ring is-${contextUsageBand(contextUsage.percent)}`}
                  style={{ ['--pct' as string]: contextUsage.percent ?? 0 }}
                />
                <b>{contextUsage.percent === null ? '—' : Math.round(contextUsage.percent)}%</b>
              </button>
              {contextPopoverOpen && (
                <div className="context-usage-popover">
                  <div className="context-usage-popover-header">
                    <h3>Context window</h3>
                  </div>
                  <div className={`context-usage-meter-row is-${contextUsageBand(contextUsage.percent)}`}>
                    <span className="context-usage-pct">
                      {contextUsage.percent === null ? '—' : Math.round(contextUsage.percent)}%
                    </span>
                    <span className="context-usage-tokens">
                      {contextUsage.tokens === null ? '—' : contextUsage.tokens.toLocaleString()} /{' '}
                      {contextUsage.contextWindow.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="context-usage-track">
                    <div
                      className={`context-usage-fill is-${contextUsageBand(contextUsage.percent)}`}
                      style={{ width: `${contextUsage.percent ?? 0}%` }}
                    />
                  </div>
                  <p className="context-usage-caption">
                    {contextUsage.percent === null
                      ? 'Usage unknown -- will update after the next response.'
                      : contextUsageBand(contextUsage.percent) === 'danger'
                        ? 'Near the limit -- auto-compaction will run very soon.'
                        : contextUsageBand(contextUsage.percent) === 'warning'
                          ? 'Getting full -- auto-compaction will trigger before long.'
                          : 'Comfortable -- plenty of room before the next compaction.'}
                  </p>

                  <hr className="context-usage-divider" />

                  <div className="context-usage-row">
                    <div className="context-usage-row-text">
                      <span className="context-usage-row-title">Compact now</span>
                      <span className="context-usage-row-desc">Summarize older turns to free up space.</span>
                    </div>
                    <button
                      type="button"
                      className="composer-btn"
                      onClick={handleCompactNow}
                      disabled={compacting || busy}
                      title={busy ? 'Wait for the current response to finish before compacting' : undefined}
                    >
                      {compacting ? 'Compacting…' : 'Compact'}
                    </button>
                  </div>

                  <hr className="context-usage-divider" />

                  <div className="context-usage-row">
                    <div className="context-usage-row-text">
                      <span className="context-usage-row-title">Auto-compact</span>
                      <span className="context-usage-row-desc">Compact automatically when nearing the limit.</span>
                    </div>
                    <Switch checked={autoCompactEnabled} onChange={handleToggleAutoCompaction} />
                  </div>

                  {compactionThresholds && (
                    <div className="context-usage-thresholds">
                      <div className="context-usage-threshold">
                        <span>Reserve tokens</span>
                        <b>{compactionThresholds.reserveTokens.toLocaleString()}</b>
                      </div>
                      <div className="context-usage-threshold">
                        <span>Keep recent tokens</span>
                        <b>{compactionThresholds.keepRecentTokens.toLocaleString()}</b>
                      </div>
                    </div>
                  )}

                  <hr className="context-usage-divider" />

                  <div className="context-usage-row">
                    <div className="context-usage-row-text">
                      <span className="context-usage-row-title">Context window</span>
                      <span className="context-usage-row-desc">
                        Override the token limit used for this session.
                      </span>
                    </div>
                    <b className="context-usage-window-value">
                      {Number(contextWindowInput || 0).toLocaleString()}
                    </b>
                  </div>
                  <div className="context-usage-window-controls">
                    <div className="context-usage-window-track-wrap">
                      <input
                        type="range"
                        min={CONTEXT_WINDOW_MIN}
                        max={CONTEXT_WINDOW_MAX}
                        step={CONTEXT_WINDOW_STEP}
                        className="context-usage-window-slider-input"
                        value={contextWindowInput || 0}
                        onChange={(e) => setContextWindowInput(e.target.value)}
                        onPointerUp={(e) => handleContextWindowSliderCommit(e.currentTarget.value)}
                        onKeyUp={(e) => handleContextWindowSliderCommit(e.currentTarget.value)}
                      />
                      <div className="context-usage-window-track">
                        <div
                          className="context-usage-window-fill"
                          style={{
                            width: `${(((Number(contextWindowInput) || CONTEXT_WINDOW_MIN) - CONTEXT_WINDOW_MIN) / (CONTEXT_WINDOW_MAX - CONTEXT_WINDOW_MIN)) * 100}%`
                          }}
                        />
                        <div
                          className="context-usage-window-thumb"
                          style={{
                            left: `${(((Number(contextWindowInput) || CONTEXT_WINDOW_MIN) - CONTEXT_WINDOW_MIN) / (CONTEXT_WINDOW_MAX - CONTEXT_WINDOW_MIN)) * 100}%`
                          }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="composer-btn composer-btn-ghost"
                      onClick={handleResetContextWindow}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="context-usage" ref={statsPopoverRef}>
            <button type="button" className="composer-icon-badge" onClick={handleOpenStatsPopover} title="Session stats">
              ▤
            </button>
            {statsPopoverOpen && (
              <div className="context-usage-popover">
                <div className="context-usage-popover-header">
                  <h3>Session stats</h3>
                </div>
                <p className="context-usage-caption">
                  Totals across the whole session, including history that's been compacted away.
                </p>
                {sessionStats ? (
                  <div className="session-stats-grid">
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Messages</span>
                      <span className="session-stats-value">{sessionStats.totalMessages.toLocaleString()}</span>
                    </div>
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Tool calls</span>
                      <span className="session-stats-value">{sessionStats.toolCalls.toLocaleString()}</span>
                    </div>
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Est. cost</span>
                      <span className="session-stats-value is-accent">${sessionStats.cost.toFixed(2)}</span>
                    </div>
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Input tokens</span>
                      <span className="session-stats-value">{sessionStats.tokens.input.toLocaleString()}</span>
                    </div>
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Output tokens</span>
                      <span className="session-stats-value">{sessionStats.tokens.output.toLocaleString()}</span>
                    </div>
                    <div className="session-stats-cell">
                      <span className="session-stats-label">Cache read</span>
                      <span className="session-stats-value">{sessionStats.tokens.cacheRead.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="sidebar-empty">Loading…</div>
                )}
              </div>
            )}
          </div>
          <div className="context-usage" ref={toolsPopoverRef}>
            <button type="button" className="composer-icon-badge" onClick={handleOpenToolsPopover} title="Active tools">
              ⚙
            </button>
            {toolsPopoverOpen && (
              <div className="context-usage-popover">
                <div className="context-usage-popover-header">
                  <h3>Active tools</h3>
                </div>
                <p className="context-usage-caption">
                  A disabled tool is never offered to the model at all this turn onward -- stricter than
                  requiring approval for it.
                </p>
                {toolsInfo ? (
                  toolsInfo.all.map((tool) => (
                    <div className="context-usage-row" key={tool.name}>
                      <div className="context-usage-row-text">
                        <span className="context-usage-row-title">{tool.name}</span>
                        <span className="context-usage-row-desc">{tool.description}</span>
                      </div>
                      <Switch
                        checked={toolsInfo.active.includes(tool.name)}
                        onChange={() => handleToggleTool(tool.name)}
                      />
                    </div>
                  ))
                ) : (
                  <div className="sidebar-empty">Loading…</div>
                )}
              </div>
            )}
          </div>
        </div>
        {(selectedSkill || attachedFile || pastedImages.length > 0) && (
          <div className="composer-chips">
            {selectedSkill && (
              <span className="composer-chip">
                <SlashIcon /> {selectedSkill.name}
                <span className={`skill-source-badge is-${selectedSkill.source}`}>
                  {skillSourceLabel(selectedSkill.source)}
                </span>
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
            {pastedImages.map((img) => (
              <span key={img.id} className="composer-image-chip">
                <img src={img.dataUrl} alt="Pasted image" />
                <button
                  type="button"
                  className="composer-chip-remove"
                  onClick={() => setPastedImages((prev) => prev.filter((p) => p.id !== img.id))}
                  title="Remove image"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={composerFieldRef}
          className="composer-field"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder={busy ? 'Steer the agent…' : `Message the agent about ${repoName}`}
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
          <span className="composer-hint">{session.title}</span>
          <button className="composer-stop" onClick={handleStop} disabled={!busy} title="Stop">
            <StopIcon />
          </button>
          <button className="composer-send" onClick={handleSend} disabled={!input.trim() && pastedImages.length === 0} title="Send">
            <SendIcon />
          </button>
        </div>
      </div>
      </div>
    </ZoomViewerProvider>
  )
}

// Isolated into its own component so a live drag only re-renders this tiny
// control, not the whole ChatPanel (which would otherwise re-filter/regroup
// the entire transcript on every pointermove tick and cause real UI lag,
// not just visual jank in the slider itself). Local `index`/`dragging` state
// lives here; the parent only hears about the change once, on commit.
const ThinkingSlider = memo(function ThinkingSlider({
  info,
  onCommit
}: {
  info: ThinkingInfo
  onCommit: (level: ThinkingLevel) => void
}): JSX.Element {
  const [index, setIndex] = useState(() => Math.max(0, info.available.indexOf(info.level)))
  const [dragging, setDragging] = useState(false)

  // Resyncs the slider's position whenever the effective level changes from
  // outside a drag -- a model switch (new available set), an auto-clamp on
  // model change, or our own commit landing back via the thinking_level event.
  useEffect(() => {
    const i = info.available.indexOf(info.level)
    setIndex(i === -1 ? 0 : i)
  }, [info])

  function commit(indexStr: string): void {
    setDragging(false)
    const level = info.available[Number(indexStr)]
    if (level) onCommit(level)
  }

  return (
    <div className="thinking-slider" title={`Reasoning effort: ${info.level}`}>
      <div className="thinking-slider-track-wrap">
        <input
          type="range"
          min={0}
          max={info.available.length - 1}
          step={1}
          className="thinking-slider-input"
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={(e) => commit(e.currentTarget.value)}
          onKeyUp={(e) => commit(e.currentTarget.value)}
        />
        <div className={`thinking-slider-segments${dragging ? ' is-dragging' : ''}`}>
          {info.available.map((level, i) => (
            <div key={level} className={`thinking-slider-segment${i === index ? ' is-current' : ''}`}>
              {i === index ? level : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

type TimelineItem = Extract<TranscriptItem, { kind: 'thinking' | 'tool' }>
type SingleItem = Exclude<TranscriptItem, { kind: 'thinking' | 'tool' }>

/** Everything that isn't part of the reasoning/action timeline: the user's
 * own turns (a shaded, right-aligned bubble) and the agent's prose replies
 * (plain, full-width) -- alignment and shading alone signal who's speaking,
 * with no "You"/"Agent" label needed. */
const TranscriptRow = memo(function TranscriptRow({
  item,
  streaming
}: {
  item: SingleItem
  streaming: boolean
}): JSX.Element {
  const { open } = useZoomViewer()

  if (item.kind === 'user') {
    return (
      <div className="chat-line is-user">
        <div className="turn-user-content">
          {item.images && item.images.length > 0 && (
            <div className="turn-images">
              {item.images.map((img, i) => (
                <img
                  key={i}
                  src={img.dataUrl}
                  alt="Pasted image"
                  className="turn-image-thumb"
                  onClick={() => open({ type: 'image', src: img.dataUrl })}
                />
              ))}
            </div>
          )}
          <div className="turn-bubble">{item.text}</div>
        </div>
      </div>
    )
  }
  if (item.kind === 'text') {
    return (
      <div className="chat-line is-markdown">
        <div className="md-body">
          <Markdown text={item.text} streaming={streaming} />
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
  const description = describeToolAction(item.toolName, item.args)
  const isShell = item.toolName === 'bash' || item.toolName === 'powershell'
  const resultSummary = item.status !== 'running' ? summarizeToolResult(item.toolName, item.result) : null
  const runOutput = isShell && typeof item.result === 'string' ? truncateOutput(item.result) : null
  const stat =
    item.status !== 'running' ? computeToolDiffStats(item.toolName, item.args) : null
  const ToolIcon = TOOL_ICONS[item.toolName]

  return (
    <div className="timeline-row">
      {ToolIcon ? (
        <span className={`timeline-tool-icon is-${item.status}`}>
          <ToolIcon />
        </span>
      ) : (
        <span className={`timeline-dot is-${item.status}`} />
      )}
      <button className="timeline-row-header" onClick={handleToggle}>
        <span className="timeline-row-title">{toolActionLabel(item.toolName)}</span>
        {summary && <span className="timeline-row-summary">{summary}</span>}
        {stat && (
          <span className="timeline-row-diffstat">
            {stat.adds > 0 && <span className="is-add">+{stat.adds}</span>}
            {stat.dels > 0 && <span className="is-del">-{stat.dels}</span>}
          </span>
        )}
        <span className="timeline-row-metrics" title="Execution time and model token usage">
          {formatActionMetrics(duration, item.usage, item.usageScope)}
        </span>
        <ChevronIcon className={`chevron${expanded ? ' is-open' : ''}`} />
      </button>
      {resultSummary && !expanded && <div className="timeline-row-result">{resultSummary}</div>}
      {expanded && !isShell && <div className="timeline-row-description">{description}</div>}
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

/** Per-tool-type marker shown in place of a plain status dot, so the
 * timeline reads as "what kind of action happened" at a glance rather
 * than a row of identical dots. A tool name with no entry here falls
 * back to the plain dot (see TimelineRow) rather than rendering nothing. */
const TOOL_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  read: ReadIcon,
  write: WriteIcon,
  edit: EditIcon,
  grep: SearchIcon,
  find: FolderIcon,
  ls: ListIcon,
  bash: TerminalIcon,
  powershell: TerminalIcon
}

/** A plain-English name for the action, shown in place of the raw tool
 * identifier so the card reads as "what happened" at a glance. */
function toolActionLabel(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? toolName
}

function describeToolAction(toolName: string, args: unknown): string {
  const summary = summarizeToolCall(toolName, args)
  if (toolName === 'read') return summary ? `Read the file ${summary}` : 'Read a file'
  if (toolName === 'edit') return summary ? `Update ${summary}` : 'Update a file'
  if (toolName === 'write') return summary ? `Create ${summary}` : 'Create a file'
  if (toolName === 'grep') return summary ? `Search the codebase for ${summary}` : 'Search the codebase'
  if (toolName === 'find') return summary ? `Find files matching ${summary}` : 'Find files'
  if (toolName === 'ls') return summary ? `List the directory ${summary}` : 'List a directory'
  if (toolName === 'bash' || toolName === 'powershell') return summary ? `Run the command ${summary}` : 'Run a command'
  return `Run the ${toolName} action`
}

function formatUsage(usage: TokenUsage | undefined, scope: 'model response' | 'turn total' | undefined): string {
  if (!usage) return 'usage unavailable'
  const suffix = scope === 'turn total' ? ' turn' : ''
  return `${formatTokenCount(usage.input)} in / ${formatTokenCount(usage.output)} out${suffix}`
}

function formatActionMetrics(
  duration: string | null,
  usage: TokenUsage | undefined,
  scope: 'model response' | 'turn total' | undefined
): string {
  return `${duration ?? 'running'} · ${formatUsage(usage, scope)}`
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
      // A tool call whose argument-streaming was interrupted (e.g. the turn
      // was aborted mid-response) can leave edits[] entries with a missing
      // oldText/newText in saved history -- skip those rather than handing
      // the diff library a non-string, which throws and used to take down
      // the whole transcript render with it.
      if (typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') continue
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
        {a.edits.map((edit, i) =>
          typeof edit.oldText === 'string' && typeof edit.newText === 'string' ? (
            <DiffView key={i} oldText={edit.oldText} newText={edit.newText} />
          ) : (
            <pre key={i}>{stringifyDetail(edit)}</pre>
          )
        )}
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
    if (item.kind === 'user') {
      return {
        kind: 'user',
        id: newId(),
        text: item.text,
        ...(item.images && item.images.length > 0
          ? { images: item.images.map((img) => ({ dataUrl: `data:${img.mimeType};base64,${img.data}` })) }
          : {})
      }
    }
    if (item.kind === 'text') return { kind: 'text', id: newId(), text: item.text }
    if (item.kind === 'thinking') return { kind: 'thinking', id: newId(), text: item.text, startedAt: Date.now() }
    return {
      kind: 'tool',
      id: newId(),
      toolCallId: item.toolCallId,
      toolName: item.toolName,
      args: item.input,
      usage: item.usage,
      usageScope: item.usage ? 'model response' : undefined,
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

function formatTokenCount(count: number): string {
  return count.toLocaleString()
}

function contextUsageBand(percent: number | null): 'success' | 'warning' | 'danger' | 'unknown' {
  if (percent === null) return 'unknown'
  if (percent >= 85) return 'danger'
  if (percent >= 60) return 'warning'
  return 'success'
}

/** Official brand mark for a raw provider id, falling back to the
 * provider's initial letter for anything not in our known set (a custom
 * registered provider, for instance). */
function ProviderMark({ provider, providerName }: { provider: string; providerName: string }): JSX.Element {
  if (provider === 'anthropic') return <AnthropicIcon />
  if (provider === 'github-copilot') return <GitHubIcon />
  if (provider === 'google') return <GeminiIcon />
  return <>{providerName.charAt(0)}</>
}

function skillSourceLabel(source: SkillSource): string {
  switch (source) {
    case 'pi':
      return 'Pi'
    case 'project':
      return 'Project'
    case 'claude':
      return 'Claude Code'
    case 'copilot':
      return 'Copilot'
    case 'other':
      return 'Custom'
  }
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}
