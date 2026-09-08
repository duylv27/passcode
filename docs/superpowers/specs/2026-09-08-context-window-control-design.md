# Context Window Control — Design

## Problem

PassCode gives no visibility into how full a session's context window is,
and no way to act on it. The underlying SDK (`@earendil-works/pi-coding-agent`'s
`AgentSession`) already tracks this internally — `getContextUsage()`,
`compact()`, `setAutoCompactionEnabled()`/`autoCompactionEnabled` — and
auto-compacts on its own once usage crosses a threshold, but none of that
is surfaced to the user. A long session can silently approach its limit,
or auto-compact at a moment the user didn't expect, with no warning and
no way to intervene.

## Goals

- Show live context-window usage (tokens used, tokens total, percent) for
  the session's current model, in the composer toolbar, updating as the
  conversation progresses.
- Let the user manually trigger compaction on demand, rather than only
  ever waiting for the automatic threshold.
- Let the user turn the session's auto-compaction on/off.
- Show the current compaction thresholds (`reserveTokens`,
  `keepRecentTokens`) as read-only information, so the user understands
  *why* auto-compaction fires when it does.

## Non-goals

- **No adjustable thresholds.** `SettingsManager` (the SDK class backing
  this) exposes `getCompactionReserveTokens()`/`getCompactionKeepRecentTokens()`
  but has no corresponding setters — only `getCompactionEnabled()`/
  `setCompactionEnabled()` is read-write. Writing `reserveTokens`/
  `keepRecentTokens` directly into `settings.json` ourselves, bypassing
  `SettingsManager`'s own write-queue/lock, was considered and explicitly
  rejected: it risks racing the SDK's own settings writes and drifting
  from whatever format a future SDK version expects. These two values are
  display-only in this feature.
- No history/trend of context usage over time — a live snapshot only,
  matching how token-usage chips elsewhere in this app already work.
- No changes to the SDK's own auto-compaction *logic* (the
  `shouldCompact()` threshold formula) — this feature only surfaces
  what already exists and exposes the two controls that already have
  read-write APIs (manual compact, auto-compact on/off).
- The auto-compact toggle controls the *session's* live in-memory setting
  (`AgentSession.setAutoCompactionEnabled()`), not the persisted global/
  project default (`SettingsManager.setCompactionEnabled()`) — toggling
  it in the composer affects only the session currently open, not future
  sessions or other open tabs.

## Approach

### UI: a ring badge + popover in the composer toolbar

