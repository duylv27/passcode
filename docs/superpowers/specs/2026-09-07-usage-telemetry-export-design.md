# Usage Telemetry Export — Design

## Problem

An existing team pipeline at `C:\Code\.telemetry` already captures GitHub
Copilot token usage from VS Code's Copilot Chat extension: that extension
writes one OpenTelemetry log record (JSON) per line to a local file (set via
VS Code's `github.copilot.chat.otel.outfile` setting), and a scheduled
PowerShell script (`Export-CopilotTokens.ps1`) dedupes and aggregates those
records into per-user, per-day, per-model CSVs synced to a shared team
folder, which existing dashboards already visualize.

PassCode's own agent usage (routed through Anthropic or GitHub Copilot via
the `@earendil-works/pi-ai` SDK) is not part of this pipeline at all — it's
tracked only in memory, per open session, for the UI's token-count chips,
and never persisted historically. As a result, PassCode's usage is invisible
to the existing team telemetry/dashboard tooling.

## Goals

- PassCode emits its own real LLM inference usage as OpenTelemetry log
  records in the exact same JSON shape VS Code's Copilot Chat extension
  already writes, so the existing `Export-CopilotTokens.ps1` script picks
  them up with zero changes to that script, and PassCode's usage rolls up
  into the same shared CSVs/dashboards as VS Code's.
- One record per actual LLM inference call (matching VS Code's own
  granularity) — a turn that makes several tool calls and several LLM
  round-trips emits several records, not one aggregated record per turn.
- User-configurable: an on/off toggle and an output file path, in
  PassCode's own Settings UI. Off by default — this writes to a file
  outside the app's own data directory, so it must be an explicit opt-in.
