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
  ApprovalRequest,
  ChatEvent,
  CompactionThresholds,
  ContextUsage,
  CopilotQuota,
  HistoryItem,
  ModelInfo,
  Passport,
  SessionRecord,
  SessionStats,
  SkillInfo,
  SkillSource,
  ThinkingInfo,
  ThinkingLevel,
  TokenUsage,
  UiPromptRequest
} from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { ApprovalPanel } from './ApprovalPanel'
import { UiPromptPanel } from './UiPromptPanel'
import { TOOL_ICONS, describeToolAction, summarizeToolCall, toolActionLabel } from '../lib/toolDisplay'
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
  OpenAIIcon,
  ReadIcon,
  CodeFileIcon,
  ImageFileIcon,
  GearIcon
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
  | { kind: 'denied'; id: string; toolName: string; input: unknown }
  | { kind: 'prompted'; id: string; title: string; answerText: string }

interface Props {
  session: SessionRecord
  repoName: string
  /** Bumped by App.tsx when Settings closes, so a provider key saved while
   * it was open (making new models available) shows up without a reload. */
  modelsRefreshKey: number
  /** Pending tool-call approvals scoped to this session -- App.tsx owns the
   * full cross-session queue and filters it down to this subset. */
  approvalRequests: ApprovalRequest[]
  onRespondApproval: (requestId: string, approved: boolean) => void
  /** Same cross-session-queue-filtered-per-session pattern as
   * approvalRequests above, for extension-raised select/confirm/input
   * prompts (see piSession.ts's bindExtensions() call). */
  uiPromptRequests: UiPromptRequest[]
  onRespondUiPrompt: (requestId: string, value: string | boolean | undefined) => void
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

/** VS Code Quick-Open-style subsequence fuzzy match: every character of
 * `query` must appear in `path` in order (case-insensitive), scored so a
 * denser/earlier match ranks higher than a scattered one. Returns null for
 * no match at all. No embeddings, no index -- just a cheap client-side
 * scan, fine for a single repo's file count. */
function fuzzyScoreFile(query: string, path: string): number | null {
  if (query === '') return 0
  const q = query.toLowerCase()
  const p = path.toLowerCase()
  let qi = 0
  let score = 0
  let lastMatchIndex = -1
  for (let pi = 0; pi < p.length && qi < q.length; pi++) {
    if (p[pi] === q[qi]) {
      // Consecutive matches score higher than ones separated by gaps, and
      // matches earlier in the path score higher than late ones.
      score += lastMatchIndex === pi - 1 ? 3 : 1
      score += Math.max(0, 5 - pi / 10)
      lastMatchIndex = pi
      qi++
    }
  }
  return qi === q.length ? score : null
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php',
  'swift', 'sh', 'bash', 'ps1', 'sql'
])
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'env', 'xml'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'])

/** File-type icon for the @-mention picker -- a quick visual category, not
 * a precise language detector, so an unfamiliar extension just falls back
 * to a plain document glyph rather than guessing. */
function FilePickerIcon({ path }: { path: string }): JSX.Element {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (CODE_EXTENSIONS.has(ext)) return <CodeFileIcon />
  if (CONFIG_EXTENSIONS.has(ext)) return <GearIcon />
  if (IMAGE_EXTENSIONS.has(ext)) return <ImageFileIcon />
  return <ReadIcon />
}

