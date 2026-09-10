# Passports — Design Spec

**Goal:** Replace Settings' four hand-built, per-provider auth blocks
(Anthropic API key, Anthropic OAuth/Claude Pro-Max, Gemini API key, GitHub
Copilot device sign-in) with one generic concept — a **Passport**: a real,
persisted entity representing one saved credential for one provider via one
auth method. Adding a fifth provider or a third auth method later should
mean writing one new `AuthMethodHandler`, not four more UI blocks and four
more IPC channels.

## Background

This session built the Claude Pro/Max OAuth login as a fourth ad-hoc case
alongside the three that already existed, and it required its own React
state, its own IPC channels, its own UI markup — all duplicated from
patterns the other three cases had already established. That duplication is
exactly what Passports removes.

## Naming

The entity is called a **Passport** — a pun on PassCode itself: a passport
is literally "something that lets you pass into" a place, which is exactly
what a saved credential does for a provider. Chosen over "Connection" (too
generic — every AI tool calls it this) after considering "Keyring" and
"Badge."

## Scope

- **In scope:** a generic, persisted `Passport` entity; a provider-agnostic
  backend (repository + one handler per auth method, not per provider); a
  redesigned Settings UI (list + two popups) replacing the four provider
  blocks; per-Passport usage tracking sufficient to show in the UI.
- **Out of scope:** per-session/per-project Passport overrides. A session
  always uses whichever Passport is currently *active* for the provider its
  selected model belongs to — this matches today's actual behavior (there
  has only ever been one live credential per provider) and keeps this pass
  focused. A future spec can add per-project pinning if it's ever needed.
- **Out of scope:** taking over OAuth token storage/refresh ourselves. The
  SDK's own credential store keeps doing that; Passports track OAuth
  connections as metadata only (see Data Model).
- **Out of scope:** any attempt to make Anthropic's subscription-quota
  restriction on third-party apps go away. That's Anthropic's own policy,
  confirmed via a live 400 response during this session
  (`"Third-party apps now draw from your extra usage, not your plan
  limits."`) — Passports make the *credential management* generic; they
  don't and can't change what Anthropic's server allows a non-official
  client to bill against.

## Data Model

New `passports` table, one row per saved credential:

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT | uuid, primary key |
| `providerId` | TEXT | `'anthropic'` \| `'google'` \| `'github-copilot'` \| future ids — a plain string, not an enum, so a new provider never needs a schema migration |
| `authMethod` | TEXT | `'api_key'` \| `'oauth'` \| future methods — same reasoning, plain string |
| `displayName` | TEXT | user-editable label, e.g. "Claude Pro/Max", "Work key"; defaults per method (see UI) |
| `isActive` | INTEGER | 0/1. Exactly one active Passport per `providerId`, enforced by a partial unique index: `CREATE UNIQUE INDEX passports_active_per_provider ON passports(providerId) WHERE isActive = 1` |
| `credentialData` | TEXT \| NULL | Opaque JSON, meaning owned entirely by the `authMethod` handler. For `api_key`: `{"apiKey": "sk-ant-..."}`. For `oauth`: **NULL** — the real tokens live in the SDK's own credential store; this row only proves a login exists |
| `status` | TEXT | `'connected'` \| `'error'` \| `'unknown'` — last known validation result |
| `lastValidatedAt` | TEXT \| NULL | ISO timestamp of the last successful/failed check |
| `totalInputTokens` | INTEGER | Running counter, incremented alongside the existing usage-telemetry code path (see Usage Tracking). 0 for methods where token counts don't apply (e.g. Copilot, whose quota is request-based) |
| `totalOutputTokens` | INTEGER | Same |
| `totalRequests` | INTEGER | Running counter of turns billed against this Passport, meaningful for every auth method |
| `lastUsedAt` | TEXT \| NULL | ISO timestamp of the most recent turn billed against this Passport |
| `createdAt` | TEXT | ISO timestamp |

No column is provider-specific. A future provider with a wholly different
auth method (say, an AWS IAM profile) just needs one new `authMethod`
string and one new handler — no new columns, no new table.

## Backend Architecture

**`passportsRepository.ts`** — plain CRUD against the `passports` table,
plus `setActive(id)` (atomically flips `isActive` off the current active
row for that `providerId` and on for the target, inside one transaction)
and `recordUsage(id, { inputTokens, outputTokens })` (increments the
running counters and bumps `lastUsedAt`).

**`AuthMethodHandler` interface** — one implementation per `authMethod`,
not per provider:

```ts
interface AuthMethodHandler {
  /** Wires this Passport's credential into ModelRuntime so requests for
   * its provider actually use it. */
  activate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  /** Undoes activate() -- called before a different Passport for the same
   * provider is activated, or when this Passport is removed. */
  deactivate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  /** Cheap liveness check, used to populate `status`. */
  checkStatus(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<'connected' | 'error'>
}
```

