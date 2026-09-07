# GitHub Copilot Quota Display — Design

## Problem

PassCode has no visibility into how much of a user's GitHub Copilot monthly
quota has been used. GitHub's own Copilot token-refresh endpoint
(`https://api.github.com/copilot_internal/v2/token`, or its enterprise
equivalent) already returns rich quota data on every call — plan name,
reset date, and per-category entitlement/remaining/overage for `chat`,
`completions`, and `premium_interactions` — but the underlying SDK this app
is built on (`@earendil-works/pi-ai`'s GitHub Copilot OAuth module) only
extracts `token` and `expires_at` from that response and discards
everything else. PassCode's own settings UI shows only a connected/not-connected
dot for Copilot (`SettingsPanel.tsx`), with no usage information at all.

## Goals

- Show the user's GitHub Copilot monthly quota in Settings → Providers,
  under the existing GitHub Copilot row: plan name, quota reset date, and
  all three quota categories (`chat`, `completions`, `premium_interactions`).
- Fetch this data on demand — once, when the Providers section is active
  and Copilot is connected — not via background polling.
- Do this without patching or forking the SDK: read the already-stored
  GitHub refresh token via the SDK's own exported `readStoredCredential()`
  helper, and make an independent call to the same token endpoint the SDK
  already calls internally, keeping the extra fields it currently discards.
- Fail silently and non-disruptively: if quota data can't be fetched or
  parsed (no credential, network error, unexpected response shape,
  personal/individual account without business-style quota reporting),
  simply show nothing extra — never an error toast or broken UI for what
  is enrichment, not core functionality.

## Non-goals

- No background/periodic refresh of quota data — on-demand only, per the
  Fetch timing decision.
- No quota tracking or display for the Anthropic provider — Anthropic's
  API-key auth model doesn't expose an equivalent endpoint, and this
  feature is scoped to GitHub Copilot only.
- No local persistence of quota history, no charts/trends over time — a
  single point-in-time snapshot, refetched each time Settings is opened.
- No patch to the SDK's own Copilot token-refresh logic (`pi-ai`'s
  `refreshGitHubCopilotAccessToken`) — that function, and the SDK's own
  auth/refresh cycle, are left completely untouched. This feature makes
  its own separate, read-only network call.
- No UI warning/alerting when quota is low (e.g. a red banner at 90%
  used) — just display the numbers; alerting can be a follow-up if wanted.

## Approach

### Fetching quota data (main process)

New module `src/main/agent/copilotQuota.ts` exports:

```typescript
export async function fetchCopilotQuota(): Promise<CopilotQuota | null>
```

Implementation:

1. Call `readStoredCredential('github-copilot')` (exported by
   `@earendil-works/pi-coding-agent`) to synchronously read the stored
   credential from `auth.json` without needing to construct or share a
   `CredentialStore` instance with the app's `ModelRuntime`.
2. If there's no credential, it isn't `type: 'oauth'`, or it has no
   `refresh` field, return `null` immediately — nothing to fetch.
3. Determine the token endpoint's host the same way the SDK does: use
   `credential.enterpriseUrl` if present (normalizing it to a bare
   hostname), otherwise `github.com`, and build
   `https://api.<host>/copilot_internal/v2/token`.
4. `fetch()` that URL with `Authorization: Bearer <credential.refresh>`
   and the same `Accept: application/json` / `User-Agent` /
   `Editor-Version` / `Editor-Plugin-Version` / `Copilot-Integration-Id`
   headers the SDK sends for this exact call (copied as local constants
   in this new module — this app doesn't import the SDK's internal,
   unexported header constants).
5. If the response isn't OK, or the body isn't valid JSON, or
   `quota_snapshots` isn't a plain object, return `null`.
6. Otherwise, map the response into the `CopilotQuota` shape (see Data
   flow below) and return it.

Every failure path returns `null` rather than throwing — this function is
never allowed to surface an exception to its caller.

### Shared types

