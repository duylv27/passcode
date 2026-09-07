# GitHub Copilot Quota Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the user's GitHub Copilot monthly quota (plan name, reset date, and per-category chat/completions/premium-request usage) in PassCode's Settings → Providers panel, under the existing GitHub Copilot row.

**Architecture:** A new main-process module reads the already-stored GitHub Copilot OAuth credential and makes an independent call to the same GitHub token endpoint the SDK already calls internally (`/copilot_internal/v2/token`), keeping the quota fields the SDK itself discards. This is exposed over a new IPC method, and the renderer's `SettingsPanel.tsx` fetches it on demand whenever the Providers section is active and Copilot is connected.

**Tech Stack:** TypeScript, Electron IPC, `@earendil-works/pi-coding-agent`'s exported `readStoredCredential()` helper, native `fetch`, Vitest.

## Global Constraints

- No patch to the SDK's own Copilot auth/refresh logic — this feature makes its own separate, read-only network call, never touching `@earendil-works/pi-ai`'s `refreshGitHubCopilotAccessToken` or the app's `ModelRuntime`.
- Every failure path (no credential, wrong credential type, network error, non-2xx response, malformed/missing `quota_snapshots`) resolves to `null` — this is enrichment, not core functionality, and must never throw to its caller or surface an error toast.
- On-demand fetch only — no background polling, no periodic refresh.
- Show all three quota categories the API returns (`chat`, `completions`, `premium_interactions`): an "Unlimited" pill for categories with `unlimited: true`, a progress bar + remaining/entitlement numbers for `unlimited: false`.
- Progress bar fill color: `var(--danger)` when `percentRemaining < 20`, `var(--success)` otherwise — hard threshold, no gradient. Both tokens already exist in every theme variant in `theme.css`.
- Copilot only — no equivalent quota display for the Anthropic provider (its API-key auth model has no such endpoint).

---

## Task 1: Copilot quota fetcher (main process)

**Files:**
- Modify: `src/shared/types.ts:41-44` (add two new interfaces right after `AuthStatus`)
- Create: `src/main/agent/copilotQuota.ts`
- Test: `tests/main/agent/copilotQuota.test.ts`

**Interfaces:**
- Produces: `CopilotQuotaCategory { id: string; unlimited: boolean; remaining: number; entitlement: number; percentRemaining: number; overageCount: number; overagePermitted: boolean }` and `CopilotQuota { planName: string; resetDate: string; categories: CopilotQuotaCategory[] }`, defined once in `src/shared/types.ts` (not duplicated in the main-process module) so both the main process and, later, the renderer import the same definitions. Also produces `fetchCopilotQuota(): Promise<CopilotQuota | null>` — consumed by Task 2's `settingsHandlers.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/agent/copilotQuota.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const readStoredCredentialMock = vi.fn()

vi.mock('@earendil-works/pi-coding-agent', () => ({
  readStoredCredential: readStoredCredentialMock
}))

import { fetchCopilotQuota } from '../../../src/main/agent/copilotQuota'

const SAMPLE_RESPONSE = {
  copilot_plan: 'business',
  quota_reset_date_utc: '2026-10-01T00:00:00.000Z',
  quota_snapshots: {
    chat: {
      unlimited: true,
      remaining: 0,
      entitlement: 0,
      percent_remaining: 100,
      overage_count: 0,
      overage_permitted: false
    },
    completions: {
      unlimited: true,
      remaining: 0,
      entitlement: 0,
      percent_remaining: 100,
      overage_count: 0,
      overage_permitted: false
    },
    premium_interactions: {
      unlimited: false,
      remaining: 10555,
      entitlement: 20000,
      percent_remaining: 52.7,
      overage_count: 0,
      overage_permitted: true
    }
  }
}

