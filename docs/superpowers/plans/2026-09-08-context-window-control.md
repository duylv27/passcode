# Context Window Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live context-window usage in the composer toolbar (a ring badge + percentage/tokens), and let the user manually trigger compaction and toggle auto-compaction, backed directly by the SDK's own `AgentSession` methods.

**Architecture:** `RepoSession` (the app's thin wrapper around the SDK's `AgentSession`) gains four new delegating methods. `sessionHandlers.ts`'s existing event-forwarding pipeline gains two new `ChatEvent` variants and re-checks context usage at the two moments it can actually change (turn completion, compaction completion). The renderer adds a small popover, following the exact pattern the existing model-picker popover already uses.

**Tech Stack:** TypeScript, Electron IPC, `@earendil-works/pi-coding-agent`'s `AgentSession.getContextUsage()`/`compact()`/`setAutoCompactionEnabled()`/`autoCompactionEnabled`/`settingsManager`, React, Vitest.

## Global Constraints

- No adjustable compaction thresholds — `SettingsManager.getCompactionReserveTokens()`/`getCompactionKeepRecentTokens()` have no corresponding setters in this SDK version. These two values are read-only display in this feature; never written.
- The auto-compact toggle controls `AgentSession.setAutoCompactionEnabled()` (the session's live, in-memory setting), NOT `SettingsManager.setCompactionEnabled()` (the persisted global/project default) — toggling it affects only the currently open session.
- Color bands for the ring/meter, using semantic color kept separate from the app's `--accent` token: `< 60%` → `--success`, `60–85%` → `--warning` (a new token, added per theme variant, not a single hardcoded amber), `> 85%` → `--danger`.
- When `getContextUsage()` returns `undefined` (no model selected yet, or briefly after compaction), the UI shows a neutral placeholder — never a stale or fabricated number.
- No renderer automated tests (this repo has no jsdom harness) — the renderer task is verified by typecheck + manual click-through, matching this app's existing pattern.

---

## Task 1: `RepoSession` context-window methods

**Files:**
- Modify: `src/shared/types.ts:88-91` (add `ContextUsage`/`CompactionThresholds` near `TokenUsage`), `:107-121` (`ChatEvent`)
- Modify: `src/main/agent/piSession.ts`
- Test: `tests/main/agent/piSession.test.ts`

**Interfaces:**
- Produces: `ContextUsage { tokens: number | null; contextWindow: number; percent: number | null }`, `CompactionThresholds { reserveTokens: number; keepRecentTokens: number }` (both in `src/shared/types.ts`), and `RepoSession`'s four new methods: `getContextUsage(): ContextUsage | undefined`, `compact(): Promise<void>`, `getAutoCompactionEnabled(): boolean`, `setAutoCompactionEnabled(enabled: boolean): void`, `getCompactionThresholds(): CompactionThresholds` — all consumed by Task 2's `sessionHandlers.ts`. Also produces `ChatEvent`'s three new variants (`context_usage`, `compaction_status`, `auto_compaction`), consumed by Tasks 2 and 4.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/agent/piSession.test.ts`. First, extend the mocked `session` object in the file's `createAgentSessionMock` (currently lines 10-21) to add the new mock functions/values needed by these tests. Add these `vi.fn()` declarations near the existing `promptMock`/`abortMock`/etc. declarations (top of file, before `createAgentSessionMock`):

```typescript
const getContextUsageMock = vi.fn(() => ({ tokens: 12345, contextWindow: 200000, percent: 6.17 }))
const compactMock = vi.fn(async () => ({}))
const setAutoCompactionEnabledMock = vi.fn()
let mockAutoCompactionEnabled = true
const getCompactionReserveTokensMock = vi.fn(() => 16384)
const getCompactionKeepRecentTokensMock = vi.fn(() => 20000)
```

Then update `createAgentSessionMock`'s returned `session` object (currently lines 10-21) to include them:

```typescript
const createAgentSessionMock = vi.fn(async () => ({
  session: {
    prompt: promptMock,
    subscribe: subscribeMock,
    abort: abortMock,
    sessionId: 'pi-session-1',
    sessionManager: { getSessionFile: getSessionFileMock },
    agent: { state: { get messages() { return mockMessages } } },
    get model() { return mockModel },
    setModel: setModelMock,
    getContextUsage: getContextUsageMock,
    compact: compactMock,
    get autoCompactionEnabled() { return mockAutoCompactionEnabled },
    setAutoCompactionEnabled: setAutoCompactionEnabledMock,
    settingsManager: {
      getCompactionReserveTokens: getCompactionReserveTokensMock,
      getCompactionKeepRecentTokens: getCompactionKeepRecentTokensMock
    }
  }
}))
```

Reset `mockAutoCompactionEnabled = true` in the existing `beforeEach` block, alongside the existing `mockMessages = []`/`mockModel = {...}` resets.

Then add these tests inside the `describe('createRepoSession', ...)` block:

```typescript
  it('exposes the current context usage from the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getContextUsage()).toEqual({ tokens: 12345, contextWindow: 200000, percent: 6.17 })
  })

  it('forwards compact to the underlying session and discards its result', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    await expect(repoSession.compact()).resolves.toBeUndefined()
    expect(compactMock).toHaveBeenCalled()
  })

  it('reads the current auto-compaction setting from the underlying session', async () => {
    mockAutoCompactionEnabled = false
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getAutoCompactionEnabled()).toBe(false)
  })

  it('forwards setAutoCompactionEnabled to the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    repoSession.setAutoCompactionEnabled(false)
    expect(setAutoCompactionEnabledMock).toHaveBeenCalledWith(false)
  })

  it('reads compaction thresholds from the underlying session settings manager', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getCompactionThresholds()).toEqual({ reserveTokens: 16384, keepRecentTokens: 20000 })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/agent/piSession.test.ts`
Expected: FAIL — `repoSession.getContextUsage is not a function` (and similarly for the other four new methods)

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, add right after the existing `TokenUsage` interface (currently lines 88-91):

```typescript
export interface ContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

export interface CompactionThresholds {
  reserveTokens: number
  keepRecentTokens: number
}
```

Add three new variants to `ChatEvent` (currently lines 107-121), right after the existing `{ type: 'busy'; busy: boolean }` line:

```typescript
export type ChatEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_end' }
  | { type: 'model_usage'; usage: TokenUsage }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: unknown; usage?: TokenUsage }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; result: unknown }
  | { type: 'turn_end'; usage?: TokenUsage }
  | { type: 'error'; message: string }
  | { type: 'history'; items: HistoryItem[] }
  | { type: 'model'; provider: string; id: string; name: string }
  /** Sent when a session is (re)opened so the UI can restore the stop
   * button/busy indicator if a turn was already in flight -- e.g. after
   * switching tabs and back while the agent was still running. */
  | { type: 'busy'; busy: boolean }
  /** Sent whenever context usage can actually have changed -- after a
   * turn completes and after a compaction finishes -- not polled. */
  | { type: 'context_usage'; usage: ContextUsage }
  | { type: 'compaction_status'; status: 'start' | 'end' }
  /** Sent once per session open/switch, reflecting the session's current
   * (in-memory, not persisted) auto-compaction setting. */
  | { type: 'auto_compaction'; enabled: boolean }
```

- [ ] **Step 4: Implement the `RepoSession` additions**

In `src/main/agent/piSession.ts`, update the import line:

```typescript
import type { CompactionThresholds, ContextUsage, HistoryItem, TokenUsage } from '../../shared/types'
```

Add the four new methods to the `RepoSession` interface:

```typescript
export interface RepoSession {
  prompt(text: string, images?: ImageContent[]): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
  /** The conversation loaded so far -- empty for a brand-new session, populated when resumed. */
  getHistory(): HistoryItem[]
  getModel(): Model<any> | undefined
  setModel(model: Model<any>): Promise<void>
  getContextUsage(): ContextUsage | undefined
  /** Result discarded -- the caller learns completion via the
   * 'compaction_status' event forwarded from the same subscription,
   * not this call's own resolution. */
  compact(): Promise<void>
  getAutoCompactionEnabled(): boolean
  setAutoCompactionEnabled(enabled: boolean): void
  getCompactionThresholds(): CompactionThresholds
}
```

Add the implementations inside the returned `repoSession` object (currently lines 68-80), alongside the existing methods:

```typescript
    repoSession: {
      // "steer" interrupts an in-flight turn with this message rather than
      // requiring the caller to wait or queue -- streamingBehavior is only
      // consulted when a turn is actually in flight, so this is a no-op
      // otherwise and safe to always pass.
      prompt: (text: string, images?: ImageContent[]) =>
        session.prompt(text, { images, streamingBehavior: 'steer' }),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort(),
      getHistory: () => buildHistory(session.agent.state.messages),
      getModel: () => session.model,
      setModel: (model: Model<any>) => session.setModel(model),
      getContextUsage: () => session.getContextUsage(),
      compact: async () => {
        await session.compact()
      },
      getAutoCompactionEnabled: () => session.autoCompactionEnabled,
      setAutoCompactionEnabled: (enabled: boolean) => session.setAutoCompactionEnabled(enabled),
      getCompactionThresholds: () => ({
        reserveTokens: session.settingsManager.getCompactionReserveTokens(),
        keepRecentTokens: session.settingsManager.getCompactionKeepRecentTokens()
      })
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/agent/piSession.test.ts`
Expected: PASS (22 tests: 17 existing + 5 new)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/agent/piSession.ts tests/main/agent/piSession.test.ts
git commit -m "feat: add context-usage and compaction control to RepoSession"
```

---

## Task 2: Wire context-usage events and compaction controls into `sessionHandlers.ts`

**Files:**
- Modify: `src/main/ipc/sessionHandlers.ts`
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `RepoSession.getContextUsage()`/`compact()`/`getAutoCompactionEnabled()`/`setAutoCompactionEnabled()`/`getCompactionThresholds()` and the three new `ChatEvent` variants from Task 1.
- Produces: `SessionHandlers`' four new methods (`compactSession`, `getAutoCompactionEnabled`, `setAutoCompactionEnabled`, `getCompactionThresholds`) — consumed by Task 3's IPC wiring.

- [ ] **Step 1: Write the failing tests**

In `tests/main/ipc/sessionHandlers.test.ts`, extend the shared `repoSession` object built in the file's `beforeEach` (currently lines 57-67) to include the four new `RepoSession` methods with safe defaults -- every existing test that calls `openSession()` exercises `emitCurrentState`, which will unconditionally call `getAutoCompactionEnabled()` and `getContextUsage()` once this task lands, so leaving them undefined would throw at runtime in every one of those tests, not just new ones. (Confirmed safe against every existing assertion on the `events` array: none of them assert an exact array length or exact array equality across a full `openSession()` call -- they either filter by `event.type` or use `toContainEqual`.)

Add these declarations at `describe`-level, alongside the existing `let promptMock`/`let abortMock`/etc.:

```typescript
  let compactMock: ReturnType<typeof vi.fn>
  let getAutoCompactionEnabledMock: ReturnType<typeof vi.fn>
  let setAutoCompactionEnabledMock: ReturnType<typeof vi.fn>
  let getCompactionThresholdsMock: ReturnType<typeof vi.fn>
  let contextUsage: import('../../../src/shared/types').ContextUsage | undefined
```

Inside `beforeEach`, right after the existing `subscribeListener = undefined` line, add:

```typescript
    compactMock = vi.fn(async () => {})
    getAutoCompactionEnabledMock = vi.fn(() => false)
    setAutoCompactionEnabledMock = vi.fn()
    getCompactionThresholdsMock = vi.fn(() => ({ reserveTokens: 16384, keepRecentTokens: 20000 }))
    contextUsage = undefined
```

Update the `repoSession` object literal (currently lines 57-67) to include the five new methods:

```typescript
    const repoSession: RepoSession = {
      prompt: promptMock,
      subscribe: (listener) => {
        subscribeListener = listener
        return () => {}
      },
      abort: abortMock,
      getHistory: () => historyItems,
      getModel: () => currentModel,
      setModel: setModelMock,
      getContextUsage: () => contextUsage,
      compact: compactMock,
      getAutoCompactionEnabled: getAutoCompactionEnabledMock,
      setAutoCompactionEnabled: setAutoCompactionEnabledMock,
      getCompactionThresholds: getCompactionThresholdsMock
    }
```

Then add these tests inside the `describe('sessionHandlers', ...)` block:

```typescript
  it('emits context_usage on session open when the underlying session reports usage', async () => {
    contextUsage = { tokens: 500, contextWindow: 200000, percent: 0.25 }
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'context_usage', usage: { tokens: 500, contextWindow: 200000, percent: 0.25 } }
    })
  })

  it('does not emit context_usage on session open when the underlying session reports no usage yet', async () => {
    contextUsage = undefined
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events.find((e) => e.event.type === 'context_usage')).toBeUndefined()
  })

  it('emits the current auto-compaction setting on session open', async () => {
    getAutoCompactionEnabledMock.mockReturnValue(true)
    const session = handlers.createSession(repoId)

    await handlers.openSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'auto_compaction', enabled: true }
    })
  })

  it('maps compaction_start/compaction_end SDK events to compaction_status, and re-emits context_usage after compaction_end', async () => {
    contextUsage = { tokens: 100, contextWindow: 200000, percent: 0.05 }
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    subscribeListener?.({ type: 'compaction_start', reason: 'manual' })
    subscribeListener?.({ type: 'compaction_end', reason: 'manual', result: {}, aborted: false, willRetry: false })

    expect(events).toContainEqual({ sessionId: session.id, event: { type: 'compaction_status', status: 'start' } })
    expect(events).toContainEqual({ sessionId: session.id, event: { type: 'compaction_status', status: 'end' } })
    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'context_usage', usage: { tokens: 100, contextWindow: 200000, percent: 0.05 } }
    })
  })

  it('re-emits context_usage after a turn ends', async () => {
    contextUsage = { tokens: 42, contextWindow: 200000, percent: 0.02 }
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    events.length = 0

    subscribeListener?.({ type: 'turn_end' })

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'context_usage', usage: { tokens: 42, contextWindow: 200000, percent: 0.02 } }
    })
  })

  it('compacts a session via compactSession', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.compactSession(session.id)

    expect(compactMock).toHaveBeenCalled()
  })

  it('reports a compaction error via the error event rather than throwing', async () => {
    compactMock.mockRejectedValueOnce(new Error('compaction aborted'))
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.compactSession(session.id)

    expect(events).toContainEqual({
      sessionId: session.id,
      event: { type: 'error', message: 'compaction aborted' }
    })
  })

  it('reads and writes the auto-compaction setting', async () => {
    getAutoCompactionEnabledMock.mockReturnValue(true)
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    expect(await handlers.getAutoCompactionEnabled(session.id)).toBe(true)

    await handlers.setAutoCompactionEnabled(session.id, false)
    expect(setAutoCompactionEnabledMock).toHaveBeenCalledWith(false)
  })

  it('reads compaction thresholds', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    expect(await handlers.getCompactionThresholds(session.id)).toEqual({
      reserveTokens: 16384,
      keepRecentTokens: 20000
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: FAIL — `handlers.compactSession is not a function` (and similar for the other new methods/events)

- [ ] **Step 3: Implement the event-pipeline changes**

In `src/main/ipc/sessionHandlers.ts`, update the `mapAgentEvent` function's parameter type and add two new cases. Find:

```typescript
function mapAgentEvent(event: unknown): ChatEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolCallId?: string
    toolName?: string
    args?: unknown
    result?: unknown
    isError?: boolean
    message?: { role?: string; usage?: { input: number; output: number } }
  }
```

Change to:

```typescript
function mapAgentEvent(event: unknown): ChatEvent | null {
  const e = event as {
    type?: string
    assistantMessageEvent?: { type?: string; delta?: string }
    toolCallId?: string
    toolName?: string
    args?: unknown
    result?: unknown
    isError?: boolean
    message?: { role?: string; usage?: { input: number; output: number } }
  }
  if (e.type === 'compaction_start') {
    return { type: 'compaction_status', status: 'start' }
  }
  if (e.type === 'compaction_end') {
    return { type: 'compaction_status', status: 'end' }
  }
```

(Add these two `if` blocks right after the function's opening `const e = ...` cast -- placement relative to the other `if` blocks in this function doesn't matter, since each checks a distinct `e.type` value and returns early.)

- [ ] **Step 4: Re-check context usage after a turn or a compaction finishes**

In `src/main/ipc/sessionHandlers.ts`'s `ensureSession`, find the `subscribe` callback (currently lines 90-113):

```typescript
    let pendingActionUsage: TokenUsage | undefined
    repoSession.subscribe((event) => {
      const mapped = mapAgentEvent(event)
      if (!mapped) return
      if (mapped.type === 'model_usage') {
        pendingActionUsage = mapped.usage
        if (deps.getUsageTelemetryConfig) {
          const model = repoSession.getModel()
          if (model) {
            appendUsageTelemetryRecord(deps.getUsageTelemetryConfig(), {
              model: { provider: model.provider, id: model.id, name: model.name },
              usage: mapped.usage,
              sessionId: piSessionId
            })
          }
        }
        return
      }
      if (mapped.type === 'tool_start') {
        deps.onEvent(sessionId, { ...mapped, usage: pendingActionUsage })
        return
      }
      if (mapped.type === 'turn_end') pendingActionUsage = undefined
      deps.onEvent(sessionId, mapped)
    })
```

Replace the final three lines (`if (mapped.type === 'turn_end') ...` through the closing `})`) with:

```typescript
      if (mapped.type === 'turn_end') pendingActionUsage = undefined
      deps.onEvent(sessionId, mapped)
      // Context usage only actually changes at these two moments -- a real
      // response completing, or a compaction finishing -- so re-checking
      // here keeps the composer's badge live with no polling.
      if (mapped.type === 'turn_end' || (mapped.type === 'compaction_status' && mapped.status === 'end')) {
        const usage = repoSession.getContextUsage()
        if (usage) deps.onEvent(sessionId, { type: 'context_usage', usage })
      }
    })
```

- [ ] **Step 5: Emit initial context usage and auto-compaction state on session open**

Find `emitCurrentState` (currently lines 122-130):

```typescript
  function emitCurrentState(sessionId: string, repoSession: RepoSession): void {
    const history = repoSession.getHistory()
    if (history.length > 0) deps.onEvent(sessionId, { type: 'history', items: history })

    const model = repoSession.getModel()
    if (model) deps.onEvent(sessionId, { type: 'model', provider: model.provider, id: model.id, name: model.name })

    deps.onEvent(sessionId, { type: 'busy', busy: busySessions.has(sessionId) })
  }
```

Replace with:

```typescript
  function emitCurrentState(sessionId: string, repoSession: RepoSession): void {
    const history = repoSession.getHistory()
    if (history.length > 0) deps.onEvent(sessionId, { type: 'history', items: history })

    const model = repoSession.getModel()
    if (model) deps.onEvent(sessionId, { type: 'model', provider: model.provider, id: model.id, name: model.name })

    const usage = repoSession.getContextUsage()
    if (usage) deps.onEvent(sessionId, { type: 'context_usage', usage })

    deps.onEvent(sessionId, { type: 'auto_compaction', enabled: repoSession.getAutoCompactionEnabled() })

    deps.onEvent(sessionId, { type: 'busy', busy: busySessions.has(sessionId) })
  }
```

- [ ] **Step 6: Add the four new `SessionHandlers` methods**

First, update the top-of-file type import (currently lines 8-19) to add `CompactionThresholds`:

```typescript
import type {
  ChatEvent,
  CompactionThresholds,
  CreateProjectSessionError,
  CreateProjectSessionResult,
  Project,
  PromptOptions,
  Repo,
  SessionRecord,
  SessionWithScope,
  TokenUsage,
  UsageTelemetryConfig
} from '../../shared/types'
```

Add to the `SessionHandlers` interface (currently lines 43-56), after `setSessionModel`:

```typescript
  setSessionModel(sessionId: string, provider: string, modelId: string): Promise<void>
  compactSession(sessionId: string): Promise<void>
  getAutoCompactionEnabled(sessionId: string): Promise<boolean>
  setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void>
  getCompactionThresholds(sessionId: string): Promise<CompactionThresholds>
```

Add the four implementations inside the returned object (currently ending at `setSessionModel`'s closing brace, right before the final `}` that closes the returned object), following the existing `abortSession`/`setSessionModel` error-handling pattern:

```typescript
    async compactSession(sessionId: string): Promise<void> {
      try {
        const session = await ensureSession(sessionId)
        await session.compact()
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      }
    },
    async getAutoCompactionEnabled(sessionId: string): Promise<boolean> {
      const session = await ensureSession(sessionId)
      return session.getAutoCompactionEnabled()
    },
    async setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void> {
      const session = await ensureSession(sessionId)
      session.setAutoCompactionEnabled(enabled)
    },
    async getCompactionThresholds(sessionId: string): Promise<CompactionThresholds> {
      const session = await ensureSession(sessionId)
      return session.getCompactionThresholds()
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: PASS (all tests, including the 9 new ones)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc/sessionHandlers.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "feat: forward context-usage events and compaction controls"
```

---

## Task 3: IPC surface

**Files:**
- Modify: `src/shared/types.ts:190-207` (`Api.session`)
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts:17-37` (`session` bridge)

**Interfaces:**
- Consumes: `SessionHandlers.compactSession`/`getAutoCompactionEnabled`/`setAutoCompactionEnabled`/`getCompactionThresholds` from Task 2.
- Produces: `Api.session.compact`/`getAutoCompactionEnabled`/`setAutoCompactionEnabled`/`getCompactionThresholds` — consumed by Task 4's `ChatPanel.tsx`.

- [ ] **Step 1: Extend the shared `Api` type**

In `src/shared/types.ts`, extend `Api.session` (currently lines 190-207) by adding four methods after `setModel`:

```typescript
  session: {
    list(repoId: string): Promise<SessionRecord[]>
    create(repoId: string, title?: string): Promise<SessionRecord>
    listByProject(projectId: string): Promise<SessionRecord[]>
    createProjectSession(
      projectId: string,
      title?: string
    ): Promise<CreateProjectSessionResult | CreateProjectSessionError>
    getMostRecent(): Promise<{ session: SessionRecord; repo: Repo; project: Project | null } | null>
    listAll(): Promise<SessionWithScope[]>
    rename(sessionId: string, title: string): Promise<void>
    delete(sessionId: string): Promise<void>
    open(sessionId: string): Promise<void>
    prompt(sessionId: string, text: string, options?: PromptOptions): Promise<void>
    abort(sessionId: string): Promise<void>
    setModel(sessionId: string, provider: string, modelId: string): Promise<void>
    compact(sessionId: string): Promise<void>
    getAutoCompactionEnabled(sessionId: string): Promise<boolean>
    setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void>
    getCompactionThresholds(sessionId: string): Promise<CompactionThresholds>
    onEvent(listener: (sessionId: string, event: ChatEvent) => void): () => void
  }
```

- [ ] **Step 2: Wire the IPC channels**

In `src/main/ipc/register.ts`, add these four lines right after the existing `session:setModel` handler registration (currently lines 61-63):

```typescript
  ipcMain.handle('session:compact', (_e, sessionId: string) => handlers.session.compactSession(sessionId))
  ipcMain.handle('session:getAutoCompactionEnabled', (_e, sessionId: string) =>
    handlers.session.getAutoCompactionEnabled(sessionId)
  )
  ipcMain.handle('session:setAutoCompactionEnabled', (_e, sessionId: string, enabled: boolean) =>
    handlers.session.setAutoCompactionEnabled(sessionId, enabled)
  )
  ipcMain.handle('session:getCompactionThresholds', (_e, sessionId: string) =>
    handlers.session.getCompactionThresholds(sessionId)
  )
```

- [ ] **Step 3: Wire the preload bridge**

In `src/preload/index.ts`, add to the `session` object (currently lines 17-37), right after the existing `setModel` line:

```typescript
    setModel: (sessionId, provider, modelId) =>
      ipcRenderer.invoke('session:setModel', sessionId, provider, modelId),
    compact: (sessionId) => ipcRenderer.invoke('session:compact', sessionId),
    getAutoCompactionEnabled: (sessionId) => ipcRenderer.invoke('session:getAutoCompactionEnabled', sessionId),
    setAutoCompactionEnabled: (sessionId, enabled) =>
      ipcRenderer.invoke('session:setAutoCompactionEnabled', sessionId, enabled),
    getCompactionThresholds: (sessionId) => ipcRenderer.invoke('session:getCompactionThresholds', sessionId),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/ipc/register.ts src/preload/index.ts
git commit -m "feat: expose context-usage and compaction controls over IPC"
```

---

## Task 4: Composer ring badge + popover

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.session.compact`/`getAutoCompactionEnabled`/`setAutoCompactionEnabled`/`getCompactionThresholds`, the `context_usage`/`compaction_status`/`auto_compaction` `ChatEvent` variants, and `ContextUsage`/`CompactionThresholds` from Task 3's `src/shared/types.ts`.

- [ ] **Step 1: Import types and add state**

In `src/renderer/src/components/ChatPanel.tsx`, update the type import line to add `CompactionThresholds` and `ContextUsage`:

```typescript
import type {
  ChatEvent,
  CompactionThresholds,
  ContextUsage,
  HistoryItem,
  ModelInfo,
  SessionRecord,
  SkillInfo,
  TokenUsage
} from '../../../shared/types'
```

(Merge this into whatever the current multi-line type import from `'../../../shared/types'` already contains -- add the two new names alphabetically among the existing ones, don't create a second import statement.)

Add state and a ref alongside the existing `modelMenuOpen`/`modelPickerRef` declarations (currently lines 61-62):

```typescript
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)
  const [autoCompactEnabled, setAutoCompactEnabled] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactionThresholds, setCompactionThresholds] = useState<CompactionThresholds | null>(null)
  const [contextPopoverOpen, setContextPopoverOpen] = useState(false)
  const contextPopoverRef = useRef<HTMLDivElement>(null)
```

- [ ] **Step 2: Close the popover on outside click**

Add a new `useEffect`, alongside the existing `modelMenuOpen`/`skillMenuOpen` outside-click effects (currently lines 142-162):

```typescript
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
```

- [ ] **Step 3: Handle the three new events**

Find the `session:event` listener's `else if` chain (currently ending with the `busy` handler, around what's currently lines 340-345):

```typescript
      } else if (event.type === 'busy') {
        // Restores the stop button/pulsing state after switching away from
        // a session and back while a turn was still running server-side --
        // the reset above otherwise always leaves this false.
        setBusy(event.busy)
      }
    })
```

Replace with:

```typescript
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
      }
    })
```

Also reset `contextUsage`/`compacting`/`contextPopoverOpen` to their initial values in the same effect's top-of-block reset (find the block that currently does `setItems([]); setBusy(false); setThinking(false); setCurrentModel(null); turnActionIdsRef.current = []` on session switch, around lines 165-170) -- add:

```typescript
    setItems([])
    setBusy(false)
    setThinking(false)
    setCurrentModel(null)
    setContextUsage(null)
    setAutoCompactEnabled(false)
    setCompacting(false)
    setCompactionThresholds(null)
    setContextPopoverOpen(false)
    turnActionIdsRef.current = []
    window.api.session.open(session.id)
```

- [ ] **Step 4: Add handlers for the popover's actions**

Add these functions alongside the existing `handleToggleAuto`/`handleModelChange` functions:

```typescript
  async function handleOpenContextPopover(): Promise<void> {
    const next = !contextPopoverOpen
    setContextPopoverOpen(next)
    if (next && !compactionThresholds) {
      setCompactionThresholds(await window.api.session.getCompactionThresholds(session.id))
    }
  }

  async function handleCompactNow(): Promise<void> {
    if (compacting) return
    await window.api.session.compact(session.id)
  }

  async function handleToggleAutoCompaction(): Promise<void> {
    const next = !autoCompactEnabled
    setAutoCompactEnabled(next)
    await window.api.session.setAutoCompactionEnabled(session.id, next)
  }
```

- [ ] **Step 5: Add the color-band helper**

Add this pure function near the file's other small helpers (e.g. near `formatTokenCount`):

```typescript
function contextUsageBand(percent: number | null): 'success' | 'warning' | 'danger' | 'unknown' {
  if (percent === null) return 'unknown'
  if (percent >= 85) return 'danger'
  if (percent >= 60) return 'warning'
  return 'success'
}
```

- [ ] **Step 6: Render the badge and popover**

Find the `.composer-topbar` div's model-picker block (currently lines 515-556):

```jsx
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
              {/* ...existing model picker JSX, unchanged... */}
            </div>
          )}
        </div>
```

Add the context badge as a new sibling right after the `model-picker` div's closing `)}` , still inside `.composer-topbar`:

```jsx
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
                      disabled={compacting}
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
                </div>
              )}
            </div>
          )}
```

`Switch` here is the same small local component `SettingsPanel.tsx` defines for its own toggles (`{ checked, onChange }`) -- check whether `ChatPanel.tsx` already has an equivalent; if not, add this minimal one near the file's other small local components (e.g. near `StatusDot`/icon helpers):

```tsx
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
```

(The `.switch`/`.switch-track`/`.switch-thumb` CSS classes already exist in `theme.css` from the Settings panel's toggles -- no new CSS needed for the switch itself, only for the context-usage-specific classes below.)

- [ ] **Step 7: Add CSS**

In `src/renderer/src/theme.css`, first add one new token per theme variant. Find each theme's `:root`/`:root[data-theme='...']` block that already defines `--success`/`--danger` (there are five: the base light `:root` block, the dark block, Dracula, Nord, and High Contrast) and add a `--warning` line immediately after each block's `--success`/`--danger` pair, picking an amber that fits that theme's existing palette:

```css
/* Base light theme -- after --danger: #c0392b; */
  --warning: #a3690f;
```
```css
/* Dark theme -- after --danger: #f85149; */
  --warning: #d29922;
```
```css
/* Dracula -- after --danger: #ff5555; */
  --warning: #ffb86c;
```
```css
/* Nord -- after --danger: #bf616a; */
  --warning: #d08770;
```
```css
/* High Contrast -- after --danger: #ff3b3b; */
  --warning: #ffcc00;
```

(Locate each block by its existing `--success`/`--danger` lines rather than by line number, since those shift depending on what earlier tasks in this session have already changed in the file. As of this plan being written, the five `--danger` lines read `#c0392b` (base light), `#f85149` (dark), `#ff5555` (Dracula), `#bf616a` (Nord), `#ff3b3b` (High Contrast), in that order top-to-bottom in the file -- use these values to confirm you're editing the right block if line numbers have drifted.)

Then add the component CSS, placed near the existing `.model-picker`/`.model-picker-menu` rules for proximity to the pattern it mirrors:

```css
.context-usage {
  position: relative;
  flex-shrink: 0;
}

.context-usage-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg-dim);
  font-family: var(--font-mono);
  font-size: 11px;
}

.context-usage-badge:hover {
  background: var(--list-hover);
}

.context-usage-badge b {
  color: var(--fg);
  font-weight: 600;
}

.context-usage-ring {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  flex-shrink: 0;
  background: conic-gradient(var(--ring-color, var(--fg-faint)) calc(var(--pct, 0) * 1%), var(--border-subtle) 0);
}

.context-usage-ring::after {
  content: '';
  display: block;
  width: 7px;
  height: 7px;
  margin: 3px;
  border-radius: 50%;
  background: var(--input-bg);
}

.context-usage-ring.is-success { --ring-color: var(--success); }
.context-usage-ring.is-warning { --ring-color: var(--warning); }
.context-usage-ring.is-danger { --ring-color: var(--danger); }
.context-usage-ring.is-unknown { --ring-color: var(--fg-faint); }

.context-usage-popover {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  width: 280px;
  background: var(--sidebar-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 14px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.context-usage-popover-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 650;
}

.context-usage-meter-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-family: var(--font-mono);
}

.context-usage-pct {
  font-size: 19px;
  font-weight: 650;
}

.context-usage-meter-row.is-success .context-usage-pct { color: var(--success); }
.context-usage-meter-row.is-warning .context-usage-pct { color: var(--warning); }
.context-usage-meter-row.is-danger .context-usage-pct { color: var(--danger); }
.context-usage-meter-row.is-unknown .context-usage-pct { color: var(--fg-faint); }

.context-usage-tokens {
  font-size: 11px;
  color: var(--fg-dim);
}

.context-usage-track {
  height: 5px;
  border-radius: 999px;
  background: var(--border-subtle);
  overflow: hidden;
}

.context-usage-fill {
  height: 100%;
  border-radius: 999px;
}

.context-usage-fill.is-success { background: var(--success); }
.context-usage-fill.is-warning { background: var(--warning); }
.context-usage-fill.is-danger { background: var(--danger); }
.context-usage-fill.is-unknown { background: var(--fg-faint); }

.context-usage-caption {
  margin: 0;
  font-size: 11px;
  color: var(--fg-dim);
}

.context-usage-divider {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 0;
}

.context-usage-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.context-usage-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.context-usage-row-title {
  font-size: 12px;
  font-weight: 600;
}

.context-usage-row-desc {
  font-size: 10.5px;
  color: var(--fg-dim);
}

.context-usage-thresholds {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--fg-dim);
}

.context-usage-threshold {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.context-usage-threshold b {
  font-family: var(--font-mono);
  color: var(--fg);
  font-weight: 600;
}
```

Also add a small `.composer-btn` rule if this class doesn't already exist elsewhere in the file (check first — search for `.composer-btn` before adding, since other composer buttons may already share a class you should reuse instead of duplicating):

```css
.composer-btn {
  font-family: var(--font-ui);
  font-size: 11.5px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--fg);
}

.composer-btn:hover {
  background: var(--list-hover);
}

.composer-btn:disabled {
  opacity: 0.6;
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 9: Manual test**

Run the app (`npm run dev`). Open a session with some existing history (or start a new one and send a few turns). Confirm: the ring badge appears once the SDK reports usage (it won't appear before the first response, since `contextUsage` starts `null`); its percentage and color match a sensible reading of the conversation's actual size; clicking it opens the popover with the same percentage, a token count, a matching caption, and the two read-only threshold numbers. Click "Compact now": the button shows "Compacting…" and disables, then re-enables with an updated (lower) percentage once compaction finishes. Toggle auto-compact off, confirm the switch reflects it; switch away from the session and back, confirm the badge/toggle state is correctly re-synced from `emitCurrentState`. Confirm both light and dark themes render the ring/meter colors legibly.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/theme.css
git commit -m "feat: add context window ring badge and compaction controls to composer"
```