`src/shared/types.ts` gains:

```typescript
export interface CopilotQuotaCategory {
  /** The category id GitHub reports, e.g. 'chat' | 'completions' | 'premium_interactions'. */
  id: string
  unlimited: boolean
  remaining: number
  entitlement: number
  percentRemaining: number
  overageCount: number
  overagePermitted: boolean
}

export interface CopilotQuota {
  planName: string
  /** ISO date string, e.g. "2026-10-01T00:00:00.000Z". */
  resetDate: string
  categories: CopilotQuotaCategory[]
}
```

`Api.settings` gains:

```typescript
getCopilotQuota(): Promise<CopilotQuota | null>
```

Friendly category labels (`"Chat"`, `"Code completions"`, `"Premium
requests"`) are a presentation concern and computed in the renderer from
`id`, not stored in the shared type — keeps the IPC payload a plain
mirror of GitHub's own category ids, and keeps label wording changeable
without touching the main process.

### IPC wiring

Standard, mirroring every other `settings.*` method already in the app:

- `settingsHandlers.ts`: `SettingsHandlers` interface gains
  `getCopilotQuota(): Promise<CopilotQuota | null>`, implemented by calling
  `fetchCopilotQuota()`.
- `register.ts`: `ipcMain.handle('settings:getCopilotQuota', () =>
  handlers.settings.getCopilotQuota())`.
- `preload/index.ts`: `getCopilotQuota: () =>
  ipcRenderer.invoke('settings:getCopilotQuota')`.

### Rendering (`SettingsPanel.tsx`)

- New state: `const [quota, setQuota] = useState<CopilotQuota | null>(null)`.
- A `useEffect` keyed on `[section, status?.copilot]`: when `section ===
  'providers'` and `status?.copilot` is true, call
  `window.api.settings.getCopilotQuota()` and store the result (or `null`
  on failure — the IPC call itself never rejects, per the main-process
  contract above). When Copilot is not connected, `quota` is cleared to
  `null` so a stale block doesn't linger after logout.