describe('fetchCopilotQuota', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    readStoredCredentialMock.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when there is no stored credential', async () => {
    readStoredCredentialMock.mockReturnValue(undefined)

    expect(await fetchCopilotQuota()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null for a non-oauth credential', async () => {
    readStoredCredentialMock.mockReturnValue({ type: 'api_key', key: 'sk-ant-xxx' })

    expect(await fetchCopilotQuota()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches and maps a successful response', async () => {
    readStoredCredentialMock.mockReturnValue({
      type: 'oauth',
      refresh: 'gh-refresh-token',
      access: 'copilot-token',
      expires: 123
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => SAMPLE_RESPONSE })

    const result = await fetchCopilotQuota()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/copilot_internal/v2/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gh-refresh-token' })
      })
    )
    expect(result).toEqual({
      planName: 'business',
      resetDate: '2026-10-01T00:00:00.000Z',
      categories: [
        {
          id: 'chat',
          unlimited: true,
          remaining: 0,
          entitlement: 0,
          percentRemaining: 100,
          overageCount: 0,
          overagePermitted: false
        },
        {
          id: 'completions',
          unlimited: true,
          remaining: 0,
          entitlement: 0,
          percentRemaining: 100,
          overageCount: 0,
          overagePermitted: false
        },
        {
          id: 'premium_interactions',
          unlimited: false,
          remaining: 10555,
          entitlement: 20000,
          percentRemaining: 52.7,
          overageCount: 0,
          overagePermitted: true
        }
      ]
    })
  })

  it('returns null when quota_snapshots is missing', async () => {
    readStoredCredentialMock.mockReturnValue({
      type: 'oauth',
      refresh: 'gh-refresh-token',
      access: 'copilot-token',
      expires: 123
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ copilot_plan: 'individual' }) })

    expect(await fetchCopilotQuota()).toBeNull()
  })

  it('returns null on a non-OK HTTP response', async () => {
    readStoredCredentialMock.mockReturnValue({
      type: 'oauth',
      refresh: 'gh-refresh-token',
      access: 'copilot-token',
      expires: 123
    })
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })

    expect(await fetchCopilotQuota()).toBeNull()
  })

  it('returns null when fetch rejects with a network error', async () => {
    readStoredCredentialMock.mockReturnValue({
      type: 'oauth',
      refresh: 'gh-refresh-token',
      access: 'copilot-token',
      expires: 123
    })
    fetchMock.mockRejectedValue(new Error('network down'))

    expect(await fetchCopilotQuota()).toBeNull()
  })

  it('uses the enterprise domain host when the credential has one', async () => {
    readStoredCredentialMock.mockReturnValue({
      type: 'oauth',
      refresh: 'gh-refresh-token',
      access: 'copilot-token',
      expires: 123,
      enterpriseUrl: 'acme.ghe.com'
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => SAMPLE_RESPONSE })

    await fetchCopilotQuota()

    expect(fetchMock).toHaveBeenCalledWith('https://api.acme.ghe.com/copilot_internal/v2/token', expect.anything())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/agent/copilotQuota.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/copilotQuota'`

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, add these two interfaces right after the existing `AuthStatus` interface (currently lines 41-44):

```typescript
export interface CopilotQuotaCategory {
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
  resetDate: string
  categories: CopilotQuotaCategory[]
}
```

- [ ] **Step 4: Implement the fetcher**

Create `src/main/agent/copilotQuota.ts`:

```typescript
import { readStoredCredential } from '@earendil-works/pi-coding-agent'
import type { CopilotQuota, CopilotQuotaCategory } from '../../shared/types'

// Matches the headers the SDK's own Copilot token-refresh call sends to
// this same endpoint (`@earendil-works/pi-ai`'s github-copilot.js) --
// duplicated here rather than imported since that module doesn't export
// them, and this is a small, stable constant.
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat'
}

const QUOTA_CATEGORY_IDS = ['chat', 'completions', 'premium_interactions'] as const

function hostnameFromEnterpriseUrl(enterpriseUrl: unknown): string | null {
  if (typeof enterpriseUrl !== 'string' || !enterpriseUrl.trim()) return null
  try {
    const url = enterpriseUrl.includes('://') ? new URL(enterpriseUrl) : new URL(`https://${enterpriseUrl}`)
    return url.hostname
  } catch {
    return null
  }
}

/** Independently re-fetches the same GitHub Copilot token-exchange
 * response the SDK already calls internally, keeping the quota fields
 * (`quota_snapshots`, `quota_reset_date_utc`, `copilot_plan`) that the
 * SDK's own refresh logic discards after extracting just the token.
 * Every failure path returns null -- this is enrichment info, never
 * something that should throw to its caller. */