- `ApiKeyAuthMethodHandler`: `activate` calls `modelRuntime.setRuntimeApiKey(providerId, credentialData.apiKey)`; `deactivate` calls `removeRuntimeApiKey`; `checkStatus` calls `checkAuth(providerId)`.
- `OAuthAuthMethodHandler`: `activate`/`deactivate` are no-ops beyond bookkeeping (the SDK's `login()`/`logout()` already ran once, during creation/removal — see IPC surface below); `checkStatus` calls `checkAuth(providerId)` same as the API-key handler.

Both handlers are provider-agnostic — they take `providerId` as data, never
branch on it. This is what makes a fifth provider free: as long as it uses
`api_key` or `oauth`, zero new handler code is needed.

**`passportHandlers.ts`** (IPC) replaces `setAnthropicApiKey`,
`removeAnthropicApiKey`, `setGeminiApiKey`, `loginCopilot`,
`loginAnthropicOAuth`, `submitAnthropicOAuthCode`, `cancelAnthropicOAuth`
with generic verbs:

```ts
listPassports(): Promise<Passport[]>
createApiKeyPassport(providerId: string, displayName: string, apiKey: string): Promise<{ok:true; passport:Passport} | {ok:false; error:string}>
createOAuthPassport(providerId: string, displayName: string, onPrompt: (p: OAuthPrompt) => void): Promise<{ok:true; passport:Passport} | {ok:false; error:string}>
submitOAuthCode(code: string): void          // same manual-fallback mechanism already built
cancelOAuth(): void
setActivePassport(id: string): Promise<void>
renamePassport(id: string, name: string): Promise<void>
removePassport(id: string): Promise<void>    // calls deactivate() first if it was active
```

`createApiKeyPassport` still validates the key against the real provider
API before persisting (reusing `validateAnthropicApiKey`/
`validateGeminiApiKey`, called generically by `providerId`). `createOAuthPassport`
reuses the exact OAuth flow (browser + local callback server + manual-code
fallback) already built and tested this session for Anthropic — the only
change is it's no longer hardcoded to `'anthropic'`.

## Usage Tracking

`sessionHandlers.ts` already maps `model_usage` events per turn
(`{input, output, cacheRead, cacheWrite}`). The only change needed: look up
the provider's currently-*active* Passport id at that moment and call
`passportsRepository.recordUsage(activePassportId, {inputTokens, outputTokens})`
alongside the existing `appendUsageTelemetryRecord` call. This is a running
counter, not a time-series log — sufficient for the "usage" figures shown
in the UI (all-time totals, last-used timestamp) without a new table.

Auth methods where per-token counts don't apply (Copilot's request/quota
model) simply never call `recordUsage` for tokens; `totalRequests` and
`lastUsedAt` still update, which is what the UI shows for those rows
instead (see UI).

## UI Design

Approved via an interactive HTML mockup during this session
(`.claude/worktrees/anthropic-oauth`-adjacent scratch artifact, not
committed to the repo). Settings' "Providers" nav tab is renamed
**"Passports"**.

**List** — grouped by provider, each row shows:
- Provider icon + Passport name + status dot + an "Active" tag when it's
  the provider's active one
- An auth-method badge (`API Key` / `OAuth` / `Device sign-in`)
- 2-3 usage chips, method-dependent: API-key rows show the masked key,
  last-used, and all-time token count; OAuth/subscription rows show
  sign-in recency, session count, and a quota-percentage bar; device-code
  rows (Copilot) show connection recency and a quota bar
- A **"View details"** link and a `⋯` menu (Activate / Rename / Remove)

**Add Passport popup** (not a full-panel replacement — a centered modal
over the list, dismissible via backdrop click or `✕`): 3 steps — pick a
provider, pick an auth method available for it, then the actual input
(key field, or the OAuth browser flow with its existing manual-code
fallback).

**View Details popup**: full (unmasked-on-request) key or account info,
exact timestamps, the same usage figures as the row in expanded form, and
Remove / Set Active actions.

## Migration

Existing data moves into `passports` once, on first launch after this
ships:
- Each entry in the current `providerApiKeys` blob becomes one `api_key`
  Passport (`displayName` defaults to `"<Provider> API Key"`), `isActive =
  1` (it was the only credential for that provider before Passports
  existed).
- If `modelRuntime.checkAuth(providerId)` reports an existing OAuth
  credential for a provider (Copilot's device sign-in, or an Anthropic
  OAuth login from testing this session) with no corresponding row yet, one
  `oauth` Passport is created for it, `isActive = 1`.
- This migration runs once (a `passportsMigrated` flag in
  `appSettingsRepository`, mirroring the existing `bookmarked` column's
  ALTER-if-missing pattern), is idempotent, and never deletes the
  underlying credential — only ever adds rows.
