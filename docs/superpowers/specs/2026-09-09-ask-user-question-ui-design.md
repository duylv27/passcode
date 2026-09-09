# Ask-User-Question UI Hooks — Design

## Problem

Pi extensions can ask the SDK's host to prompt the user via
`ExtensionUIContext` (`select`/`confirm`/`input`/`notify`/`setStatus`/etc.),
a ~25-method interface each host (interactive terminal, RPC client, print
mode) implements differently. PassCode's agent sessions
(`src/main/agent/piSession.ts`) never call `AgentSession.bindExtensions()`,
so every session runs against the SDK's built-in **no-op** UI context
(`custom: async () => undefined`, `select: async () => undefined`, etc.).
Any extension that relies on these hooks — e.g.
`@juicesharp/rpiv-ask-user-question`, which lets the model ask a
clarifying question instead of guessing — either silently does nothing or
degrades to "tool removed from the model's tool list," per that package's
own documented non-interactive-host behavior.

This means PassCode currently cannot support *any* extension that wants
to ask the user something mid-turn, regardless of how well-behaved that
extension is about degrading gracefully.

## Goals

- Implement real `select`/`confirm`/`input`/`notify` in PassCode, wired
  per-session (matching the existing per-session approval-panel
  architecture), so `@juicesharp/rpiv-ask-user-question` and similarly
  well-behaved extensions work.
- A click-first interaction: `confirm` is always two buttons; `select`
  presents every option as a clickable row, with one extra "type your own
  answer" row as a fallback, not the default; `input` is unavoidably a
  text field (the primitive has no options to click), the one case where
  typing is required.
- Visual consistency with the existing approval panel (same rounded-card
  treatment, same button styling, same "quiet transcript trace after the
  fact" pattern already established for tool-call denials).

## Non-goals

- **No support for the TUI-only surface of `ExtensionUIContext`** —
  `custom()`'s raw terminal-component rendering, `setWidget`/`setFooter`/
  `setHeader`, editor-component swapping/autocomplete providers, and
  theme get/set are pure `blessed`-style terminal primitives with no
  sensible Electron/React equivalent for several of them. These get the
  SDK's own no-op behavior (copied verbatim from `runner.js`'s
  `noOpUIContext`), same as today — an extension that needs one of these
  degrades exactly as it already does in any other "non-interactive"
  host, rather than crashing.
- **No attempt to replicate the terminal package's own rich multi-tab
  dialog** (up to four questions, per-question notes, markdown option
  previews). We bind with `mode: 'rpc'`, the same mode non-terminal hosts
  like the VS Code pendant/Zed use — this is what makes a well-behaved
  extension prefer the simple generic primitives over trying to build its
  own terminal-only overlay. What the extension actually sends through
  `select`/`confirm`/`input` (plain title + string options, no
  descriptions/previews) is a real, accepted downgrade from its native
  terminal UX — not something PassCode can improve without the extension
  itself supporting a richer RPC-mode payload.
- No persistence of open prompts across an app restart — if the app
  closes with a prompt pending, that prompt is simply lost (matches how
  pending tool approvals already behave today).
- No changes to `setStatus` beyond a no-op for v1 — low-value without a
  natural home in the current UI (the status bar already shows
  brand/version/scope); can revisit if a real extension need shows up.

## Approach

### Architecture: mirrors the existing approval-panel plumbing exactly

**New IPC channel pair**, same shape as `approvals:*`:
- `uiPrompt:request` — main → renderer push event.
- `uiPrompt:respond` — renderer → main invoke.

**Shared types (`src/shared/types.ts`):**

```typescript
export type UiPromptRequest =
  | { requestId: string; sessionId: string; kind: 'select'; title: string; options: string[] }
  | { requestId: string; sessionId: string; kind: 'confirm'; title: string; message: string }
  | { requestId: string; sessionId: string; kind: 'input'; title: string; placeholder?: string }
```