export async function fetchCopilotQuota(): Promise<CopilotQuota | null> {
  const credential = readStoredCredential('github-copilot')
  if (!credential || credential.type !== 'oauth') return null

  const domain = hostnameFromEnterpriseUrl((credential as { enterpriseUrl?: unknown }).enterpriseUrl) ?? 'github.com'
  const url = `https://api.${domain}/copilot_internal/v2/token`

  let raw: unknown
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.refresh}`,
        ...COPILOT_HEADERS
      }
    })
    if (!response.ok) return null
    raw = await response.json()
  } catch {
    return null
  }

  return parseCopilotQuota(raw)
}

function parseCopilotQuota(raw: unknown): CopilotQuota | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const snapshots = data.quota_snapshots
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) return null

  const categories: CopilotQuotaCategory[] = []
  for (const id of QUOTA_CATEGORY_IDS) {
    const category = parseCategory(id, (snapshots as Record<string, unknown>)[id])
    if (category) categories.push(category)
  }
  if (categories.length === 0) return null

  return {
    planName: typeof data.copilot_plan === 'string' ? data.copilot_plan : 'unknown',
    resetDate: typeof data.quota_reset_date_utc === 'string' ? data.quota_reset_date_utc : '',
    categories
  }
}

function parseCategory(id: string, raw: unknown): CopilotQuotaCategory | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (
    typeof c.unlimited !== 'boolean' ||
    typeof c.remaining !== 'number' ||
    typeof c.entitlement !== 'number' ||
    typeof c.percent_remaining !== 'number' ||
    typeof c.overage_count !== 'number' ||
    typeof c.overage_permitted !== 'boolean'
  ) {
    return null
  }
  return {
    id,
    unlimited: c.unlimited,
    remaining: c.remaining,
    entitlement: c.entitlement,
    percentRemaining: c.percent_remaining,
    overageCount: c.overage_count,
    overagePermitted: c.overage_permitted
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/agent/copilotQuota.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/agent/copilotQuota.ts tests/main/agent/copilotQuota.test.ts
git commit -m "feat: add GitHub Copilot quota fetcher"
```

---

## Task 2: Shared types + IPC wiring

**Files:**
- Modify: `src/shared/types.ts:197-202` (`Api.settings`)
- Modify: `src/main/ipc/settingsHandlers.ts` (add `getCopilotQuota`)
- Modify: `src/main/ipc/register.ts` (add `settings:getCopilotQuota` handler)
- Modify: `src/preload/index.ts:48-57` (`settings` bridge)
- Test: `tests/main/ipc/settingsHandlers.test.ts`

**Interfaces:**
- Consumes: `fetchCopilotQuota(): Promise<CopilotQuota | null>` from Task 1's `src/main/agent/copilotQuota.ts`, and the `CopilotQuota`/`CopilotQuotaCategory` types Task 1 already added to `src/shared/types.ts` (do not redefine them here — just import/reference them).
- Produces: `Api.settings.getCopilotQuota(): Promise<CopilotQuota | null>` — consumed by Task 3's `SettingsPanel.tsx`.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc/settingsHandlers.test.ts`, add this import at the top, alongside the existing imports:

```typescript
import type { CopilotQuota } from '../../../src/shared/types'
```

Add this mock right after the existing imports, before the `describe` block (this is the one new piece of test setup this task needs — mocking the module `settingsHandlers.ts` will import from):

```typescript
const fetchCopilotQuotaMock = vi.fn<[], Promise<CopilotQuota | null>>()

vi.mock('../../../src/main/agent/copilotQuota', () => ({
  fetchCopilotQuota: fetchCopilotQuotaMock
}))
```

Then add this test inside the existing `describe('settingsHandlers', ...)` block, near the other `getAuthStatus`-related test:

```typescript
  it('delegates getCopilotQuota to the quota fetcher', async () => {
    const quota: CopilotQuota = {
      planName: 'business',
      resetDate: '2026-10-01T00:00:00.000Z',
      categories: [
        {
          id: 'premium_interactions',
          unlimited: false,
          remaining: 10555,
          entitlement: 20000,
          percentRemaining: 52.7,
          overageCount: 0,
          overagePermitted: true
        }
      ]
    }
    fetchCopilotQuotaMock.mockResolvedValueOnce(quota)

    const result = await handlers.getCopilotQuota()

    expect(result).toEqual(quota)
  })

  it('returns null from getCopilotQuota when the fetcher returns null', async () => {
    fetchCopilotQuotaMock.mockResolvedValueOnce(null)

    expect(await handlers.getCopilotQuota()).toBeNull()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/settingsHandlers.test.ts`