- Rendered directly under the existing GitHub Copilot `.settings-row`,
  only when `quota` is non-null:
  - A subtitle line: `"{planName} plan · resets {formatted resetDate}"`.
  - One row per category in `quota.categories`, in the fixed order
    `chat`, `completions`, `premium_interactions` (falling back to
    whatever order the API returned if one of these ids is ever missing,
    rather than dropping it):
    - `unlimited: true` → a small "Unlimited" pill, no bar.
    - `unlimited: false` → a thin progress bar (from
      `theme.css`'s existing `--success`/`--danger` token language, the
      same as the tool-card diffstat's `+`/`-` colors) filled to
      `percentRemaining`, with a text line `"{remaining} / {entitlement}
      remaining ({percentRemaining}%)"`. If `overagePermitted` and
      `overageCount > 0`, append `" · {overageCount} over quota"`.
- No loading spinner or skeleton — the fetch is a single fast call, and
  showing nothing until it resolves (or forever, on failure) matches the
  "fail silently" goal.

### CSS

New rules in `theme.css`, following existing conventions:

- `.copilot-quota` — container, `margin-top` spacing under the provider
  row, small muted font matching `.settings-row-desc`.
- `.copilot-quota-subtitle` — the plan/reset-date line.
- `.copilot-quota-category` — one category row (label + bar/pill,
  flex row).
- `.copilot-quota-pill` — the "Unlimited" pill, same visual language as
  `.composer-chip` (rounded, muted background).
- `.copilot-quota-bar` / `.copilot-quota-bar-fill` — a thin (3-4px)
  rounded track and fill. Fill color is a hard threshold, not a
  gradient: `var(--danger)` when `percentRemaining < 20`, `var(--success)`
  otherwise — both tokens are already defined in every theme variant in
  `theme.css` (light, dark, dracula, nord, high-contrast), so no new
  tokens are needed.

## Data flow

1. User opens Settings, or is already on it; clicks/is on the Providers
   section; Copilot shows connected (`status.copilot === true`).
2. `SettingsPanel.tsx`'s effect fires, calls
   `window.api.settings.getCopilotQuota()`.
3. Main process: `getCopilotQuota()` → `fetchCopilotQuota()` → reads the
   stored credential → calls GitHub's token endpoint → parses the
   response → returns `CopilotQuota | null` over IPC.
4. Renderer stores the result; if non-null, renders the quota block under
   the GitHub Copilot row. If null, nothing beyond the existing
   connected/not-connected dot changes.

Example mapping, from the real response shape already observed:

```json
{
  "copilot_plan": "business",
  "quota_reset_date_utc": "2026-10-01T00:00:00.000Z",
  "quota_snapshots": {
    "chat": { "unlimited": true, "remaining": 0, "entitlement": 0, "percent_remaining": 100, "overage_count": 0, "overage_permitted": false },
    "completions": { "unlimited": true, "remaining": 0, "entitlement": 0, "percent_remaining": 100, "overage_count": 0, "overage_permitted": false },
    "premium_interactions": { "unlimited": false, "remaining": 10555, "entitlement": 20000, "percent_remaining": 52.7, "overage_count": 0, "overage_permitted": true }
  }
}
```

maps to:

```typescript
{
  planName: "business",
  resetDate: "2026-10-01T00:00:00.000Z",
  categories: [
    { id: "chat", unlimited: true, remaining: 0, entitlement: 0, percentRemaining: 100, overageCount: 0, overagePermitted: false },
    { id: "completions", unlimited: true, remaining: 0, entitlement: 0, percentRemaining: 100, overageCount: 0, overagePermitted: false },
    { id: "premium_interactions", unlimited: false, remaining: 10555, entitlement: 20000, percentRemaining: 52.7, overageCount: 0, overagePermitted: true }
  ]
}
```

## Error handling

- No stored Copilot credential, wrong credential type (`api_key` instead
  of `oauth`), or missing `refresh` field → `fetchCopilotQuota()` returns
  `null` before any network call. Matches the "not connected" state,
  where there'd be nothing to show anyway.
- Network failure, non-2xx response, or a response body that isn't valid
  JSON → caught, logged to the main process console for dev diagnostics
  only, `null` returned.
- `quota_snapshots` missing or not a plain object (e.g. some account
  types may not return it at all) → `null` returned rather than rendering
  a partially-populated or broken block.
- A category present in `quota_snapshots` with fields missing/wrong-typed
  is skipped from the mapped `categories` array rather than crashing the
  whole parse — one malformed category shouldn't hide the other two.
- The IPC call itself (`getCopilotQuota()`) never throws to the renderer;
  every failure path inside `fetchCopilotQuota()` resolves to `null`.

## Testing

- Unit tests for `fetchCopilotQuota()` in
  `tests/main/agent/copilotQuota.test.ts`, mocking `readStoredCredential`
  and the global `fetch`:
  - No stored credential → `null`, no fetch call made.
  - Stored credential with `type: 'api_key'` → `null`, no fetch call made.
  - Successful response with the shape shown above → correctly mapped
    `CopilotQuota`.
  - Response missing `quota_snapshots` → `null`.
  - Non-OK HTTP response → `null`.
  - `fetch` rejecting (network error) → `null`.
  - Enterprise domain credential → confirms the request URL uses
    `api.<enterpriseDomain>` instead of `api.github.com`.
- Manual test: with a real Copilot login active in the running app, open
  Settings → Providers, confirm the quota block appears with real
  numbers matching what's in the account; sign out and back in, confirm
  the block disappears and reappears correctly; switch away from and
  back to the Providers section, confirm it refetches without staleness
  issues.
- No renderer automated test, consistent with this app's existing
  pattern (no jsdom harness) — `SettingsPanel.tsx` changes are verified
  by `tsc --noEmit -p tsconfig.web.json` plus the manual click-through
  above.