function fuzzyFilterFiles(files: string[], query: string): string[] {
  return files
    .map((path) => ({ path, score: fuzzyScoreFile(query, path) }))
    .filter((r): r is { path: string; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.path)
}

export function ChatPanel({
  session,
  repoName,
  modelsRefreshKey,
  approvalRequests,
  onRespondApproval,
  uiPromptRequests,
  onRespondUiPrompt
}: Props): JSX.Element {
  const [items, setItems] = useState<TranscriptItem[]>([])
  // True from the moment a session is opened until its 'history' event
  // arrives -- without this, switching sessions resets `items` to []
  // synchronously, flashing the empty-state placeholder for a beat before
  // the real transcript populates (same class of bug fixed earlier for
  // the sidebar's session/project lists).
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [models, setModels] = useState<ModelInfo[]>([])
  // position:fixed rather than absolute -- .model-picker-menu has
  // overflow-y:auto (which computes overflow-x to auto too per spec), so an
  // absolutely-positioned tooltip escaping the option to either side would
  // get clipped/scrolled away instead of floating over the whole window.
  const [modelTooltip, setModelTooltip] = useState<{ model: ModelInfo; top: number; left: number } | null>(null)
  const [currentModel, setCurrentModel] = useState<ModelInfo | null>(null)
  // Real provider-reported quota for the session's current model, shown in
  // the Session Stats popover alongside the session's own (also real)
  // message/token totals -- only Copilot exposes a live quota API today, so
  // this stays null (and hidden) for every other provider.
  const [sessionQuota, setSessionQuota] = useState<CopilotQuota | null>(null)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuScrollRef = useRef<HTMLDivElement>(null)
  const modelPickerRef = useRef<HTMLDivElement>(null)
  // A shortcut to switch which Passport is globally active for a provider,
  // right from the composer -- same setActive() Settings already exposes,
  // not a per-session override (Passports stay global-active-per-provider
  // by design). Picking one also updates this session's current model to
  // match, since a Passport switch is meaningless without that.
  const [passports, setPassports] = useState<Passport[]>([])
  const [passportMenuOpen, setPassportMenuOpen] = useState(false)
  const passportPickerRef = useRef<HTMLDivElement>(null)
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
  const [providerStatsPopoverOpen, setProviderStatsPopoverOpen] = useState(false)
  const providerStatsPopoverRef = useRef<HTMLDivElement>(null)
  const [thinkingInfo, setThinkingInfo] = useState<ThinkingInfo | null>(null)
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null)
  const [skillMenuOpen, setSkillMenuOpen] = useState(false)
  const [skillHighlightIndex, setSkillHighlightIndex] = useState(0)
  const [repoFiles, setRepoFiles] = useState<string[]>([])
  const [fileHighlightIndex, setFileHighlightIndex] = useState(0)
  // The @-file menu is otherwise fully derived from the composer text (no
  // open/closed state of its own) -- this lets Escape dismiss it for the
  // current mention attempt without touching the typed text, re-arming as
  // soon as the user types another character (a new mention attempt).
  const [fileMenuDismissedFor, setFileMenuDismissedFor] = useState<string | null>(null)
  // -1 = not navigating; otherwise an index into the user's own past
  // messages (oldest to newest) for the composer's up/down recall, same
  // convention as a shell history.
  const [messageHistoryIndex, setMessageHistoryIndex] = useState(-1)
  const skillPickerRef = useRef<HTMLDivElement>(null)
  const [attachedFiles, setAttachedFiles] = useState<string[]>([])
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
      attachedFilePaths: attachedFiles.length > 0 ? attachedFiles : undefined,
      images: pastedImages.length > 0 ? pastedImages.map((img) => splitDataUrl(img.dataUrl)) : undefined
    }
    setSelectedSkill(null)
    setAttachedFiles([])
    setPastedImages([])
    await window.api.session.prompt(session.id, text, options)
  }

  const modelsRef = useRef(models)
  modelsRef.current = models

  useEffect(() => {
    window.api.models.list().then(setModels)
  }, [modelsRefreshKey])

  useEffect(() => {
    window.api.passports.list().then(setPassports)
  }, [modelsRefreshKey])

  useEffect(() => {
    window.api.skills.list(session.repoId).then(setSkills)
  }, [session.repoId])

  useEffect(() => {
    window.api.files.listRepoFiles(session.repoId).then(setRepoFiles)
  }, [session.repoId])

  useEffect(() => {
    if (currentModel?.provider !== 'github-copilot') {
      setSessionQuota(null)
      return
    }
    let cancelled = false
    window.api.settings
      .getCopilotQuota()
      .then((quota) => {
        if (!cancelled) setSessionQuota(quota)
      })
      .catch(() => {
        if (!cancelled) setSessionQuota(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentModel?.provider])

  useEffect(() => {
    window.api.approvals.getPolicy().then((policy) => {
      setAutoMode(KNOWN_TOOL_NAMES.every((name) => policy.autoApprove[name]))
    })
  }, [modelsRefreshKey])

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
    if (!passportMenuOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (passportPickerRef.current && !passportPickerRef.current.contains(e.target as Node)) {
        setPassportMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [passportMenuOpen])

  // Scroll the current model into view exactly once when the dropdown
  // opens -- doing this from a ref callback on the option itself instead
  // re-fires on every render (e.g. every hover-driven tooltip update),
  // snapping the list back and fighting the user's own manual scrolling.
  useEffect(() => {
    if (!modelMenuOpen) return
    modelMenuScrollRef.current?.querySelector('.model-picker-option.is-selected')?.scrollIntoView({ block: 'nearest' })
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
    if (!providerStatsPopoverOpen) return
    function handleClickOutside(e: MouseEvent): void {
      if (providerStatsPopoverRef.current && !providerStatsPopoverRef.current.contains(e.target as Node)) {
        setProviderStatsPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [providerStatsPopoverOpen])

  useEffect(() => {
    setItems([])
    setLoadingHistory(true)
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
    setThinkingInfo(null)
    setMessageHistoryIndex(-1)
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
      } else if (event.type === 'tool_denied') {
        setThinking(false)
        setBusy(false)
        setItems((prev) => [...prev, { kind: 'denied', id: newId(), toolName: event.toolName, input: event.input }])
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
        setLoadingHistory(false)
      } else if (event.type === 'model') {
        // The 'model' event itself doesn't carry providerName (sessionHandlers.ts
        // only knows provider/id/name at that point) -- look it up from the
        // already-fetched models list, falling back to the raw provider id
        // if that list hasn't loaded yet.
        const matched = modelsRef.current.find((m) => m.provider === event.provider && m.id === event.id)
        setCurrentModel(
          matched ?? {
            provider: event.provider,
            providerName: event.provider,
            id: event.id,
            name: event.name,
            contextWindow: 0,
            maxTokens: 0,
            reasoning: false,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          }
        )
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
    // Typing "/" opens the skill picker inline -- clicking Send (the
    // textarea's own Enter key is intercepted earlier, before this ever
    // runs) should pick whichever row is currently highlighted rather than
    // sending "/query" as a literal message.
    if (input.startsWith('/')) {
      if (showSkillMenu) handleSelectSkill(filteredSkills[activeSkillIndex])
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

  async function handleSelectPassport(passport: Passport): Promise<void> {
    setPassportMenuOpen(false)
    if (passport.isActive) return
    await window.api.passports.setActive(passport.id)
    const freshPassports = await window.api.passports.list()
    setPassports(freshPassports)
    // setActive() already refreshes the backend's model registry -- refetch
    // here so this session's own model list reflects it immediately rather
    // than waiting for the next Settings-close-triggered refresh.
    const freshModels = await window.api.models.list()
    setModels(freshModels)
    const modelForProvider = freshModels.find((m) => m.provider === passport.providerId)
    if (modelForProvider) handleModelChange(modelForProvider)
  }

  function handleSelectSkill(skill: SkillInfo): void {
    setSelectedSkill(skill)
    setSkillMenuOpen(false)
    // A skill picked while typing "/name" leaves the query behind as a chip
    // represents it now; a skill picked via the toolbar icon shouldn't
    // clobber whatever the user was otherwise typing.
    if (input.startsWith('/')) setInput('')
  }

  function handleRespondUiPrompt(requestId: string, value: string | boolean | undefined): void {
    const request = uiPromptRequests.find((r) => r.requestId === requestId)
    onRespondUiPrompt(requestId, value)
    if (!request) return
    const answerText =
      value === undefined
        ? 'cancelled'
        : request.kind === 'confirm'
          ? value
            ? 'Yes'
            : 'No'
          : String(value)
    setItems((prev) => [...prev, { kind: 'prompted', id: newId(), title: request.title, answerText }])
  }

  async function handleAttachFile(): Promise<void> {
    const path = await window.api.files.pickFile()
    if (path) setAttachedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
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
    // Reads the live policy fresh instead of trusting this component's own
    // `autoMode` -- that state is only synced on mount and whenever Settings
    // closes (see the modelsRefreshKey-keyed effect above), so it can drift
    // from reality if the per-tool switches in Settings changed since. Toggling
    // off a stale "already Manual" read would otherwise flip everything back
    // to fully auto-approved instead of actually turning it off.
    const policy = await window.api.approvals.getPolicy()
    const currentlyAllAuto = KNOWN_TOOL_NAMES.every((name) => policy.autoApprove[name])
    const next = !currentlyAllAuto
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

  useEffect(() => {
    setSkillHighlightIndex(0)
  }, [slashQuery])

  const filteredSkills =
    slashQuery === null
      ? skills
      : skills.filter(
          (s) =>
            s.name.toLowerCase().includes(slashQuery.toLowerCase()) ||
            s.description.toLowerCase().includes(slashQuery.toLowerCase())
        )
  const showSkillMenu = skills.length > 0 && (skillMenuOpen || slashQuery !== null) && filteredSkills.length > 0
  // Clamped rather than reset-via-effect -- keeps the highlight stable
  // (e.g. still pointing at the same relative row) as the filtered list
  // shrinks/grows while typing, only snapping back when it'd go out of
  // bounds entirely.
  const activeSkillIndex = Math.min(skillHighlightIndex, filteredSkills.length - 1)

  // An in-progress "@mention" is the trailing "@word" at the end of
  // whatever's been typed so far -- unlike "/", it can start anywhere in
  // the message, not just at position 0.
  const atMatch = input.match(/@(\S*)$/)
  const atQuery = atMatch ? atMatch[1] : null

  useEffect(() => {
    setFileHighlightIndex(0)
  }, [atQuery])

  const filteredFiles = atQuery === null ? [] : fuzzyFilterFiles(repoFiles, atQuery).slice(0, 20)
  const showFileMenu = atQuery !== null && atQuery !== fileMenuDismissedFor
  const activeFileIndex = Math.min(fileHighlightIndex, Math.max(0, filteredFiles.length - 1))

  function handleSelectFile(path: string): void {
    setAttachedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
    setInput((prev) => prev.replace(/@\S*$/, ''))
  }

  function handleRemoveAttachedFile(path: string): void {
    setAttachedFiles((prev) => prev.filter((p) => p !== path))
  }

  // Derived from the already-loaded transcript (not a separate log) so
  // recall works immediately after reopening a session, not just for
  // messages sent this run.
  const userMessageHistory = items.filter((i) => i.kind === 'user').map((i) => i.text)

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

  function providerNameFor(providerId: string): string {
    return models.find((m) => m.provider === providerId)?.providerName ?? providerId
  }
  const passportGroups: { providerName: string; passports: Passport[] }[] = []
  for (const p of passports) {
    const providerName = providerNameFor(p.providerId)
    const group = passportGroups.find((g) => g.providerName === providerName)
    if (group) group.passports.push(p)
    else passportGroups.push({ providerName, passports: [p] })
  }
  const activePassportForCurrentModel = currentModel
    ? passports.find((p) => p.providerId === currentModel.provider && p.isActive)
    : undefined

  // The override slider's ceiling should reflect what the current model can
  // actually support, not a fixed guess -- CONTEXT_WINDOW_MAX only covers
  // the case where the model list hasn't loaded yet.
  const contextWindowMax =
    currentModel?.contextWindow && currentModel.contextWindow > 0 ? currentModel.contextWindow : CONTEXT_WINDOW_MAX

  return (
    <ZoomViewerProvider>
      <div className="chat">
      <div className="chat-scroll" ref={chatScrollRef}>
        {loadingHistory ? null : visibleItems.length === 0 && !thinking ? (
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
      <ApprovalPanel requests={approvalRequests} onRespond={onRespondApproval} />
      <UiPromptPanel requests={uiPromptRequests} onRespond={handleRespondUiPrompt} />
      <div className={`composer${busy ? ' is-busy' : ''}`} ref={skillPickerRef}>
        {showSkillMenu && (
          <div className="skill-picker-menu" role="listbox">
            {filteredSkills.map((skill, index) => (
              <button
                key={skill.filePath}
                type="button"
                role="option"
                aria-selected={index === activeSkillIndex}
                className={`skill-picker-option${index === activeSkillIndex ? ' is-active' : ''}`}
                ref={(el) => {
                  if (index === activeSkillIndex) el?.scrollIntoView({ block: 'nearest' })
                }}
                onMouseEnter={() => setSkillHighlightIndex(index)}
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
        {showFileMenu && (
          <div className="file-picker-menu" role="listbox">
            {filteredFiles.length === 0 ? (
              <div className="file-picker-empty">No matching files</div>
            ) : (
              filteredFiles.map((path, index) => {
                const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
                const fileName = slash === -1 ? path : path.slice(slash + 1)
                const dirName = slash === -1 ? null : path.slice(0, slash)
                return (
                  <button
                    key={path}
                    type="button"
                    role="option"
                    aria-selected={index === activeFileIndex}
                    className={`file-picker-option${index === activeFileIndex ? ' is-active' : ''}`}
                    ref={(el) => {
                      if (index === activeFileIndex) el?.scrollIntoView({ block: 'nearest' })
                    }}
                    onMouseEnter={() => setFileHighlightIndex(index)}
                    onClick={() => handleSelectFile(path)}
                  >
                    <span className="file-picker-option-icon">
                      <FilePickerIcon path={path} />
                    </span>
                    <span className="file-picker-option-name">{fileName}</span>
                    {dirName && <span className="file-picker-option-dir">{dirName}</span>}
                  </button>
                )
              })
            )}
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
          {passports.length > 0 && (
            <div className="model-picker" ref={passportPickerRef}>
              <button
                type="button"
                className="model-picker-trigger"
                onClick={() => setPassportMenuOpen((v) => !v)}
                title="Passport"
              >
                <span className="model-picker-label">
                  {activePassportForCurrentModel ? activePassportForCurrentModel.displayName : 'Passport…'}
                </span>
                <ChevronIcon className={`chevron model-picker-chevron${passportMenuOpen ? ' is-open' : ''}`} />
              </button>
              {passportMenuOpen && (
                <div className="model-picker-menu" role="listbox">
                  {passportGroups.map((group) => (
                    <div key={group.providerName} className="model-picker-group">
                      <div className="model-picker-group-label">
                        <span className={`model-provider-icon is-${group.passports[0].providerId}`}>
                          <ProviderMark provider={group.passports[0].providerId} providerName={group.providerName} />
                        </span>
                        {group.providerName}
                      </div>
                      {group.passports.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={p.isActive}
                          className={`model-picker-option${p.isActive ? ' is-selected' : ''}`}
                          onClick={() => handleSelectPassport(p)}
                        >
                          {p.displayName}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                <div className="model-picker-menu" role="listbox" ref={modelMenuScrollRef}>
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
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setModelTooltip({ model: m, top: rect.top, left: rect.right + 6 })
                            }}
                            onMouseLeave={() => setModelTooltip(null)}
                          >
                            {m.name}
                          </button>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
              {modelMenuOpen && modelTooltip && (
                <div
                  className="model-config-tooltip"
                  style={{ position: 'fixed', top: modelTooltip.top, left: modelTooltip.left }}
                >
                  <div className="model-config-tooltip-header">
                    <span
                      className={`model-provider-icon model-config-tooltip-icon is-${modelTooltip.model.provider}`}
                    >
                      <ProviderMark
                        provider={modelTooltip.model.provider}
                        providerName={modelTooltip.model.providerName}
                      />
                    </span>
                    <div>
                      <div className="model-config-tooltip-title">{modelTooltip.model.name}</div>
                      <div className="model-config-tooltip-subtitle">{modelTooltip.model.providerName}</div>
                    </div>
                  </div>

                  <div className="model-config-tooltip-prices">
                    <div className="model-config-tooltip-price-card">
                      <span>Input</span>
                      <b>${modelTooltip.model.cost.input.toFixed(2)}</b>
                      <i>/ M tokens</i>
                    </div>
                    <div className="model-config-tooltip-price-card">
                      <span>Output</span>
                      <b>${modelTooltip.model.cost.output.toFixed(2)}</b>
                      <i>/ M tokens</i>
                    </div>
                  </div>
                  {modelTooltip.model.cost.cacheRead > 0 && (
                    <div className="model-config-tooltip-row is-muted">
                      <span>Cache read</span>
                      <b>${modelTooltip.model.cost.cacheRead.toFixed(2)} / M</b>
                    </div>
                  )}

                  <div className="model-config-tooltip-divider" />

                  <div className="model-config-tooltip-row">
                    <span>Context window</span>
                    <b>{modelTooltip.model.contextWindow.toLocaleString()}</b>
                  </div>
                  <div className="model-config-tooltip-row">
                    <span>Max output</span>
                    <b>{modelTooltip.model.maxTokens.toLocaleString()}</b>
                  </div>
                  <div
                    className="model-config-tooltip-context-bar"
                    title={`Max output is ${Math.round(
                      (modelTooltip.model.maxTokens / Math.max(modelTooltip.model.contextWindow, 1)) * 100
                    )}% of the context window`}
                  >
                    <span
                      style={{
                        width: `${Math.min(100, (modelTooltip.model.maxTokens / Math.max(modelTooltip.model.contextWindow, 1)) * 100)}%`
                      }}
                    />
                  </div>

                  <div className="model-config-tooltip-row" style={{ marginTop: '8px' }}>
                    <span>Reasoning</span>
                    <span className={`model-config-tooltip-badge${modelTooltip.model.reasoning ? ' is-on' : ''}`}>
                      {modelTooltip.model.reasoning ? 'Supported' : 'Not supported'}
                    </span>
                  </div>
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
                        max={contextWindowMax}
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
                            width: `${(((Number(contextWindowInput) || CONTEXT_WINDOW_MIN) - CONTEXT_WINDOW_MIN) / (contextWindowMax - CONTEXT_WINDOW_MIN)) * 100}%`
                          }}
                        />
                        <div
                          className="context-usage-window-thumb"
                          style={{
                            left: `${(((Number(contextWindowInput) || CONTEXT_WINDOW_MIN) - CONTEXT_WINDOW_MIN) / (contextWindowMax - CONTEXT_WINDOW_MIN)) * 100}%`
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
                  (() => {
                    const { input, output, cacheRead, cacheWrite, total } = sessionStats.tokens
                    const pct = (n: number): number => (total > 0 ? (n / total) * 100 : 0)
                    return (
                      <div className="session-stats-panel">
                        <div className="session-stats-mini-row">
                          <div className="session-stats-mini">
                            <span>Messages</span>
                            <b>{sessionStats.totalMessages.toLocaleString()}</b>
                          </div>
                          <div className="session-stats-mini">
                            <span>Tool calls</span>
                            <b>{sessionStats.toolCalls.toLocaleString()}</b>
                          </div>
                        </div>
                        <div className="session-stats-token-bar">
                          <span style={{ width: `${pct(input)}%`, background: 'var(--accent)' }} />
                          <span style={{ width: `${pct(output)}%`, background: 'var(--success)' }} />
                          <span style={{ width: `${pct(cacheRead)}%`, background: 'var(--fg-faint)' }} />
                          <span style={{ width: `${pct(cacheWrite)}%`, background: 'var(--danger)' }} />
                        </div>
                        <div className="session-stats-token-legend">
                          <span>
                            <i style={{ background: 'var(--accent)' }} /> In {formatTokenCount(input)}
                          </span>
                          <span>
                            <i style={{ background: 'var(--success)' }} /> Out {formatTokenCount(output)}
                          </span>
                          {cacheRead > 0 && (
                            <span>
                              <i style={{ background: 'var(--fg-faint)' }} /> Cache R {formatTokenCount(cacheRead)}
                            </span>
                          )}
                          {cacheWrite > 0 && (
                            <span>
                              <i style={{ background: 'var(--danger)' }} /> Cache W {formatTokenCount(cacheWrite)}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })()
                ) : (
                  <div className="sidebar-empty">Loading…</div>
                )}
              </div>
            )}
          </div>
          {sessionQuota && (
            <div className="context-usage" ref={providerStatsPopoverRef}>
              <button
                type="button"
                className="composer-icon-badge"
                onClick={() => setProviderStatsPopoverOpen((v) => !v)}
                title="Provider stats"
              >
                ⛁
              </button>
              {providerStatsPopoverOpen &&
                (() => {
                  const premium = sessionQuota.categories.find((c) => c.id === 'premium_interactions')
                  if (!premium || premium.unlimited) return null
                  const usedPct = Math.max(0, Math.min(100, 100 - premium.percentRemaining))
                  return (
                    <div className="context-usage-popover">
                      <div className="context-usage-popover-header">
                        <h3>Provider stats</h3>
                      </div>
                      <p className="context-usage-caption">
                        Real usage reported by {currentModel?.providerName ?? 'the provider'} for this account, not
                        computed by PassCode.
                      </p>
                      <div className="session-stats-quota">
                        <span className="session-stats-quota-label">{sessionQuota.planName} premium quota</span>
                        <div className="session-stats-token-bar">
                          <span style={{ width: `${usedPct}%`, background: 'var(--accent)' }} />
                        </div>
                        <span className="session-stats-quota-value">{Math.round(usedPct)}% used</span>
                      </div>
                    </div>
                  )
                })()}
            </div>
          )}
        </div>
        {(selectedSkill || attachedFiles.length > 0 || pastedImages.length > 0) && (
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
            {attachedFiles.map((path) => (
              <span key={path} className="composer-chip">
                <PlusIcon /> {path.split(/[/\\]/).pop()}
                <button
                  type="button"
                  className="composer-chip-remove"
                  onClick={() => handleRemoveAttachedFile(path)}
                  title="Remove attachment"
                >
                  ×
                </button>
              </span>
            ))}
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
          onChange={(e) => {
            setInput(e.target.value)
            // A real keystroke, not our own history-recall setInput call
            // (which never fires this handler) -- typing means composing
            // fresh, so stop treating up/down as history recall until the
            // box is empty again.
            setMessageHistoryIndex(-1)
          }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (showFileMenu) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (filteredFiles.length > 0) setFileHighlightIndex((i) => (i + 1) % filteredFiles.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (filteredFiles.length > 0) {
                  setFileHighlightIndex((i) => (i - 1 + filteredFiles.length) % filteredFiles.length)
                }
                return
              }
              if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) || e.key === 'Tab') {
                if (filteredFiles.length > 0) {
                  e.preventDefault()
                  handleSelectFile(filteredFiles[activeFileIndex])
                }
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setFileMenuDismissedFor(atQuery)
                return
              }
            } else if (showSkillMenu) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSkillHighlightIndex((i) => (i + 1) % filteredSkills.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSkillHighlightIndex((i) => (i - 1 + filteredSkills.length) % filteredSkills.length)
                return
              }
              if ((e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) || e.key === 'Tab') {
                e.preventDefault()
                handleSelectSkill(filteredSkills[activeSkillIndex])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setSkillMenuOpen(false)
                if (input.startsWith('/')) setInput('')
                return
              }
            } else if (e.key === 'ArrowUp' && !e.shiftKey && !e.ctrlKey) {
              // Recall: only kicks in from an empty box (so it never fights
              // normal cursor movement while editing real multi-line text),
              // but once recalling, keeps working even though the box is no
              // longer empty -- it's now showing history, not a draft.
              if (messageHistoryIndex === -1 && input !== '') return
              if (userMessageHistory.length === 0) return
              const nextIndex =
                messageHistoryIndex === -1 ? userMessageHistory.length - 1 : Math.max(0, messageHistoryIndex - 1)
              e.preventDefault()
              setMessageHistoryIndex(nextIndex)
              setInput(userMessageHistory[nextIndex])
              return
            } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.ctrlKey && messageHistoryIndex !== -1) {
              e.preventDefault()
              const nextIndex = messageHistoryIndex + 1
              if (nextIndex >= userMessageHistory.length) {
                setMessageHistoryIndex(-1)
                setInput('')
              } else {
                setMessageHistoryIndex(nextIndex)
                setInput(userMessageHistory[nextIndex])
              }
              return
            }
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
  if (item.kind === 'denied') {
    const summary = summarizeToolCall(item.toolName, item.input)
    return (
      <div className="chat-line is-denied">
        <span className="denied-dot" />
        <span className="denied-title">Skipped</span>
        <span className="denied-summary">
          {item.toolName}
          {summary ? ` · ${summary}` : ''}
        </span>
        <span className="denied-caption">turn stopped</span>
      </div>
    )
  }
  if (item.kind === 'prompted') {
    return (
      <div className="chat-line is-denied">
        <span className="denied-dot" />
        <span className="denied-title">Asked</span>
        <span className="denied-summary">{item.title}</span>
        <span className="denied-caption">{item.answerText}</span>
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

function formatUsage(usage: TokenUsage | undefined, scope: 'model response' | 'turn total' | undefined): string {
  if (!usage) return 'usage unavailable'
  const suffix = scope === 'turn total' ? ' turn' : ''
  const cached = usage.cacheRead + usage.cacheWrite
  const cachedSuffix = cached > 0 ? ` (+${formatTokenCount(cached)} cached)` : ''
  return `${formatTokenCount(usage.input)} in / ${formatTokenCount(usage.output)} out${cachedSuffix}${suffix}`
}

function formatActionMetrics(
  duration: string | null,
  usage: TokenUsage | undefined,
  scope: 'model response' | 'turn total' | undefined
): string {
  return `${duration ?? 'running'} · ${formatUsage(usage, scope)}`
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
  if (provider === 'openai-codex') return <OpenAIIcon />
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