Expected: FAIL — `handlers.getCopilotQuota is not a function`

- [ ] **Step 3: Add the IPC surface to the shared `Api` type**

`CopilotQuota` was already added to `src/shared/types.ts` in Task 1 — this step only extends `Api.settings` (currently lines 197-202) to use it:

```typescript
  settings: {
    setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
    getAuthStatus(): Promise<AuthStatus>
    loginCopilot(): Promise<{ ok: true } | { ok: false; error: string }>
    onCopilotChallenge(listener: (challenge: DeviceCodeChallenge) => void): () => void
    getCopilotQuota(): Promise<CopilotQuota | null>
  }
```

- [ ] **Step 4: Wire the main-process handler**

In `src/main/ipc/settingsHandlers.ts`, add the import at the top:

```typescript
import { fetchCopilotQuota } from '../agent/copilotQuota'
import type { AuthStatus, CopilotQuota, DeviceCodeChallenge } from '../../shared/types'
```

(Replace the existing `import type { AuthStatus, DeviceCodeChallenge } from '../../shared/types'` line with the one above, which adds `CopilotQuota` to it.)

Add `getCopilotQuota(): Promise<CopilotQuota | null>` to the `SettingsHandlers` interface:

```typescript
export interface SettingsHandlers {
  setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  getAuthStatus(): Promise<AuthStatus>
  loginCopilot(
    onChallenge: (challenge: DeviceCodeChallenge) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
  getCopilotQuota(): Promise<CopilotQuota | null>
}
```

Add the implementation inside `createSettingsHandlers`'s returned object, alongside the other methods:

```typescript
    async getCopilotQuota() {
      return fetchCopilotQuota()
    }
```

- [ ] **Step 5: Wire the IPC channel**

In `src/main/ipc/register.ts`, add this line right after the existing `settings:loginCopilot` handler registration:

```typescript
  ipcMain.handle('settings:getCopilotQuota', () => handlers.settings.getCopilotQuota())
```

- [ ] **Step 6: Wire the preload bridge**

In `src/preload/index.ts`, add `getCopilotQuota` to the `settings` object (currently lines 48-57):

```typescript
  settings: {
    setAnthropicApiKey: (apiKey) => ipcRenderer.invoke('settings:setAnthropicApiKey', apiKey),
    getAuthStatus: () => ipcRenderer.invoke('settings:getAuthStatus'),
    loginCopilot: () => ipcRenderer.invoke('settings:loginCopilot'),
    onCopilotChallenge: (listener) => {
      const wrapped = (_e: unknown, challenge: DeviceCodeChallenge): void => listener(challenge)
      ipcRenderer.on('settings:copilotChallenge', wrapped)
      return () => ipcRenderer.removeListener('settings:copilotChallenge', wrapped)
    },
    getCopilotQuota: () => ipcRenderer.invoke('settings:getCopilotQuota')
  },
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/settingsHandlers.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src/shared/types.ts src/main/ipc/settingsHandlers.ts src/main/ipc/register.ts src/preload/index.ts tests/main/ipc/settingsHandlers.test.ts
git commit -m "feat: expose GitHub Copilot quota over IPC"
```

---

## Task 3: Settings UI — quota block under the GitHub Copilot row

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.settings.getCopilotQuota(): Promise<CopilotQuota | null>` and the `CopilotQuota`/`CopilotQuotaCategory` types from Task 2's `src/shared/types.ts`.

- [ ] **Step 1: Import the type and add state**

In `src/renderer/src/components/SettingsPanel.tsx`, update the import line:

```typescript
import type { AuthStatus, CopilotQuota, DeviceCodeChallenge, ToolApprovalPolicy } from '../../../shared/types'
```

Add label maps near the existing `THEME_OPTIONS`/`TOOL_LABELS` constants (top of the file, module scope):

```typescript
const COPILOT_QUOTA_LABELS: Record<string, string> = {
  chat: 'Chat',
  completions: 'Code completions',
  premium_interactions: 'Premium requests'
}