A small ring-shaped badge sits in the composer toolbar, next to the model
picker, showing the live percentage (e.g. "42%"). The ring's fill color
follows three bands, using semantic color kept separate from the app's
violet accent (matching the app's existing `--success`/`--danger` tokens,
plus one new `--warning` token theme.css doesn't currently have):

- `< 60%` — `--success` ("Comfortable")
- `60–85%` — `--warning` ("Getting full — auto-compaction will trigger
  before long")
- `> 85%` — `--danger` ("Near the limit — auto-compaction will run very
  soon")

Clicking the badge opens a popover (matching the existing model-picker/
skill-picker popover pattern already in `ChatPanel.tsx` — an anchored
absolute-positioned panel, closed on outside click) containing:

- The percentage (large) and `tokens / contextWindow` (e.g.
  `84,325 / 200,000 tokens`), plus the same color-coded caption as the
  badge.
- A slim progress meter, same color coding.
- **Compact now** — a button that calls `session.compact()`. While a
  compaction is in flight, the button shows "Compacting…" and is
  disabled; it re-enables once the SDK's `compaction_end` event arrives.
- **Auto-compact** — an on/off switch reflecting and controlling
  `session.autoCompactionEnabled`/`setAutoCompactionEnabled()`.
- Two read-only lines showing the current `reserveTokens` and
  `keepRecentTokens` values (from `session.settingsManager`), each with
  a one-line plain-language explanation of what it means — no
  slider, no input, not editable.

If `getContextUsage()` returns `undefined` (no model selected yet, or
right after compaction before the next response), the badge shows a
neutral placeholder state (e.g. "—%") rather than a stale or wrong number.

### Data flow: main process → renderer

**`RepoSession` (`src/main/agent/piSession.ts`) gains:**

```typescript
export interface RepoSession {
  // ...existing methods...
  getContextUsage(): ContextUsage | undefined
  compact(): Promise<void>
  getAutoCompactionEnabled(): boolean
  setAutoCompactionEnabled(enabled: boolean): void
  getCompactionThresholds(): { reserveTokens: number; keepRecentTokens: number }
}
```

Each is a thin delegation to the underlying SDK session:
`session.getContextUsage()`, `session.compact()` (discarding the
`CompactionResult` return value — the renderer learns completion via the
`compaction_end` event, not the call's own resolution), `session.autoCompactionEnabled`
/ `session.setAutoCompactionEnabled(enabled)`, and
`{ reserveTokens: session.settingsManager.getCompactionReserveTokens(),
keepRecentTokens: session.settingsManager.getCompactionKeepRecentTokens() }`.

**Shared types (`src/shared/types.ts`) gain:**

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

`ChatEvent` gains two new variants:

```typescript
| { type: 'context_usage'; usage: ContextUsage }
| { type: 'compaction_status'; status: 'start' | 'end' }
```

**`sessionHandlers.ts`'s event pipeline:**

- `mapAgentEvent` gains cases for the SDK's own `compaction_start`/
  `compaction_end` events, mapping to `{ type: 'compaction_status', status:
  'start' | 'end' }`.
- Inside `ensureSession`'s `subscribe` callback: whenever a `turn_end` or
  a `compaction_status` (`end`) event is forwarded, also call
  `repoSession.getContextUsage()` immediately after and, if defined,
  forward a `context_usage` event — this is the only place usage
  actually changes (a real response completing, or a compaction
  finishing), so re-checking here (rather than polling) keeps the badge
  live with zero added overhead per keystroke/render.
- `emitCurrentState` (already resyncs history/model/busy on session
  open/switch) additionally emits one `context_usage` event (if
  `getContextUsage()` is defined) and one new `{ type: 'auto_compaction';
  enabled: boolean }` event reflecting `getAutoCompactionEnabled()` at
  that moment — this is the renderer's only source for the toggle's
  initial state; subsequent toggles are handled optimistically in the
  renderer itself (see below), matching how the existing tool-approval
  switches in `SettingsPanel.tsx` already work.

**New `SessionHandlers` methods**, mirroring the existing
`abortSession`/`setSessionModel` shape:

```typescript
compactSession(sessionId: string): Promise<void>
getAutoCompactionEnabled(sessionId: string): Promise<boolean>
setAutoCompactionEnabled(sessionId: string, enabled: boolean): Promise<void>
getCompactionThresholds(sessionId: string): Promise<CompactionThresholds>
```

**IPC surface (`Api.session`)** gains the same four methods
(`compact`/`getAutoCompactionEnabled`/`setAutoCompactionEnabled`/
`getCompactionThresholds`), wired through `register.ts`/`preload/index.ts`
exactly like every other `session.*` method already there. The existing
`onEvent`/`ChatEvent` push channel already carries the two new event
variants — no new push channel needed.

### Renderer (`ChatPanel.tsx`)

New state: `contextUsage: ContextUsage | null`, `autoCompactEnabled: boolean`,
`compacting: boolean`, `compactionThresholds: CompactionThresholds | null`,
`contextPopoverOpen: boolean`. A ref (`contextPopoverRef`) plus the
existing outside-click-close `useEffect` pattern already used for the
model/skill pickers, extended to also close this new popover.

Event handling additions in the existing `session:event` listener:
- `context_usage` → `setContextUsage(event.usage)`
- `compaction_status` → `start` sets `compacting: true`; `end` sets
  `compacting: false` (the very next `context_usage` event, emitted by
  the same main-process code path right after `compaction_end`, updates
  the displayed numbers)
- `auto_compaction` → `setAutoCompactEnabled(event.enabled)`

`compactionThresholds` is fetched once, lazily, the first time the
popover opens (not on every session open) via `getCompactionThresholds()` —
these numbers don't change during a session, so there's no need to fetch
them eagerly or refetch on every popover open.

The "Compact now" button calls `window.api.session.compact(session.id)`
and disables itself; the `compacting` state (driven by the
`compaction_status` event) is the actual source of truth for re-enabling
it, not a local timeout, since a real compaction can take a few seconds.

The auto-compact switch calls `window.api.session.setAutoCompactionEnabled(session.id, next)`
and updates `autoCompactEnabled` optimistically, matching the existing
tool-approval-policy switches' pattern in `SettingsPanel.tsx`.

### Ring badge and color bands

The badge and popover both derive their color from the same three-band
function (`< 60` success, `60–85` warning, `> 85` danger) applied to
`usage.percent` — a single shared helper function in `ChatPanel.tsx`,
not duplicated logic. When `usage.percent` is `null` (right after
compaction, before the next response), the badge shows a neutral/dim
state with no color band and the text "—%" instead of guessing.

### New CSS token

`theme.css` gains one new token per theme variant: `--warning` (amber),
alongside the existing `--success`/`--danger` tokens each variant already
defines — sourced to be visually consistent with each theme's existing
palette (not a single hardcoded amber across all five themes).

## Error handling

- `compact()` rejecting (e.g. aborted mid-flight) is caught in
  `sessionHandlers.ts`'s `compactSession` and reported via the existing
  `{ type: 'error', message }` `ChatEvent` path — the same mechanism
  already used for prompt/session errors elsewhere in this file. The
  renderer's `compacting` state is cleared via the `compaction_end`
  event regardless of whether the compaction succeeded, so the button
  never gets stuck disabled.
- `getContextUsage()` returning `undefined` is not an error — it's the
  documented state before a model is selected or briefly after
  compaction. The UI's neutral placeholder handles this, not a warning.
- `getCompactionThresholds()` reads two numbers via
  `session.settingsManager` getters that don't throw per the SDK's own
  types — no explicit error handling needed beyond the IPC boundary's
  existing behavior.

## Testing

- `tests/main/agent/piSession.test.ts`: new tests for
  `RepoSession.getContextUsage()`, `compact()`, `getAutoCompactionEnabled()`/
  `setAutoCompactionEnabled()`, and `getCompactionThresholds()`, each
  verifying correct delegation to the mocked underlying SDK session
  (including its `settingsManager` mock for the thresholds case).
- `tests/main/ipc/sessionHandlers.test.ts`: new tests for
  `compaction_start`/`compaction_end` → `compaction_status` mapping,
  `context_usage` being emitted after a `turn_end` and after a
  `compaction_end`, `emitCurrentState` emitting the initial
  `context_usage`/`auto_compaction` events, and the four new
  `SessionHandlers` methods.
- No renderer automated test for the composer/popover UI, consistent
  with this app's existing pattern (no jsdom harness) — verified by
  typecheck plus manual click-through: open a long-ish session, confirm
  the badge tracks real usage, click Compact and watch the button/badge
  update, toggle auto-compact off and confirm the SDK doesn't
  auto-compact past the threshold in that session, toggle it back on.