- Identity fields (`user.name`, `team.id`) come from the same
  `OTEL_RESOURCE_ATTRIBUTES` environment variable convention the existing
  pipeline's script already falls back to reading
  (`Export-CopilotTokens.ps1`'s own `$env:OTEL_RESOURCE_ATTRIBUTES -match
  'user\.name=([^,]+)'` fallback) — not hardcoded values, so this works
  correctly for any user who has that variable set, and degrades
  gracefully (OS username, no team.id) for anyone who doesn't.
- Never disrupt the chat: a telemetry write failure (bad path, permission
  denied, disk full) is caught and logged to console only — it never
  surfaces to the user, blocks a turn, or throws.

## Non-goals

- No in-app viewer for this data — PassCode is a producer here, not a
  consumer. Viewing happens through the existing external dashboards.
- No reading of VS Code's own `copilot-working.jsonl` or the aggregated
  CSVs from within PassCode.
- No changes to `Export-CopilotTokens.ps1` or the dashboard scripts — the
  whole point is zero-touch compatibility with what already exists.
- No retry/queueing on write failure — a dropped record on a transient
  file-system error is acceptable for telemetry; this is not a
  billing-accuracy system.
- No emission of a `copilot_chat.session.start`-equivalent event — only
  the token-usage-bearing inference records the aggregator actually
  parses (it ignores everything else via its own `if (($null -eq $inTok)
  -and ($null -eq $outTok)) { continue }` filter).

## Approach

### Record shape

One JSON object per line, appended to the configured output file,
matching the real shape observed in `copilot-working.jsonl`:

```json
{
  "hrTime": [1781853116, 291000000],
  "hrTimeObserved": [1781853116, 291000000],
  "resource": {
    "_rawAttributes": [
      ["service.name", "passcode-desktop"],
      ["service.version", "0.1.0"],
      ["session.id", "<pi SDK session id>"],
      ["user.name", "duylv-epam"],
      ["team.id", "skii-epam"]
    ]
  },
  "instrumentationScope": { "name": "passcode-desktop", "version": "0.1.0" },
  "attributes": {
    "event.name": "gen_ai.client.inference.operation.details",
    "gen_ai.operation.name": "chat",
    "gen_ai.request.model": "<model id>",
    "gen_ai.response.model": "<model id>",
    "gen_ai.response.id": "<generated uuid>",
    "gen_ai.usage.input_tokens": 24757,
    "gen_ai.usage.output_tokens": 12
  },
  "_body": "GenAI inference: <model id>"
}
```

Only the fields `Export-CopilotTokens.ps1` actually reads are load-bearing:
`hrTime[0]` (epoch seconds, for the `date` bucket), `resource._rawAttributes`
(for `user.name`/`team.id`), and `attributes`' `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.response.model` (preferred) /
`gen_ai.request.model` (fallback), and `gen_ai.response.id` (dedup key).
Everything else is included for shape-fidelity with VS Code's own records
but isn't required for correct aggregation.

`service.name`/`instrumentationScope.name` are `"passcode-desktop"` (not
`"copilot-chat"`) — the aggregator doesn't filter or group on this field at
all today, so this is purely for future clarity (so a team member looking
at raw records can tell PassCode's usage from VS Code's), not a
compatibility requirement.

### Identity resolution (main process)

```typescript
function resolveIdentity(): { userName: string; teamId?: string } {
  const raw = process.env.OTEL_RESOURCE_ATTRIBUTES
  const attrs: Record<string, string> = {}
  if (raw) {
    for (const pair of raw.split(',')) {
      const [key, value] = pair.split('=')
      if (key && value) attrs[key.trim()] = value.trim()
    }
  }
  return {
    userName: attrs['user.name'] || os.userInfo().username,
    teamId: attrs['team.id']
  }
}
```

Parsed once per emitted record (cheap; the env var doesn't change during a
running process, but re-parsing avoids a stale-cache invalidation problem
for no real cost).

### Settings persistence

`src/main/db/appSettingsRepository.ts` gains a second key/value pair,
following the exact pattern `getToolApprovalPolicy`/`setToolApprovalPolicy`
already establish:

```typescript
export interface UsageTelemetryConfig {
  enabled: boolean
  outputPath: string
}

export const DEFAULT_USAGE_TELEMETRY_CONFIG: UsageTelemetryConfig = {
  enabled: false,
  outputPath: ''
}
```

with `getUsageTelemetryConfig()`/`setUsageTelemetryConfig()` methods stored
under a new `usageTelemetryConfig` key in the same `app_settings` table
(no schema migration needed — it's the same generic key/value table the
tool-approval policy already uses).

### IPC surface

`Api.settings` (the same namespace used for Anthropic/Copilot auth) gains:

```typescript
getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<void>
```

wired through `settingsHandlers.ts`/`register.ts`/`preload/index.ts`
exactly like every other `settings.*` method already there.

### Emission point (main process)

New module `src/main/agent/usageTelemetry.ts` exports:

```typescript
export function appendUsageTelemetryRecord(
  config: UsageTelemetryConfig,
  params: { model: { provider: string; id: string; name: string }; usage: TokenUsage; sessionId: string }
): void
```

Non-async by signature (fire-and-forget internally) so the caller never
needs to `await` or handle a rejection — it's pure enrichment on the hot
event path and must never slow down or break event dispatch. If
`!config.enabled || !config.outputPath`, it's a no-op. Otherwise it builds
the record above (using `crypto.randomUUID()` for `gen_ai.response.id`,
and `Date.now()` split into `[Math.floor(ms / 1000), (ms % 1000) *
1_000_000]` for `hrTime`/`hrTimeObserved`) and appends it via
`fsPromises.appendFile(path, line + '\n', 'utf-8')`, catching and
`console.warn`-ing any error (bad path, permission denied) without
propagating it.

Called from `src/main/ipc/sessionHandlers.ts`'s existing `ensureSession`,
at the exact point that already captures a real inference's usage
(currently lines 86-88):

```typescript
      if (mapped.type === 'model_usage') {
        pendingActionUsage = mapped.usage
        const model = repoSession.getModel()
        if (model) {
          appendUsageTelemetryRecord(deps.getUsageTelemetryConfig(), {
            model,
            usage: mapped.usage,
            sessionId: piSessionId
          })
        }
        return
      }
```

`deps.getUsageTelemetryConfig` is a new field on `CreateSessionHandlersDeps`
(a plain `() => UsageTelemetryConfig` the caller in `src/main/index.ts`
wires to `appSettingsRepo.getUsageTelemetryConfig`), read fresh on every
emission rather than cached at session-open time — so toggling the setting
in the running app takes effect on the very next inference call, not just
for sessions opened after the toggle.

### Settings UI

`SettingsPanel.tsx`'s `'general'` section (currently just the Appearance
theme-swatch row) gains a new row, following the existing `.settings-row`
pattern used throughout the Providers/Permissions sections:

- A title + description ("Usage Telemetry" / "Export token usage as
  OpenTelemetry log records for external aggregation").
- A `Switch` (the same toggle component already used in the Permissions
  section) bound to `config.enabled`.
- A text input for `config.outputPath`, shown only when enabled,
  following the same input/Save-button pattern as the Anthropic API key
  row (a local draft string state, committed on blur or a Save click —
  not on every keystroke, to avoid writing to SQLite on every character
  typed).

## Error handling

- `appendUsageTelemetryRecord` never throws to its caller under any
  circumstance — every failure (env var parse issue, file write error) is
  caught internally and logged via `console.warn`, never surfaced to the
  renderer or the chat UI.
- A malformed `OTEL_RESOURCE_ATTRIBUTES` value (missing `=`, stray
  whitespace) degrades to the OS-username fallback rather than crashing
  the parse — the `split('=')` + truthy-check approach above tolerates
  any malformed segment by simply not populating that key.
- If `repoSession.getModel()` returns `undefined` (no model selected yet
  — shouldn't happen once a turn has actually produced usage, but the
  existing code already guards this case at `emitCurrentState`), the
  telemetry call is skipped entirely for that event rather than emitting
  a record with a missing model.

## Testing

- Unit tests for `appendUsageTelemetryRecord` in
  `tests/main/agent/usageTelemetry.test.ts`: config disabled → no file
  write attempted; config enabled with valid path → file receives one
  correctly-shaped JSON line; `OTEL_RESOURCE_ATTRIBUTES` set → identity
  fields populated from it; unset → falls back to OS username with no
  `team.id`; malformed env var → falls back gracefully; write failure
  (e.g. a directory that doesn't exist) → caught, logged, doesn't throw.
- Unit tests for `getUsageTelemetryConfig`/`setUsageTelemetryConfig` in
  `tests/main/db/appSettingsRepository.test.ts`, mirroring the existing
  tool-approval-policy tests in that same file.
- Manual test: enable the toggle, point it at a scratch file, send a few
  turns (including one that triggers a tool call, to confirm multiple
  records emit within one turn), confirm the file receives correctly
  shaped, one-line-per-record JSON that `Export-CopilotTokens.ps1` can
  parse without modification (run the script against a copy of the
  scratch file and confirm it aggregates PassCode's records correctly).
- No renderer automated test for the Settings UI addition, consistent
  with this app's existing pattern — verified by typecheck + manual
  toggle/save/persist-across-restart click-through.