function formatQuotaResetDate(resetDate: string): string {
  const date = new Date(resetDate)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
```

Add state inside the `SettingsPanel` component, alongside the other `useState` calls:

```typescript
  const [quota, setQuota] = useState<CopilotQuota | null>(null)
```

- [ ] **Step 2: Fetch on demand**

Add this `useEffect`, alongside the component's existing `useEffect` calls:

```typescript
  useEffect(() => {
    if (section !== 'providers' || !status?.copilot) {
      setQuota(null)
      return
    }
    window.api.settings.getCopilotQuota().then(setQuota)
  }, [section, status?.copilot])
```

- [ ] **Step 3: Render the quota block**

Find the GitHub Copilot `.settings-row` (inside the `section === 'providers'` block):

```jsx
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    GitHub Copilot
                    <StatusDot connected={!!status?.copilot} />
                  </span>
                  <span className="settings-row-desc">Sign in with a device code</span>
                  {challenge && (
                    <span className="settings-row-hint">
                      Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
                    </span>
                  )}
                  {copilotError && <span className="settings-row-error">{copilotError}</span>}
                </div>
```

Add the quota block right after `{copilotError && <span className="settings-row-error">{copilotError}</span>}`, still inside `.settings-row-text`:

```jsx
                  {copilotError && <span className="settings-row-error">{copilotError}</span>}
                  {quota && (
                    <div className="copilot-quota">
                      <span className="copilot-quota-subtitle">
                        {quota.planName} plan · resets {formatQuotaResetDate(quota.resetDate)}
                      </span>
                      {quota.categories.map((category) => (
                        <div key={category.id} className="copilot-quota-category">
                          <span className="copilot-quota-category-label">
                            {COPILOT_QUOTA_LABELS[category.id] ?? category.id}
                          </span>
                          {category.unlimited ? (
                            <span className="copilot-quota-pill">Unlimited</span>
                          ) : (
                            <div className="copilot-quota-meter">
                              <div className="copilot-quota-bar">
                                <div
                                  className="copilot-quota-bar-fill"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, category.percentRemaining))}%`,
                                    background:
                                      category.percentRemaining < 20 ? 'var(--danger)' : 'var(--success)'
                                  }}
                                />
                              </div>
                              <span className="copilot-quota-meter-text">
                                {category.remaining.toLocaleString()} / {category.entitlement.toLocaleString()}{' '}
                                remaining ({Math.round(category.percentRemaining)}%)
                                {category.overagePermitted && category.overageCount > 0
                                  ? ` · ${category.overageCount.toLocaleString()} over quota`
                                  : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 4: Add CSS**

In `src/renderer/src/theme.css`, right after the existing `.settings-row-error` rule (currently lines 1953-1956), add:

```css
.copilot-quota {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
}

.copilot-quota-subtitle {
  font-size: 12px;
  color: var(--fg-dim);
}

.copilot-quota-category {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.copilot-quota-category-label {
  flex-shrink: 0;
  width: 110px;
  font-size: 12px;
  color: var(--fg-dim);
}

.copilot-quota-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--list-active);
  font-size: 11px;
  color: var(--fg-dim);
}

.copilot-quota-meter {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.copilot-quota-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--sidebar-bg);
  overflow: hidden;
}

.copilot-quota-bar-fill {
  height: 100%;
  border-radius: 999px;
}

.copilot-quota-meter-text {
  font-size: 11px;
  color: var(--fg-dim);
  font-family: var(--font-mono);
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 6: Manual test**

Run the app (`npm run dev`), open Settings, go to Providers. With no Copilot login: confirm nothing quota-related renders (just the existing "Sign in" button). Sign in with a real GitHub Copilot account: confirm the quota block appears under the GitHub Copilot row, showing plan name, reset date, and all three categories — "Unlimited" pills for `chat`/`completions` and a progress bar with remaining/entitlement numbers for `premium_interactions` (assuming the account has that category metered; if not, confirm all three show as unlimited without error). Switch to another Settings section and back to Providers: confirm it refetches without flashing stale data.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/theme.css
git commit -m "feat: show GitHub Copilot quota in Settings"
```