The `respond` call sends back a single `value: string | boolean | undefined`
— the main-side pending-request map already knows which kind it belongs to
(it created the original `Promise`), so no discriminant is needed on the
response itself, matching how `approvalHandlers.ts`'s `respond(requestId,
approved: boolean)` already keeps the response side minimal.

**New `src/main/ipc/uiPromptHandlers.ts`** (mirrors `approvalHandlers.ts`
almost line for line):

```typescript
export interface UiPromptHandlers {
  respond(requestId: string, value: string | boolean | undefined): void
  requestSelect(sessionId: string, title: string, options: string[], timeoutMs?: number): Promise<string | undefined>
  requestConfirm(sessionId: string, title: string, message: string, timeoutMs?: number): Promise<boolean>
  requestInput(sessionId: string, title: string, placeholder: string | undefined, timeoutMs?: number): Promise<string | undefined>
}
```

Each `request*` method creates a `requestId`, stores a resolver in a
`Map<string, (value: unknown) => void>` (same pattern as
`approvalHandlers.ts`'s `pending` map), emits the request via
`deps.onRequest(...)`, and — if `timeoutMs` is provided — also arms a
`setTimeout` that resolves with the type-appropriate "nothing happened"
value (`undefined` for select/input, `false` for confirm) and notifies the
renderer to auto-dismiss that specific request (new `uiPrompt:cancel`
push event carrying just the `requestId`). This main-side timer is the
authoritative one; the renderer shows a matching visual countdown for UX,
but if IPC somehow drops the dismiss event, the `Promise` still resolves
correctly since main owns the timer, not the renderer.

**`piSession.ts`**: after `const { session } = await createAgentSession(...)`,
build a `uiContext` satisfying the SDK's `ExtensionUIContext`:

```typescript
const uiContext: ExtensionUIContext = {
  ...noOpUiContextDefaults, // every method not listed below, copied from
                            // the SDK's own noOpUIContext shape in runner.js
  select: (title, choices, opts) =>
    choices.length === 0 ? Promise.resolve(undefined) : options.requestSelect(title, choices, opts?.timeout),
  confirm: (title, message, opts) => options.requestConfirm(title, message, opts?.timeout),
  input: (title, placeholder, opts) => options.requestInput(title, placeholder, opts?.timeout),
  notify: (message, type) => options.notify(message, type)
}
await session.bindExtensions({ uiContext, mode: 'rpc' })
```

`options` here is the same `CreateRepoSessionOptions` parameter
`requestApproval` already hangs off of (renamed the SDK callback's own
`options: string[]` parameter to `choices` to avoid shadowing it).
`CreateRepoSessionOptions` gains the four new fields with **no
`sessionId` argument** -- exactly like the existing `requestApproval:
(toolName: string, input: unknown) => Promise<boolean>` field, which
already never takes a `sessionId` either. `sessionId` gets curried in one
layer up, in `sessionHandlers.ts`, the same place that already curries it
for `requestApproval` today (see below) -- `piSession.ts` itself has no
notion of PassCode's own session id, only the SDK's internal one.

`opts?.signal` (an `AbortSignal`) is honored by attaching an `abort`
listener that resolves the pending promise with the "nothing happened"
value and fires the same `uiPrompt:cancel` auto-dismiss event — covers a
turn/session being aborted while a prompt is still open.

**`sessionHandlers.ts`**: `ensureSession`'s `openRepoSession` call gains
three more threaded-through callbacks (`requestSelect`/`requestConfirm`/
`requestInput`/`notify`), each wrapping the corresponding
`uiPromptHandlers` method with `sessionId` — same shape as the existing
`requestApproval` wrapper just above it. `notify` maps to a new
lightweight `ChatEvent`:

```typescript
| { type: 'ui_notify'; message: string; level: 'info' | 'warning' | 'error' }
```

**`App.tsx`**: a second global queue, `uiPromptQueue: UiPromptRequest[]`,
populated by `window.api.uiPrompts.onRequest` and pruned on
`uiPrompt:cancel` — same shape as `approvalQueue`, filtered per-session
and passed into `ChatPanel` alongside the existing `approvalRequests`/
`onRespondApproval` props.

### Renderer: `UiPromptPanel.tsx`

Docked in the same "above composer" slot as `ApprovalPanel` (stacked
above/below it if both are somehow pending — a rare edge case, since tool
calls within one turn happen sequentially). Visually matches the approval
panel's rounded-card treatment and reuses its `.approval-skip`/
`.approval-allow`-equivalent button styling for consistency rather than
inventing a parallel button language.

Per kind:
- **`confirm`** — title + message, two buttons ("Yes"/"No" by default).
  Zero typing, ever.
- **`select`** — title + each option as its own clickable row (not a
  dropdown), plus one final "Type your own answer" row. Clicking a normal
  option resolves immediately. Clicking the last row reveals a text field
  + Submit inline, only when needed.
- **`input`** — title + auto-focused text field (with `placeholder` if
  given) + Submit. The one primitive that's unavoidably typing-first.

Keyboard: ↑/↓ moves the highlighted row (select only), Enter
confirms/submits, Escape cancels (resolves as the "nothing happened"
value, mirroring how Skip resolves the approval panel). No Ctrl+number
shortcuts, consistent with removing that pattern from the skill picker.

If `opts.timeout` was set, a small countdown renders in the panel
(matching the existing composer/approval panel's understated visual
language, not an alarming red timer) and auto-cancels at zero.

### Transcript trace, matching the approval-denial pattern

Once a prompt is answered (or cancelled/timed out), a quiet one-line
transcript row appears where the panel was — same visual family as the
existing "Skipped" row (`chat-line.is-denied`), generalized into a
`chat-line.is-prompted` variant: `● Asked  <title>  →  <answer or
"cancelled">`. This keeps the pattern consistent: an interruption that
resolves leaves a small, calm trace, not silence and not an alarming
error-style paragraph.

`notify()` calls reuse the existing `Toast`/`ToastStack` component
(currently only mounted inside `SettingsPanel.tsx`) — hoisted to mount at
the `App.tsx` level so both Settings and any session's `ui_notify` events
can push into the same toast stack, scoped with the session id so a toast
from a background tab doesn't look like it's about the active one (a
small "in {session name}" suffix, or simply suppressed for background
sessions and only shown when that session is currently active).

## Error handling

- `select()` called with an empty `options` array resolves `undefined`
  immediately without ever showing a panel — matches the SDK's own
  behavior for a degenerate call, and avoids rendering a useless empty
  picker.
- Main-side `timeoutMs` timer is authoritative; the renderer's visible
  countdown is cosmetic. If the renderer's dismiss event is somehow lost,
  the extension's `await ctx.ui.select(...)` still resolves correctly.
- `signal` abort resolves the pending promise and fires the same
  auto-dismiss path as a timeout — one unified "this prompt is no longer
  relevant" code path, not two.
- If the renderer sends `respond()` for a `requestId` that's already been
  resolved (timeout/abort raced a real click), `uiPromptHandlers.ts`
  drops it silently — same "ignore unknown/already-resolved request id"
  behavior `approvalHandlers.ts` already has today (and already has a
  test for that exact case).
- A `notify()` call for a session that isn't currently the active tab is
  either suppressed or clearly attributed (see above) — never presented
  as if it were about whatever session the user is currently looking at.

## Testing

- `tests/main/ipc/uiPromptHandlers.test.ts` (new, structured like
  `tests/main/ipc/approvalHandlers.test.ts`): request/respond round-trip
  for each kind, timeout auto-resolving with the correct "nothing
  happened" value per kind, abort-signal resolving the same way,
  ignoring a response for an unknown/already-resolved request id,
  distinct request ids for concurrent requests on the same session.
- `tests/main/agent/piSession.test.ts`: new tests asserting
  `session.bindExtensions` is called once per `createRepoSession()` with
  `mode: 'rpc'`, and that the `uiContext`'s `select`/`confirm`/`input`/
  `notify` each delegate to the corresponding threaded-in callback with
  the right arguments (mirrors the existing `tool_call` handler tests
  just above where this hook lives in that file).
- No renderer automated test for `UiPromptPanel`, consistent with this
  app's existing pattern (no jsdom harness) — verified by typecheck plus
  manual click-through: trigger `@juicesharp/rpiv-ask-user-question`'s
  `ask_user_question` tool against a real prompt, confirm the panel
  appears with clickable options, confirm "type your own answer" works,
  confirm Escape cancels cleanly, confirm the quiet transcript trace
  appears afterward, confirm a background-tab session's prompt doesn't
  interrupt whichever tab is currently active.
