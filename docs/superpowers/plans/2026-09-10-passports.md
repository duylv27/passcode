# Passports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PassCode's four hand-built, per-provider auth blocks in Settings (Anthropic API key, Anthropic OAuth/Claude Pro-Max, Gemini API key, GitHub Copilot device sign-in) with one generic, persisted `Passport` entity and a provider-agnostic backend, so a future provider or auth method needs one new handler rather than new UI/IPC/state duplicated per case.

**Architecture:** A new `passports` SQLite table (one row per saved credential) backs a `passportsRepository.ts`. Two stateless `AuthMethodHandler` implementations (`api_key`, `oauth`) wire a Passport's credential into `ModelRuntime` without ever branching on `providerId`. A new `passportHandlers.ts` IPC layer exposes generic CRUD + activation verbs, reusing the already-built Anthropic OAuth browser/manual-code flow (currently on branch `anthropic-subscription-login`) generalized to any provider. A one-time startup migration copies existing `providerApiKeys` entries and any live OAuth credential (Copilot, or an Anthropic OAuth login from prior testing) into `passports` rows. `SettingsPanel.tsx`'s "Providers" tab becomes "Passports": a list grouped by provider with usage stats, and two popups (Add Passport wizard, View Details) replacing the four inline blocks.

**Tech Stack:** Electron main process (`node:sqlite`'s `DatabaseSync`), TypeScript, `@earendil-works/pi-coding-agent`'s `ModelRuntime`, React 18 renderer, Vitest.

## Global Constraints

- Real, persisted DB entity — not a UI-level grouping over existing storage (spec: Data Model).
- Multiple connections per provider allowed; exactly one `isActive` per `providerId`, enforced by a partial unique index (spec: Data Model).
- OAuth Passports store metadata only — no raw tokens in our DB; the SDK's own credential store keeps owning/refreshing those (spec: Scope, Data Model).
- API-key Passports store the actual key in our DB, matching today's existing trust boundary (spec: Data Model).
- Scope is global active-per-provider — no per-session/per-project overrides (spec: Scope).
- `AuthMethodHandler` implementations take `providerId` as data and never branch on it (spec: Backend Architecture).
- UI: Settings' "Providers" nav tab is renamed "Passports"; Add Passport and View Details are popups over the list, not full-panel replacements (spec: UI Design).
- No test suite existed on `origin/main` for this repo's newest state that this plan should regress — every existing test file under `tests/` must still pass after these changes.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/db/schema.ts` (modify) | Add `passports` table + partial unique index |
| `src/main/db/passportsRepository.ts` (create) | CRUD, `setActive`, `recordUsageForActiveProvider` |
| `src/shared/types.ts` (modify) | `Passport`, `PassportAuthMethod`, `PassportStatus`, `PassportOAuthPrompt`, `Api.passports` |
| `src/main/passports/authMethodHandlers.ts` (create) | `AuthMethodHandler` interface + `apiKeyAuthMethodHandler`/`oauthAuthMethodHandler` singletons |
| `src/main/passports/migratePassports.ts` (create) | One-time copy of legacy `providerApiKeys`/OAuth credentials into `passports` rows |
| `src/main/ipc/passportHandlers.ts` (create) | IPC business logic: list/create/setActive/rename/remove + the generalized OAuth flow |
| `src/main/ipc/settingsHandlers.ts` (modify) | Remove the four auth blocks' logic (kept: telemetry, Copilot quota) |
| `src/main/db/appSettingsRepository.ts` (modify) | Remove now-dead `setProviderApiKey`; add `getPassportsMigrated`/`setPassportsMigrated` |
| `src/main/ipc/sessionHandlers.ts` (modify) | Record per-turn usage against the active Passport |
| `src/main/ipc/register.ts` (modify) | Swap old `settings:*` auth channels for `passports:*` |
| `src/preload/index.ts` (modify) | Same swap, renderer-facing |
| `src/main/index.ts` (modify) | Wire `passportsRepository`, `passportHandlers`, run migration, replace the old API-key replay loop with a Passport-activation replay |
| `src/renderer/src/components/SettingsPanel.tsx` (modify) | Replace "Providers" section with "Passports": list + Add popup + Details popup |
| `src/renderer/src/theme.css` (modify) | New `.passport-*`/`.popup-*`/`.method-*` classes, built from existing real tokens |

---

### Task 1: `passports` table + `passportsRepository.ts`

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: `src/main/db/passportsRepository.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/db/passportsRepository.test.ts`

**Interfaces:**
- Produces: `Passport`, `PassportAuthMethod`, `PassportStatus` (in `src/shared/types.ts`); `PassportsRepository` with `create`, `list`, `getById`, `setActive`, `rename`, `remove`, `updateStatus`, `recordUsageForActiveProvider` (in `src/main/db/passportsRepository.ts`).

- [ ] **Step 1: Add the shared types**

Add to `src/shared/types.ts` (after `AuthStatus`, which a later task removes):

```ts
export type PassportAuthMethod = 'api_key' | 'oauth'
export type PassportStatus = 'connected' | 'error' | 'unknown'

export interface Passport {
  id: string
  providerId: string
  authMethod: PassportAuthMethod
  displayName: string
  isActive: boolean
  /** Only set for authMethod 'api_key' -- oauth Passports never store a
   * credential of our own, see docs/superpowers/specs/2026-09-10-passports-design.md. */
  apiKey: string | null
  status: PassportStatus
  lastValidatedAt: string | null
  totalInputTokens: number
  totalOutputTokens: number
  totalRequests: number
  lastUsedAt: string | null
  createdAt: string
}
```

- [ ] **Step 2: Add the schema**

In `src/main/db/schema.ts`, add a new table inside the existing `db.exec(...)` template literal (right after the `app_settings` table, before the closing backtick):

```sql

    CREATE TABLE IF NOT EXISTS passports (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      credential_data TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      last_validated_at TEXT,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      total_requests INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS passports_active_per_provider
      ON passports(provider_id) WHERE is_active = 1;
```

- [ ] **Step 3: Write the failing repository test**

Create `tests/main/db/passportsRepository.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createPassportsRepository, type PassportsRepository } from '../../../src/main/db/passportsRepository'

describe('PassportsRepository', () => {
  let repo: PassportsRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    repo = createPassportsRepository(db)
  })

  it('creates an API-key passport with the key stored and totals at zero', () => {
    const passport = repo.create({
      providerId: 'anthropic',
      authMethod: 'api_key',
      displayName: 'Personal API Key',
      apiKey: 'sk-ant-test-123'
    })
    expect(passport).toMatchObject({
      providerId: 'anthropic',
      authMethod: 'api_key',
      displayName: 'Personal API Key',
      apiKey: 'sk-ant-test-123',
      isActive: true,
      status: 'unknown',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      lastUsedAt: null
    })
  })

  it('creates an oauth passport with no stored credential', () => {
    const passport = repo.create({
      providerId: 'anthropic',
      authMethod: 'oauth',
      displayName: 'Claude Pro/Max',
      apiKey: null
    })
    expect(passport.apiKey).toBeNull()
    expect(passport.authMethod).toBe('oauth')
  })

  it('marks the first passport created for a provider as active', () => {
    const passport = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Key', apiKey: 'k' })
    expect(passport.isActive).toBe(true)
  })

  it('marks a second passport for the same provider as inactive', () => {
    repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'First', apiKey: 'k1' })
    const second = repo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Second', apiKey: null })
    expect(second.isActive).toBe(false)
  })

  it('lists passports across all providers', () => {
    repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.create({ providerId: 'google', authMethod: 'api_key', displayName: 'B', apiKey: 'k2' })
    expect(repo.list().map((p) => p.providerId).sort()).toEqual(['anthropic', 'google'])
  })

  it('gets a passport by id', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('nope')).toBeUndefined()
  })

  it('setActive flips isActive off the previously active passport and onto the target, for the same provider', () => {
    const first = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'First', apiKey: 'k1' })
    const second = repo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Second', apiKey: null })
    repo.setActive(second.id)
    expect(repo.getById(first.id)?.isActive).toBe(false)
    expect(repo.getById(second.id)?.isActive).toBe(true)
  })

  it('setActive does not affect a different provider\'s active passport', () => {
    const anthropic = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    const google = repo.create({ providerId: 'google', authMethod: 'api_key', displayName: 'G', apiKey: 'k2' })
    repo.setActive(google.id)
    expect(repo.getById(anthropic.id)?.isActive).toBe(true)
    expect(repo.getById(google.id)?.isActive).toBe(true)
  })

  it('renames a passport', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'k' })
    repo.rename(created.id, 'New Name')
    expect(repo.getById(created.id)?.displayName).toBe('New Name')
  })

  it('removes a passport', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.remove(created.id)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('updates status and lastValidatedAt', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.updateStatus(created.id, 'error')
    const updated = repo.getById(created.id)!
    expect(updated.status).toBe('error')
    expect(updated.lastValidatedAt).not.toBeNull()
  })

  it('recordUsageForActiveProvider accumulates tokens and requests on the active passport', () => {
    const passport = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.recordUsageForActiveProvider('anthropic', { inputTokens: 100, outputTokens: 50 })
    repo.recordUsageForActiveProvider('anthropic', { inputTokens: 20, outputTokens: 10 })
    const updated = repo.getById(passport.id)!
    expect(updated.totalInputTokens).toBe(120)
    expect(updated.totalOutputTokens).toBe(60)
    expect(updated.totalRequests).toBe(2)
    expect(updated.lastUsedAt).not.toBeNull()
  })

  it('recordUsageForActiveProvider is a no-op when no passport is active for that provider', () => {
    expect(() => repo.recordUsageForActiveProvider('anthropic', { inputTokens: 1, outputTokens: 1 })).not.toThrow()
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- passportsRepository`
Expected: FAIL with "Cannot find module '../../../src/main/db/passportsRepository'"

- [ ] **Step 5: Implement the repository**

Create `src/main/db/passportsRepository.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Passport, PassportAuthMethod, PassportStatus } from '../../shared/types'

interface PassportRow {
  id: string
  provider_id: string
  auth_method: PassportAuthMethod
  display_name: string
  is_active: number
  credential_data: string | null
  status: PassportStatus
  last_validated_at: string | null
  total_input_tokens: number
  total_output_tokens: number
  total_requests: number
  last_used_at: string | null
  created_at: string
}

function rowToPassport(row: PassportRow): Passport {
  let apiKey: string | null = null
  if (row.credential_data) {
    try {
      const parsed = JSON.parse(row.credential_data) as { apiKey?: unknown }
      if (typeof parsed.apiKey === 'string') apiKey = parsed.apiKey
    } catch {
      apiKey = null
    }
  }
  return {
    id: row.id,
    providerId: row.provider_id,
    authMethod: row.auth_method,
    displayName: row.display_name,
    isActive: row.is_active === 1,
    apiKey,
    status: row.status,
    lastValidatedAt: row.last_validated_at,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalRequests: row.total_requests,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at
  }
}

export interface CreatePassportInput {
  providerId: string
  authMethod: PassportAuthMethod
  displayName: string
  apiKey: string | null
}

export interface PassportsRepository {
  create(input: CreatePassportInput): Passport
  list(): Passport[]
  getById(id: string): Passport | undefined
  /** Deactivates whatever passport is currently active for this passport's
   * provider (if any) and activates this one instead. */
  setActive(id: string): void
  rename(id: string, displayName: string): void
  remove(id: string): void
  updateStatus(id: string, status: PassportStatus): void
  recordUsageForActiveProvider(providerId: string, usage: { inputTokens: number; outputTokens: number }): void
}

export function createPassportsRepository(db: DatabaseSync): PassportsRepository {
  const SELECT_COLUMNS = `
    id, provider_id, auth_method, display_name, is_active, credential_data,
    status, last_validated_at, total_input_tokens, total_output_tokens,
    total_requests, last_used_at, created_at
  `

  return {
    create(input: CreatePassportInput): Passport {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const credentialData = input.apiKey !== null ? JSON.stringify({ apiKey: input.apiKey }) : null
      // The first passport for a provider is active by default (there was
      // nothing to be active before it); a later one for the same provider
      // starts inactive so the unique index never has to reject an insert.
      const existingForProvider = db
        .prepare('SELECT COUNT(*) as count FROM passports WHERE provider_id = ?')
        .get(input.providerId) as { count: number }
      const isActive = existingForProvider.count === 0
      db.prepare(
        `INSERT INTO passports
          (id, provider_id, auth_method, display_name, is_active, credential_data, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?)`
      ).run(id, input.providerId, input.authMethod, input.displayName, isActive ? 1 : 0, credentialData, createdAt)
      return this.getById(id)!
    },
    list(): Passport[] {
      const rows = db.prepare(`SELECT ${SELECT_COLUMNS} FROM passports ORDER BY created_at`).all() as PassportRow[]
      return rows.map(rowToPassport)
    },
    getById(id: string): Passport | undefined {
      const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM passports WHERE id = ?`).get(id) as
        | PassportRow
        | undefined
      return row ? rowToPassport(row) : undefined
    },
    setActive(id: string): void {
      const target = db.prepare('SELECT provider_id FROM passports WHERE id = ?').get(id) as
        | { provider_id: string }
        | undefined
      if (!target) return
      // Both updates run in one transaction so the partial unique index
      // (at most one is_active=1 row per provider_id) is never violated
      // mid-way -- deactivate the old row before activating the new one.
      db.exec('BEGIN')
      try {
        db.prepare('UPDATE passports SET is_active = 0 WHERE provider_id = ? AND is_active = 1').run(
          target.provider_id
        )
        db.prepare('UPDATE passports SET is_active = 1 WHERE id = ?').run(id)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    rename(id: string, displayName: string): void {
      db.prepare('UPDATE passports SET display_name = ? WHERE id = ?').run(displayName, id)
    },
    remove(id: string): void {
      db.prepare('DELETE FROM passports WHERE id = ?').run(id)
    },
    updateStatus(id: string, status: PassportStatus): void {
      db.prepare('UPDATE passports SET status = ?, last_validated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        id
      )
    },
    recordUsageForActiveProvider(providerId: string, usage: { inputTokens: number; outputTokens: number }): void {
      db.prepare(
        `UPDATE passports
           SET total_input_tokens = total_input_tokens + ?,
               total_output_tokens = total_output_tokens + ?,
               total_requests = total_requests + 1,
               last_used_at = ?
         WHERE provider_id = ? AND is_active = 1`
      ).run(usage.inputTokens, usage.outputTokens, new Date().toISOString(), providerId)
    }
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- passportsRepository`
Expected: PASS (14 tests)

- [ ] **Step 7: Commit**

```bash
git add src/main/db/schema.ts src/main/db/passportsRepository.ts src/shared/types.ts tests/main/db/passportsRepository.test.ts
git commit -m "feat: add passports table and repository"
```

---

### Task 2: `AuthMethodHandler` implementations

**Files:**
- Create: `src/main/passports/authMethodHandlers.ts`
- Test: `tests/main/passports/authMethodHandlers.test.ts`

**Interfaces:**
- Consumes: `Passport`, `PassportStatus` (Task 1).
- Produces: `AuthMethodHandler`, `ModelRuntimeLike` (this task's own minimal shape), `apiKeyAuthMethodHandler`, `oauthAuthMethodHandler`, `getAuthMethodHandler(method: PassportAuthMethod): AuthMethodHandler`.

- [ ] **Step 1: Write the failing test**

Create `tests/main/passports/authMethodHandlers.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  apiKeyAuthMethodHandler,
  oauthAuthMethodHandler,
  getAuthMethodHandler,
  type ModelRuntimeLike
} from '../../../src/main/passports/authMethodHandlers'
import type { Passport } from '../../../src/shared/types'

function makePassport(overrides: Partial<Passport> = {}): Passport {
  return {
    id: 'p1',
    providerId: 'anthropic',
    authMethod: 'api_key',
    displayName: 'Test',
    isActive: true,
    apiKey: 'sk-ant-test',
    status: 'unknown',
    lastValidatedAt: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalRequests: 0,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('apiKeyAuthMethodHandler', () => {
  it('activate sets the runtime API key from the passport', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined)
    }
    await apiKeyAuthMethodHandler.activate(makePassport({ apiKey: 'sk-ant-abc' }), modelRuntime)
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-abc')
  })

  it('activate throws if the passport has no stored key', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined)
    }
    await expect(apiKeyAuthMethodHandler.activate(makePassport({ apiKey: null }), modelRuntime)).rejects.toThrow()
  })

  it('deactivate removes the runtime API key for the passport\'s provider', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined)
    }
    await apiKeyAuthMethodHandler.deactivate(makePassport({ providerId: 'google' }), modelRuntime)
    expect(modelRuntime.removeRuntimeApiKey).toHaveBeenCalledWith('google')
  })

  it('checkStatus reports connected when checkAuth resolves a value', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => ({ type: 'api_key' as const }))
    }
    expect(await apiKeyAuthMethodHandler.checkStatus(makePassport(), modelRuntime)).toBe('connected')
  })

  it('checkStatus reports error when checkAuth resolves undefined', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined)
    }
    expect(await apiKeyAuthMethodHandler.checkStatus(makePassport(), modelRuntime)).toBe('error')
  })
})

describe('oauthAuthMethodHandler', () => {
  it('activate and deactivate are no-ops', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined)
    }
    await oauthAuthMethodHandler.activate(makePassport({ authMethod: 'oauth', apiKey: null }), modelRuntime)
    await oauthAuthMethodHandler.deactivate(makePassport({ authMethod: 'oauth', apiKey: null }), modelRuntime)
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
    expect(modelRuntime.removeRuntimeApiKey).not.toHaveBeenCalled()
  })

  it('checkStatus reports connected when checkAuth resolves a value', async () => {
    const modelRuntime: ModelRuntimeLike = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => ({ type: 'oauth' as const }))
    }
    expect(
      await oauthAuthMethodHandler.checkStatus(makePassport({ authMethod: 'oauth', apiKey: null }), modelRuntime)
    ).toBe('connected')
  })
})

describe('getAuthMethodHandler', () => {
  it('returns the api_key handler for api_key', () => {
    expect(getAuthMethodHandler('api_key')).toBe(apiKeyAuthMethodHandler)
  })

  it('returns the oauth handler for oauth', () => {
    expect(getAuthMethodHandler('oauth')).toBe(oauthAuthMethodHandler)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- authMethodHandlers`
Expected: FAIL with "Cannot find module '../../../src/main/passports/authMethodHandlers'"

- [ ] **Step 3: Implement**

Create `src/main/passports/authMethodHandlers.ts`:

```ts
import type { AuthCheck } from '@earendil-works/pi-ai'
import type { Passport, PassportAuthMethod, PassportStatus } from '../../shared/types'

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>
  removeRuntimeApiKey(providerId: string): Promise<void>
  checkAuth(providerId: string): Promise<AuthCheck | undefined>
}

/** One implementation per auth METHOD, not per provider -- every method
 * here takes providerId as plain data from the passport and never branches
 * on it, which is what makes a fifth provider free as long as it uses
 * 'api_key' or 'oauth'. See docs/superpowers/specs/2026-09-10-passports-design.md. */
export interface AuthMethodHandler {
  activate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  deactivate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  checkStatus(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<PassportStatus>
}

export const apiKeyAuthMethodHandler: AuthMethodHandler = {
  async activate(passport, modelRuntime) {
    if (!passport.apiKey) throw new Error(`Passport ${passport.id} has no stored API key`)
    await modelRuntime.setRuntimeApiKey(passport.providerId, passport.apiKey)
  },
  async deactivate(passport, modelRuntime) {
    await modelRuntime.removeRuntimeApiKey(passport.providerId)
  },
  async checkStatus(passport, modelRuntime) {
    const auth = await modelRuntime.checkAuth(passport.providerId)
    return auth !== undefined ? 'connected' : 'error'
  }
}

export const oauthAuthMethodHandler: AuthMethodHandler = {
  // The real login()/logout() calls already ran once during creation/removal
  // (see passportHandlers.ts) -- switching which OAuth passport is
  // "active" is bookkeeping only, since the SDK's own credential store
  // holds at most one OAuth credential per provider regardless.
  async activate() {},
  async deactivate() {},
  async checkStatus(passport, modelRuntime) {
    const auth = await modelRuntime.checkAuth(passport.providerId)
    return auth !== undefined ? 'connected' : 'error'
  }
}

export function getAuthMethodHandler(method: PassportAuthMethod): AuthMethodHandler {
  return method === 'api_key' ? apiKeyAuthMethodHandler : oauthAuthMethodHandler
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- authMethodHandlers`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/passports/authMethodHandlers.ts tests/main/passports/authMethodHandlers.test.ts
git commit -m "feat: add generic auth method handlers for passports"
```

---

### Task 3: `passportHandlers.ts` IPC layer (CRUD + activation + OAuth flow)

This generalizes the Anthropic-only OAuth flow already built on branch `anthropic-subscription-login` (`.claude/worktrees/anthropic-oauth`, file `src/main/ipc/settingsHandlers.ts`'s `loginAnthropicOAuth`/`submitAnthropicOAuthCode`/`cancelAnthropicOAuth`) so it works for any provider's OAuth, and also covers GitHub Copilot's device-code OAuth flow (currently `loginCopilot` in `src/main/ipc/settingsHandlers.ts` on `main`) under the same generic `createOAuthPassport` verb.

**Files:**
- Create: `src/main/ipc/passportHandlers.ts`
- Modify: `src/shared/types.ts` (add `PassportOAuthPrompt`, `Api.passports`)
- Test: `tests/main/ipc/passportHandlers.test.ts`

**Interfaces:**
- Consumes: `PassportsRepository` (Task 1), `getAuthMethodHandler` (Task 2), `validateAnthropicApiKey`/`validateGeminiApiKey` (existing `src/main/agent/providerValidation.ts`).
- Produces: `PassportHandlers` with `listPassports(): Passport[]`, `createApiKeyPassport(providerId, displayName, apiKey): Promise<{ok:true; passport:Passport} | {ok:false; error:string}>`, `createOAuthPassport(providerId, displayName, onPrompt): Promise<{ok:true; passport:Passport} | {ok:false; error:string}>`, `submitOAuthCode(code: string): void`, `cancelOAuth(): void`, `setActivePassport(id: string): Promise<void>`, `renamePassport(id: string, displayName: string): void`, `removePassport(id: string): Promise<void>`.

- [ ] **Step 1: Add the OAuth prompt type and `Api.passports` surface**

Add to `src/shared/types.ts`, near the other Passport types added in Task 1:

```ts
/** A generic OAuth interaction prompt, covering both shapes the SDK's real
 * login() flows raise today: GitHub Copilot's device code (visit a URL,
 * type a short code) and Anthropic's browser + manual-code fallback (open
 * a URL, optionally paste back a code if the redirect doesn't complete). */
export type PassportOAuthPrompt =
  | { kind: 'device_code'; userCode: string; verificationUri: string }
  | { kind: 'browser'; url: string; instructions?: string }
```

Add a `passports` member to the `Api` interface (after `settings`):

```ts
  passports: {
    list(): Promise<Passport[]>
    createApiKey(
      providerId: string,
      displayName: string,
      apiKey: string
    ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
    createOAuth(
      providerId: string,
      displayName: string
    ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
    onOAuthPrompt(listener: (prompt: PassportOAuthPrompt) => void): () => void
    submitOAuthCode(code: string): Promise<void>
    cancelOAuth(): Promise<void>
    setActive(id: string): Promise<void>
    rename(id: string, displayName: string): Promise<void>
    remove(id: string): Promise<void>
  }
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/ipc/passportHandlers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPassportHandlers, type PassportHandlers } from '../../../src/main/ipc/passportHandlers'
import type { ModelRuntimeLike } from '../../../src/main/passports/authMethodHandlers'
import type { PassportsRepository, CreatePassportInput } from '../../../src/main/db/passportsRepository'
import type { Passport } from '../../../src/shared/types'

const { validateAnthropicApiKeyMock, validateGeminiApiKeyMock } = vi.hoisted(() => ({
  validateAnthropicApiKeyMock: vi.fn(async () => ({ ok: true as const })),
  validateGeminiApiKeyMock: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../../src/main/agent/providerValidation', () => ({
  validateAnthropicApiKey: validateAnthropicApiKeyMock,
  validateGeminiApiKey: validateGeminiApiKeyMock
}))

function makeFakeRepo(): PassportsRepository & { rows: Passport[] } {
  const rows: Passport[] = []
  return {
    rows,
    create(input: CreatePassportInput): Passport {
      const passport: Passport = {
        id: `id-${rows.length + 1}`,
        providerId: input.providerId,
        authMethod: input.authMethod,
        displayName: input.displayName,
        isActive: !rows.some((r) => r.providerId === input.providerId),
        apiKey: input.apiKey,
        status: 'unknown',
        lastValidatedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
      rows.push(passport)
      return passport
    },
    list: () => [...rows],
    getById: (id) => rows.find((r) => r.id === id),
    setActive: (id) => {
      const target = rows.find((r) => r.id === id)
      if (!target) return
      for (const r of rows) if (r.providerId === target.providerId) r.isActive = r.id === id
    },
    rename: (id, displayName) => {
      const target = rows.find((r) => r.id === id)
      if (target) target.displayName = displayName
    },
    remove: (id) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx !== -1) rows.splice(idx, 1)
    },
    updateStatus: (id, status) => {
      const target = rows.find((r) => r.id === id)
      if (target) target.status = status
    },
    recordUsageForActiveProvider: () => {}
  }
}

describe('passportHandlers', () => {
  let passportsRepo: ReturnType<typeof makeFakeRepo>
  let modelRuntime: ModelRuntimeLike & { login: ReturnType<typeof vi.fn> }
  let openExternal: ReturnType<typeof vi.fn>
  let handlers: PassportHandlers

  beforeEach(() => {
    passportsRepo = makeFakeRepo()
    validateAnthropicApiKeyMock.mockReset().mockResolvedValue({ ok: true })
    validateGeminiApiKeyMock.mockReset().mockResolvedValue({ ok: true })
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined),
      login: vi.fn(async () => ({ type: 'oauth', refresh: '', access: '', expires: 0 }) as never)
    }
    openExternal = vi.fn()
    handlers = createPassportHandlers(passportsRepo, modelRuntime, openExternal)
  })

  it('lists passports from the repository', () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    expect(handlers.listPassports()).toHaveLength(1)
  })

  it('creates a valid API-key passport, activating it on the runtime', async () => {
    const result = await handlers.createApiKeyPassport('anthropic', 'My Key', 'sk-ant-123')
    expect(result.ok).toBe(true)
    expect(validateAnthropicApiKeyMock).toHaveBeenCalledWith('sk-ant-123')
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-123')
    if (result.ok) expect(result.passport.displayName).toBe('My Key')
  })

  it('rejects an API key that fails live validation, without creating a passport', async () => {
    validateAnthropicApiKeyMock.mockResolvedValue({ ok: false, error: 'Anthropic rejected this key' })
    const result = await handlers.createApiKeyPassport('anthropic', 'Bad Key', 'sk-bad')
    expect(result).toEqual({ ok: false, error: 'Anthropic rejected this key' })
    expect(passportsRepo.rows).toHaveLength(0)
  })

  it('rejects an empty API key', async () => {
    const result = await handlers.createApiKeyPassport('anthropic', 'Empty', '   ')
    expect(result).toEqual({ ok: false, error: 'API key must not be empty' })
    expect(validateAnthropicApiKeyMock).not.toHaveBeenCalled()
  })

  it('validates google keys with validateGeminiApiKey', async () => {
    await handlers.createApiKeyPassport('google', 'My Gemini Key', 'AIza-123')
    expect(validateGeminiApiKeyMock).toHaveBeenCalledWith('AIza-123')
  })

  it('deactivates the previously active passport for the provider before activating a new API-key passport', async () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Old OAuth', apiKey: null })
    await handlers.createApiKeyPassport('anthropic', 'New Key', 'sk-ant-999')
    // The old oauth passport is no longer active; deactivating it is a
    // no-op on the runtime (oauthAuthMethodHandler), but setRuntimeApiKey
    // for the new one must still have been called.
    expect(passportsRepo.rows.find((r) => r.displayName === 'Old OAuth')?.isActive).toBe(false)
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-999')
  })

  it('creates an oauth passport via the browser flow and opens the URL', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (e: unknown) => void }) => {
        interaction.notify({ type: 'auth_url', url: 'https://claude.ai/oauth/authorize?x=1', instructions: 'go' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const prompts: unknown[] = []
    const result = await handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', (p) => prompts.push(p))
    expect(result.ok).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?x=1')
    expect(prompts).toEqual([{ kind: 'browser', url: 'https://claude.ai/oauth/authorize?x=1', instructions: 'go' }])
  })

  it('creates an oauth passport via the device-code flow without opening a browser itself', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (e: unknown) => void }) => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const prompts: unknown[] = []
    const result = await handlers.createOAuthPassport('github-copilot', 'Copilot', (p) => prompts.push(p))
    expect(result.ok).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
    expect(prompts).toEqual([{ kind: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }])
  })

  it('answers a text prompt during oauth login automatically', async () => {
    let prompted: string | undefined
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        prompted = await interaction.prompt({ type: 'text' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    await handlers.createOAuthPassport('github-copilot', 'Copilot', () => {})
    expect(prompted).toBe('')
  })

  it('resolves a pending manual_code prompt via submitOAuthCode', async () => {
    let resolvedCode: string | undefined
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        resolvedCode = await interaction.prompt({ type: 'manual_code' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const promise = handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    // Give the mocked login() a tick to reach its prompt() call before we submit.
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.submitOAuthCode('the-pasted-code')
    await promise
    expect(resolvedCode).toBe('the-pasted-code')
  })

  it('rejects the pending manual_code prompt via cancelOAuth', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        await interaction.prompt({ type: 'manual_code' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const promise = handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.cancelOAuth()
    const result = await promise
    expect(result).toEqual({ ok: false, error: 'Sign-in cancelled' })
  })

  it('reports a failed oauth login', async () => {
    modelRuntime.login.mockRejectedValueOnce(new Error('user cancelled'))
    const result = await handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    expect(result).toEqual({ ok: false, error: 'user cancelled' })
  })

  it('setActivePassport activates the target on the runtime and deactivates the previous one', async () => {
    const oldKey = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'old' })
    const oauth = passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'New', apiKey: null })
    await handlers.setActivePassport(oauth.id)
    expect(modelRuntime.removeRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(passportsRepo.getById(oldKey.id)?.isActive).toBe(false)
    expect(passportsRepo.getById(oauth.id)?.isActive).toBe(true)
  })

  it('renamePassport delegates to the repository', () => {
    const passport = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'k' })
    handlers.renamePassport(passport.id, 'New Name')
    expect(passportsRepo.getById(passport.id)?.displayName).toBe('New Name')
  })

  it('removePassport deactivates an active passport on the runtime before deleting it', async () => {
    const passport = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    await handlers.removePassport(passport.id)
    expect(modelRuntime.removeRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(passportsRepo.getById(passport.id)).toBeUndefined()
  })

  it('removePassport does not touch the runtime for an inactive passport', async () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Active', apiKey: 'k' })
    const inactive = passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Inactive', apiKey: null })
    await handlers.removePassport(inactive.id)
    expect(modelRuntime.removeRuntimeApiKey).not.toHaveBeenCalled()
    expect(passportsRepo.getById(inactive.id)).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- passportHandlers`
Expected: FAIL with "Cannot find module '../../../src/main/ipc/passportHandlers'"

- [ ] **Step 4: Implement**

Create `src/main/ipc/passportHandlers.ts`:

```ts
import type { AuthType, Credential } from '@earendil-works/pi-ai'
import { validateAnthropicApiKey, validateGeminiApiKey } from '../agent/providerValidation'
import { getAuthMethodHandler, type ModelRuntimeLike } from '../passports/authMethodHandlers'
import type { PassportsRepository } from '../db/passportsRepository'
import type { Passport, PassportOAuthPrompt } from '../../shared/types'

export interface PassportModelRuntimeLike extends ModelRuntimeLike {
  login(
    providerId: string,
    type: AuthType,
    interaction: {
      notify: (event: unknown) => void
      prompt: (prompt: { type: string; signal?: AbortSignal }) => Promise<string>
    }
  ): Promise<Credential>
}

export interface PassportHandlers {
  listPassports(): Passport[]
  createApiKeyPassport(
    providerId: string,
    displayName: string,
    apiKey: string
  ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
  createOAuthPassport(
    providerId: string,
    displayName: string,
    onPrompt: (prompt: PassportOAuthPrompt) => void
  ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
  submitOAuthCode(code: string): void
  cancelOAuth(): void
  setActivePassport(id: string): Promise<void>
  renamePassport(id: string, displayName: string): void
  removePassport(id: string): Promise<void>
}

async function validateApiKey(
  providerId: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (providerId === 'anthropic') return validateAnthropicApiKey(apiKey)
  if (providerId === 'google') return validateGeminiApiKey(apiKey)
  return { ok: true }
}

export function createPassportHandlers(
  passportsRepo: PassportsRepository,
  modelRuntime: PassportModelRuntimeLike,
  openExternal: (url: string) => void
): PassportHandlers {
  // Set only while a manual_code prompt from an OAuth flow (Anthropic's
  // browser fallback) is pending -- resolved by submitOAuthCode() once the
  // user pastes something back, or rejected by cancelOAuth()/the flow's own
  // abort signal firing first (the browser redirect already won the race).
  let pendingCode: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null

  async function activatePassport(passport: Passport): Promise<void> {
    const previous = passportsRepo.list().find((p) => p.providerId === passport.providerId && p.isActive)
    if (previous && previous.id !== passport.id) {
      await getAuthMethodHandler(previous.authMethod).deactivate(previous, modelRuntime)
    }
    await getAuthMethodHandler(passport.authMethod).activate(passport, modelRuntime)
    passportsRepo.setActive(passport.id)
  }

  return {
    listPassports(): Passport[] {
      return passportsRepo.list()
    },
    async createApiKeyPassport(providerId, displayName, apiKey) {
      const trimmed = apiKey.trim()
      if (!trimmed) return { ok: false, error: 'API key must not be empty' }
      const validation = await validateApiKey(providerId, trimmed)
      if (!validation.ok) return validation
      const passport = passportsRepo.create({ providerId, authMethod: 'api_key', displayName, apiKey: trimmed })
      try {
        await activatePassport(passport)
      } catch (err) {
        passportsRepo.remove(passport.id)
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, passport: passportsRepo.getById(passport.id)! }
    },
    async createOAuthPassport(providerId, displayName, onPrompt) {
      try {
        await modelRuntime.login(providerId, 'oauth', {
          notify: (event) => {
            const e = event as { type?: string; url?: string; instructions?: string; userCode?: string; verificationUri?: string }
            if (e.type === 'auth_url' && e.url) {
              openExternal(e.url)
              onPrompt({ kind: 'browser', url: e.url, instructions: e.instructions })
            } else if (e.type === 'device_code' && e.userCode && e.verificationUri) {
              onPrompt({ kind: 'device_code', userCode: e.userCode, verificationUri: e.verificationUri })
            }
          },
          prompt: (prompt) => {
            // A GitHub Enterprise-domain prompt (Copilot) or any other
            // plain text prompt: blank means "use the default", the only
            // case we have UI for.
            if (prompt.type === 'text') return Promise.resolve('')
            if (prompt.type === 'manual_code') {
              return new Promise<string>((resolve, reject) => {
                pendingCode = { resolve, reject }
                prompt.signal?.addEventListener(
                  'abort',
                  () => {
                    pendingCode = null
                    reject(new Error('Sign-in completed another way'))
                  },
                  { once: true }
                )
              })
            }
            return Promise.reject(new Error(`Interactive login prompt of type "${prompt.type}" is not supported yet`))
          }
        })
        const passport = passportsRepo.create({ providerId, authMethod: 'oauth', displayName, apiKey: null })
        await activatePassport(passport)
        return { ok: true, passport: passportsRepo.getById(passport.id)! }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        pendingCode = null
      }
    },
    submitOAuthCode(code) {
      if (!pendingCode) return
      pendingCode.resolve(code)
      pendingCode = null
    },
    cancelOAuth() {
      if (!pendingCode) return
      pendingCode.reject(new Error('Sign-in cancelled'))
      pendingCode = null
    },
    async setActivePassport(id) {
      const passport = passportsRepo.getById(id)
      if (!passport) return
      await activatePassport(passport)
    },
    renamePassport(id, displayName) {
      passportsRepo.rename(id, displayName)
    },
    async removePassport(id) {
      const passport = passportsRepo.getById(id)
      if (!passport) return
      if (passport.isActive) {
        await getAuthMethodHandler(passport.authMethod).deactivate(passport, modelRuntime)
      }
      passportsRepo.remove(id)
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- passportHandlers`
Expected: PASS (18 tests)

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/passportHandlers.ts src/shared/types.ts tests/main/ipc/passportHandlers.test.ts
git commit -m "feat: add generic passport IPC handlers with OAuth flow"
```

---

### Task 4: One-time migration from legacy `providerApiKeys`/OAuth credentials

**Files:**
- Create: `src/main/passports/migratePassports.ts`
- Modify: `src/main/db/appSettingsRepository.ts` (add `getPassportsMigrated`/`setPassportsMigrated`; remove `setProviderApiKey` -- dead after Task 6 cuts over `settingsHandlers.ts`, see Task 6)
- Test: `tests/main/passports/migratePassports.test.ts`
- Test: `tests/main/db/appSettingsRepository.test.ts` (extend for the new flag; remove the now-invalid `setProviderApiKey` assertions)

**Interfaces:**
- Consumes: `PassportsRepository.create` (Task 1), `PassportModelRuntimeLike.checkAuth` (Task 3, only the `checkAuth` member is needed here).
- Produces: `migratePassportsFromLegacyAuth(deps): Promise<void>`.

- [ ] **Step 1: Extend `appSettingsRepository.test.ts`**

In `tests/main/db/appSettingsRepository.test.ts`, remove the three `setProviderApiKey`-based `it(...)` blocks (`'persists and retrieves a saved provider API key'`, `'accumulates keys for multiple providers...'`, `'overwrites a previously saved key for the same provider...'`, `'does not let a saved provider API key leak...'`) and their now-unused `setProviderApiKey` calls, but **keep** `'returns no provider API keys when none has been saved'` (renamed conceptually to reflect it now only reads, never writes, legacy data) -- `getProviderApiKeys` stays as the migration's read-only source. Add:

```ts
  it('returns false for passportsMigrated when it has not been set', () => {
    expect(repo.getPassportsMigrated()).toBe(false)
  })

  it('persists passportsMigrated once set', () => {
    repo.setPassportsMigrated()
    expect(repo.getPassportsMigrated()).toBe(true)
  })
```

Since `setProviderApiKey` is removed, the one remaining `getProviderApiKeys` test needs a way to seed a key for the "returns no provider API keys" negative case only -- no seeding needed there (it asserts the empty case), so no other change is required in that file. Also remove `setProviderApiKey` from the exported test... nothing further needed here since it's a `.test.ts` file, not a mock.

- [ ] **Step 2: Update `appSettingsRepository.ts`**

In `src/main/db/appSettingsRepository.ts`, remove `setProviderApiKey` from both the `AppSettingsRepository` interface and its implementation (it becomes dead once Task 6 removes its only callers). Add a migration flag key and two new interface members, following the exact pattern `getGeneralRepo`/`setGeneralRepo` already use:

```ts
const PASSPORTS_MIGRATED_KEY = 'passportsMigrated'
```

(place this near `GENERAL_REPO_KEY`). In the `AppSettingsRepository` interface, replace:

```ts
  getProviderApiKeys(): Record<string, string>
  setProviderApiKey(providerId: string, apiKey: string): void
```

with:

```ts
  /** Read-only now -- values here are the one-time source
   * migratePassportsFromLegacyAuth() copies into `passports` rows; nothing
   * writes through this path anymore. */
  getProviderApiKeys(): Record<string, string>
  getPassportsMigrated(): boolean
  setPassportsMigrated(): void
```

In the implementation, remove the `setProviderApiKey` method body and add:

```ts
    getPassportsMigrated(): boolean {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PASSPORTS_MIGRATED_KEY) as
        | { value: string }
        | undefined
      return row?.value === 'true'
    },
    setPassportsMigrated(): void {
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(PASSPORTS_MIGRATED_KEY, 'true')
    },
```

- [ ] **Step 3: Run the appSettingsRepository test to verify it passes**

Run: `npm test -- appSettingsRepository`
Expected: PASS

- [ ] **Step 4: Write the failing migration test**

Create `tests/main/passports/migratePassports.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migratePassportsFromLegacyAuth } from '../../../src/main/passports/migratePassports'
import type { PassportsRepository, CreatePassportInput } from '../../../src/main/db/passportsRepository'
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
import type { Passport } from '../../../src/shared/types'

function makeFakeRepo(): PassportsRepository & { rows: Passport[] } {
  const rows: Passport[] = []
  return {
    rows,
    create(input: CreatePassportInput): Passport {
      const passport: Passport = {
        id: `id-${rows.length + 1}`,
        providerId: input.providerId,
        authMethod: input.authMethod,
        displayName: input.displayName,
        isActive: true,
        apiKey: input.apiKey,
        status: 'unknown',
        lastValidatedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
      rows.push(passport)
      return passport
    },
    list: () => [...rows],
    getById: (id) => rows.find((r) => r.id === id),
    setActive: () => {},
    rename: () => {},
    remove: () => {},
    updateStatus: () => {},
    recordUsageForActiveProvider: () => {}
  }
}

describe('migratePassportsFromLegacyAuth', () => {
  let passportsRepo: ReturnType<typeof makeFakeRepo>
  let appSettingsRepo: Pick<
    AppSettingsRepository,
    'getProviderApiKeys' | 'getPassportsMigrated' | 'setPassportsMigrated'
  >
  let migrated: boolean
  let checkAuth: ReturnType<typeof vi.fn>

  beforeEach(() => {
    passportsRepo = makeFakeRepo()
    migrated = false
    appSettingsRepo = {
      getProviderApiKeys: () => ({}),
      getPassportsMigrated: () => migrated,
      setPassportsMigrated: () => {
        migrated = true
      }
    }
    checkAuth = vi.fn(async () => undefined)
  })

  it('does nothing when already migrated', async () => {
    migrated = true
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123' })
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(0)
  })

  it('creates an api_key passport for each legacy provider API key', async () => {
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123', google: 'AIza-456' })
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(2)
    expect(passportsRepo.rows.find((r) => r.providerId === 'anthropic')).toMatchObject({
      authMethod: 'api_key',
      apiKey: 'sk-ant-123',
      displayName: 'Anthropic API Key'
    })
    expect(passportsRepo.rows.find((r) => r.providerId === 'google')).toMatchObject({
      authMethod: 'api_key',
      apiKey: 'AIza-456',
      displayName: 'Google API Key'
    })
  })

  it('creates an oauth passport for a provider with a live OAuth credential and no api key', async () => {
    checkAuth.mockImplementation(async (providerId: string) =>
      providerId === 'github-copilot' ? { type: 'oauth' as const } : undefined
    )
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(1)
    expect(passportsRepo.rows[0]).toMatchObject({
      providerId: 'github-copilot',
      authMethod: 'oauth',
      apiKey: null,
      displayName: 'GitHub Copilot'
    })
  })

  it('does not create an oauth passport for a provider that already got an api_key passport', async () => {
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123' })
    checkAuth.mockImplementation(async (providerId: string) => (providerId === 'anthropic' ? { type: 'oauth' as const } : undefined))
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(1)
    expect(passportsRepo.rows[0].authMethod).toBe('api_key')
  })

  it('marks migration complete even when there is nothing to migrate', async () => {
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(migrated).toBe(true)
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npm test -- migratePassports`
Expected: FAIL with "Cannot find module '../../../src/main/passports/migratePassports'"

- [ ] **Step 6: Implement**

Create `src/main/passports/migratePassports.ts`:

```ts
import type { AuthCheck } from '@earendil-works/pi-ai'
import type { PassportsRepository } from '../db/passportsRepository'
import type { AppSettingsRepository } from '../db/appSettingsRepository'

const KNOWN_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  'github-copilot': 'GitHub Copilot'
}

function displayNameFor(providerId: string, suffix: string): string {
  const provider = KNOWN_PROVIDER_DISPLAY_NAMES[providerId] ?? providerId
  return suffix ? `${provider} ${suffix}` : provider
}

export interface MigratePassportsDeps {
  appSettingsRepo: Pick<AppSettingsRepository, 'getProviderApiKeys' | 'getPassportsMigrated' | 'setPassportsMigrated'>
  passportsRepo: PassportsRepository
  checkAuth: (providerId: string) => Promise<AuthCheck | undefined>
}

/** One-time, idempotent copy of every credential PassCode already knew
 * about before Passports existed into real `passports` rows: each legacy
 * providerApiKeys entry becomes an api_key Passport, and any provider with
 * a live OAuth credential (Copilot's device sign-in, or a prior Anthropic
 * OAuth login) but no API key becomes an oauth Passport. Never deletes the
 * underlying credential -- only ever adds rows. Gated by a persisted flag
 * so it runs at most once, regardless of how many providers it finds. */
export async function migratePassportsFromLegacyAuth(deps: MigratePassportsDeps): Promise<void> {
  if (deps.appSettingsRepo.getPassportsMigrated()) return

  const legacyApiKeys = deps.appSettingsRepo.getProviderApiKeys()
  const migratedProviders = new Set<string>()

  for (const [providerId, apiKey] of Object.entries(legacyApiKeys)) {
    deps.passportsRepo.create({
      providerId,
      authMethod: 'api_key',
      displayName: displayNameFor(providerId, 'API Key'),
      apiKey
    })
    migratedProviders.add(providerId)
  }

  const candidateOAuthProviders = ['anthropic', 'google', 'github-copilot']
  for (const providerId of candidateOAuthProviders) {
    if (migratedProviders.has(providerId)) continue
    const auth = await deps.checkAuth(providerId)
    if (auth?.type === 'oauth') {
      deps.passportsRepo.create({
        providerId,
        authMethod: 'oauth',
        displayName: displayNameFor(providerId, ''),
        apiKey: null
      })
    }
  }

  deps.appSettingsRepo.setPassportsMigrated()
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- migratePassports`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add src/main/passports/migratePassports.ts src/main/db/appSettingsRepository.ts tests/main/passports/migratePassports.test.ts tests/main/db/appSettingsRepository.test.ts
git commit -m "feat: migrate legacy provider auth into passports once"
```

---

### Task 5: Record per-turn usage against the active Passport

**Files:**
- Modify: `src/main/ipc/sessionHandlers.ts`
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `PassportsRepository.recordUsageForActiveProvider` (Task 1), wired in as a plain function so `sessionHandlers.ts` stays ignorant of Passport internals.
- Produces: new optional `CreateSessionHandlersDeps.recordPassportUsage?: (providerId: string, usage: { inputTokens: number; outputTokens: number }) => void`.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc/sessionHandlers.test.ts`, find the existing `it('emits a usage telemetry record when a model_usage event arrives...'` block (constructs a local `localHandlers` via `createSessionHandlers({ ...baseDeps, getUsageTelemetryConfig: () => telemetryConfig })`) and add a new test right after it, following the same "construct a local handlers instance with one extra dep" pattern:

```ts
  it('records usage against the active passport for the model\'s provider when a model_usage event arrives', async () => {
    const recordedUsage: Array<{ providerId: string; usage: { inputTokens: number; outputTokens: number } }> = []
    const localHandlers = createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text,
      recordPassportUsage: (providerId, usage) => recordedUsage.push({ providerId, usage })
    })
    const session = localHandlers.createSession(repoId)
    await localHandlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never
    await localHandlers.sendPrompt(session.id, 'hi')
    subscribeListener?.({
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } }
    })
    expect(recordedUsage).toEqual([{ providerId: 'anthropic', usage: { inputTokens: 100, outputTokens: 50 } }])
  })

  it('does not record passport usage when recordPassportUsage is not provided', async () => {
    // No assertion needed beyond "doesn't throw" -- recordPassportUsage is
    // optional exactly like getUsageTelemetryConfig, for callers (tests,
    // or a future embedding) that don't care about Passport bookkeeping.
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never
    await handlers.sendPrompt(session.id, 'hi')
    expect(() =>
      subscribeListener?.({
        type: 'message_end',
        message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } }
      })
    ).not.toThrow()
  })
```

Check the top of the existing test file for the exact names already in scope (`reposRepo`, `projectsRepo`, `sessionsRepo`, `openRepoSessionMock`, `findModelMock`, `repoId`, `currentModel`, `subscribeListener`, `handlers`) -- reuse them verbatim; do not redeclare.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- sessionHandlers`
Expected: FAIL -- `recordPassportUsage` is not a recognized dependency, so `recordedUsage` stays empty and the first new assertion fails.

- [ ] **Step 3: Implement**

In `src/main/ipc/sessionHandlers.ts`, add the new optional dependency to `CreateSessionHandlersDeps` (right after `getUsageTelemetryConfig`):

```ts
  /** Called once per real model call (same granularity as the usage
   * telemetry record above) so a Passport's totals reflect what's actually
   * been billed against it. Omitted entirely when the caller doesn't wire
   * Passport usage tracking at all. */
  recordPassportUsage?: (providerId: string, usage: { inputTokens: number; outputTokens: number }) => void
```

Then, inside the `repoSession.subscribe((event) => { ... })` callback, in the `if (item.type === 'model_usage') { ... }` branch, add the call right after the existing `appendUsageTelemetryRecord` block:

```ts
        if (item.type === 'model_usage') {
          pendingActionUsage = item.usage
          if (deps.getUsageTelemetryConfig) {
            const model = repoSession.getModel()
            if (model) {
              appendUsageTelemetryRecord(deps.getUsageTelemetryConfig(), {
                model: { provider: model.provider, id: model.id, name: model.name },
                usage: item.usage,
                sessionId: piSessionId
              })
            }
          }
          if (deps.recordPassportUsage) {
            const model = repoSession.getModel()
            if (model) {
              deps.recordPassportUsage(model.provider, {
                inputTokens: item.usage.input,
                outputTokens: item.usage.output
              })
            }
          }
          continue
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- sessionHandlers`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/sessionHandlers.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "feat: record per-turn usage against the active passport"
```

---

### Task 6: Wire it all up (register.ts, preload, main/index.ts, settingsHandlers cutover)

**Files:**
- Modify: `src/main/ipc/settingsHandlers.ts` (remove the four auth blocks' logic; keep telemetry + Copilot quota)
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/types.ts` (remove `AuthStatus`, `DeviceCodeChallenge` stays -- still used by nothing now that `loginCopilot`'s challenge event moves under `passports:*`, so remove it too if nothing else references it)
- Test: `tests/main/ipc/settingsHandlers.test.ts` (remove now-invalid auth tests; keep telemetry tests)

**Interfaces:**
- Consumes: `createPassportHandlers` (Task 3), `migratePassportsFromLegacyAuth` (Task 4), `createPassportsRepository` (Task 1).

- [ ] **Step 1: Update `settingsHandlers.test.ts`**

In `tests/main/ipc/settingsHandlers.test.ts`, remove every `it(...)` that exercises `setAnthropicApiKey`, `setGeminiApiKey`, `getAuthStatus`, or `loginCopilot` (these move to `passportHandlers.test.ts`, already covering the equivalent behavior). Remove the now-unused `validateAnthropicApiKeyMock`/`validateGeminiApiKeyMock` mock block entirely (nothing in the trimmed file calls those functions any more). Remove `setRuntimeApiKey`/`checkAuth`/`login`/`getProviderApiKeys`/`setProviderApiKey` from the `modelRuntime`/`appSettingsRepo` fakes in `beforeEach` (no longer part of `ModelRuntimeLike` for this file -- see Step 2). The trimmed file should end up with only: the `beforeEach` construction, and the `getUsageTelemetryConfig`/`setUsageTelemetryConfig` tests. It should read:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSettingsHandlers, type SettingsHandlers } from '../../../src/main/ipc/settingsHandlers'
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
import type { UsageTelemetryConfig } from '../../../src/shared/types'

const { probeUsageTelemetryPathMock } = vi.hoisted(() => ({
  probeUsageTelemetryPathMock: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../../src/main/agent/usageTelemetry', () => ({
  probeUsageTelemetryPath: probeUsageTelemetryPathMock
}))

describe('settingsHandlers', () => {
  let handlers: SettingsHandlers
  let appSettingsRepo: Pick<AppSettingsRepository, 'getUsageTelemetryConfig' | 'setUsageTelemetryConfig'>
  let storedTelemetryConfig: UsageTelemetryConfig

  beforeEach(() => {
    storedTelemetryConfig = { enabled: false, outputPath: '' }
    probeUsageTelemetryPathMock.mockReset()
    probeUsageTelemetryPathMock.mockResolvedValue({ ok: true })
    appSettingsRepo = {
      getUsageTelemetryConfig: () => storedTelemetryConfig,
      setUsageTelemetryConfig: (config) => {
        storedTelemetryConfig = config
      }
    }
    handlers = createSettingsHandlers(appSettingsRepo)
  })

  it('returns the current usage telemetry config from the repository', async () => {
    storedTelemetryConfig = { enabled: true, outputPath: '/some/path.jsonl' }
    expect(await handlers.getUsageTelemetryConfig()).toEqual({ enabled: true, outputPath: '/some/path.jsonl' })
  })

  it('persists a new usage telemetry config via the repository', async () => {
    const result = await handlers.setUsageTelemetryConfig({ enabled: true, outputPath: '/new/path.jsonl' })
    expect(storedTelemetryConfig).toEqual({ enabled: true, outputPath: '/new/path.jsonl' })
    expect(result).toEqual({ ok: true })
  })

  it('still persists the config but returns the probe error when the path is not writable', async () => {
    probeUsageTelemetryPathMock.mockResolvedValueOnce({ ok: false, error: 'ENOENT: no such file or directory' })
    const result = await handlers.setUsageTelemetryConfig({ enabled: true, outputPath: '/bad/path.jsonl' })
    expect(result).toEqual({ ok: false, error: 'ENOENT: no such file or directory' })
    expect(storedTelemetryConfig).toEqual({ enabled: true, outputPath: '/bad/path.jsonl' })
  })
})
```

Note `getCopilotQuota` has no dependencies to fake (it calls the real `fetchCopilotQuota` import) and was never under test here on `main` either -- no test is added or removed for it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- settingsHandlers`
Expected: FAIL -- `createSettingsHandlers` still requires `(modelRuntime, appSettingsRepo)`.

- [ ] **Step 3: Rewrite `settingsHandlers.ts`**

Replace the full contents of `src/main/ipc/settingsHandlers.ts` with:

```ts
import { fetchCopilotQuota } from '../agent/copilotQuota'
import { probeUsageTelemetryPath } from '../agent/usageTelemetry'
import type { AppSettingsRepository } from '../db/appSettingsRepository'
import type { CopilotQuota, UsageTelemetryConfig } from '../../shared/types'

export interface SettingsHandlers {
  getCopilotQuota(): Promise<CopilotQuota | null>
  getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
  setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<{ ok: true } | { ok: false; error: string }>
}

export function createSettingsHandlers(
  appSettingsRepo: Pick<AppSettingsRepository, 'getUsageTelemetryConfig' | 'setUsageTelemetryConfig'>
): SettingsHandlers {
  return {
    async getCopilotQuota() {
      return fetchCopilotQuota()
    },
    async getUsageTelemetryConfig() {
      return appSettingsRepo.getUsageTelemetryConfig()
    },
    async setUsageTelemetryConfig(config: UsageTelemetryConfig) {
      const probeResult = await probeUsageTelemetryPath(config)
      appSettingsRepo.setUsageTelemetryConfig(config)
      return probeResult
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- settingsHandlers`
Expected: PASS (3 tests)

- [ ] **Step 5: Remove `AuthStatus`/`DeviceCodeChallenge` from `src/shared/types.ts`**

Delete the `AuthStatus` interface and the `DeviceCodeChallenge` interface (both now fully replaced -- device-code prompts flow through `PassportOAuthPrompt`'s `device_code` variant added in Task 3). In the `Api` interface, replace the whole `settings` block with:

```ts
  settings: {
    getCopilotQuota(): Promise<CopilotQuota | null>
    getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
    setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<{ ok: true } | { ok: false; error: string }>
  }
```

(The `passports` block added in Task 3 stays as-is, right below it.)

- [ ] **Step 6: Update `register.ts`**

In `src/main/ipc/register.ts`, add the `PassportHandlers` import and interface member:

```ts
import type { PassportHandlers } from './passportHandlers'
```

Add `passports: PassportHandlers` to the `IpcHandlers` interface.

Replace the whole `settings:*` block:

```ts
  ipcMain.handle('settings:setAnthropicApiKey', (_e, apiKey: string) =>
    handlers.settings.setAnthropicApiKey(apiKey)
  )
  ipcMain.handle('settings:setGeminiApiKey', (_e, apiKey: string) => handlers.settings.setGeminiApiKey(apiKey))
  ipcMain.handle('settings:getAuthStatus', () => handlers.settings.getAuthStatus())
  ipcMain.handle('settings:loginCopilot', (event) =>
    handlers.settings.loginCopilot((challenge) => event.sender.send('settings:copilotChallenge', challenge))
  )
  ipcMain.handle('settings:getCopilotQuota', () => handlers.settings.getCopilotQuota())
  ipcMain.handle('settings:getUsageTelemetryConfig', () => handlers.settings.getUsageTelemetryConfig())
  ipcMain.handle('settings:setUsageTelemetryConfig', (_e, config: UsageTelemetryConfig) =>
    handlers.settings.setUsageTelemetryConfig(config)
  )
```

with:

```ts
  ipcMain.handle('settings:getCopilotQuota', () => handlers.settings.getCopilotQuota())
  ipcMain.handle('settings:getUsageTelemetryConfig', () => handlers.settings.getUsageTelemetryConfig())
  ipcMain.handle('settings:setUsageTelemetryConfig', (_e, config: UsageTelemetryConfig) =>
    handlers.settings.setUsageTelemetryConfig(config)
  )

  ipcMain.handle('passports:list', () => handlers.passports.listPassports())
  ipcMain.handle('passports:createApiKey', (_e, providerId: string, displayName: string, apiKey: string) =>
    handlers.passports.createApiKeyPassport(providerId, displayName, apiKey)
  )
  ipcMain.handle('passports:createOAuth', (event, providerId: string, displayName: string) =>
    handlers.passports.createOAuthPassport(providerId, displayName, (prompt) =>
      event.sender.send('passports:oauthPrompt', prompt)
    )
  )
  ipcMain.handle('passports:submitOAuthCode', (_e, code: string) => handlers.passports.submitOAuthCode(code))
  ipcMain.handle('passports:cancelOAuth', () => handlers.passports.cancelOAuth())
  ipcMain.handle('passports:setActive', (_e, id: string) => handlers.passports.setActivePassport(id))
  ipcMain.handle('passports:rename', (_e, id: string, displayName: string) =>
    handlers.passports.renamePassport(id, displayName)
  )
  ipcMain.handle('passports:remove', (_e, id: string) => handlers.passports.removePassport(id))
```

- [ ] **Step 7: Update `src/preload/index.ts`**

Replace the `settings` block:

```ts
  settings: {
    setAnthropicApiKey: (apiKey) => ipcRenderer.invoke('settings:setAnthropicApiKey', apiKey),
    setGeminiApiKey: (apiKey) => ipcRenderer.invoke('settings:setGeminiApiKey', apiKey),
    getAuthStatus: () => ipcRenderer.invoke('settings:getAuthStatus'),
    loginCopilot: () => ipcRenderer.invoke('settings:loginCopilot'),
    onCopilotChallenge: (listener) => {
      const wrapped = (_e: unknown, challenge: DeviceCodeChallenge): void => listener(challenge)
      ipcRenderer.on('settings:copilotChallenge', wrapped)
      return () => ipcRenderer.removeListener('settings:copilotChallenge', wrapped)
    },
    getCopilotQuota: () => ipcRenderer.invoke('settings:getCopilotQuota'),
    getUsageTelemetryConfig: () => ipcRenderer.invoke('settings:getUsageTelemetryConfig'),
    setUsageTelemetryConfig: (config) => ipcRenderer.invoke('settings:setUsageTelemetryConfig', config)
  },
```

with:

```ts
  settings: {
    getCopilotQuota: () => ipcRenderer.invoke('settings:getCopilotQuota'),
    getUsageTelemetryConfig: () => ipcRenderer.invoke('settings:getUsageTelemetryConfig'),
    setUsageTelemetryConfig: (config) => ipcRenderer.invoke('settings:setUsageTelemetryConfig', config)
  },
  passports: {
    list: () => ipcRenderer.invoke('passports:list'),
    createApiKey: (providerId, displayName, apiKey) =>
      ipcRenderer.invoke('passports:createApiKey', providerId, displayName, apiKey),
    createOAuth: (providerId, displayName) => ipcRenderer.invoke('passports:createOAuth', providerId, displayName),
    onOAuthPrompt: (listener) => {
      const wrapped = (_e: unknown, prompt: PassportOAuthPrompt): void => listener(prompt)
      ipcRenderer.on('passports:oauthPrompt', wrapped)
      return () => ipcRenderer.removeListener('passports:oauthPrompt', wrapped)
    },
    submitOAuthCode: (code) => ipcRenderer.invoke('passports:submitOAuthCode', code),
    cancelOAuth: () => ipcRenderer.invoke('passports:cancelOAuth'),
    setActive: (id) => ipcRenderer.invoke('passports:setActive', id),
    rename: (id, displayName) => ipcRenderer.invoke('passports:rename', id, displayName),
    remove: (id) => ipcRenderer.invoke('passports:remove', id)
  },
```

Update the top import: remove `DeviceCodeChallenge`, add `PassportOAuthPrompt`:

```ts
import type { Api, ApprovalRequest, ChatEvent, PassportOAuthPrompt, ToolApprovalPolicy, UiPromptRequest } from '../shared/types'
```

- [ ] **Step 8: Update `src/main/index.ts`**

Add imports:

```ts
import { createPassportsRepository } from './db/passportsRepository'
import { createPassportHandlers } from './ipc/passportHandlers'
import { migratePassportsFromLegacyAuth } from './passports/migratePassports'
import { getAuthMethodHandler } from './passports/authMethodHandlers'
import { shell } from 'electron'
```

(`shell` joins the existing `electron` import list at the top rather than a separate line -- merge it into `import { app, BrowserWindow, dialog, Menu, shell } from 'electron'`.)

After `const appSettingsRepo = createAppSettingsRepository(db)`, add:

```ts
  const passportsRepo = createPassportsRepository(db)
```

Replace the startup replay loop:

```ts
  for (const [providerId, apiKey] of Object.entries(appSettingsRepo.getProviderApiKeys())) {
    await modelRuntime.setRuntimeApiKey(providerId, apiKey)
  }
```

with a migration step followed by activation replay (both must run after `modelRuntime` exists, since migration needs `checkAuth` and activation needs `setRuntimeApiKey`):

```ts
  // One-time: copy any pre-Passports credential into a real passports row.
  await migratePassportsFromLegacyAuth({
    appSettingsRepo,
    passportsRepo,
    checkAuth: (providerId) => modelRuntime.checkAuth(providerId)
  })
  // setRuntimeApiKey()/OAuth credentials are in-memory-only or SDK-owned --
  // replay every currently-active api_key passport's activation so it
  // takes effect again after this restart (an active oauth passport needs
  // no replay: its handler's activate() is a no-op, and the SDK's own
  // credential store already persisted the real tokens).
  for (const passport of passportsRepo.list()) {
    if (passport.isActive) await getAuthMethodHandler(passport.authMethod).activate(passport, modelRuntime)
  }
```

Replace the settings/models registration:

```ts
    settings: createSettingsHandlers(modelRuntime, appSettingsRepo),
```

with:

```ts
    settings: createSettingsHandlers(appSettingsRepo),
    passports: createPassportHandlers(passportsRepo, modelRuntime, (url) => shell.openExternal(url)),
```

Update `session: createSessionHandlers({...})`'s call to add the new dependency, right after `getUsageTelemetryConfig: () => appSettingsRepo.getUsageTelemetryConfig(),`:

```ts
      recordPassportUsage: (providerId, usage) => passportsRepo.recordUsageForActiveProvider(providerId, usage),
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

If it fails specifically on the `settings: createPassportHandlers(passportsRepo, modelRuntime, ...)` line with a `login` parameter mismatch (the real `ModelRuntime.login`'s `interaction: AuthInteraction` type from `@earendil-works/pi-ai` is narrower/differently-shaped than this task's hand-rolled `PassportModelRuntimeLike.login` interaction parameter), fix it by importing the real type instead of hand-rolling one: in `src/main/ipc/passportHandlers.ts`, replace the `PassportModelRuntimeLike` interface's `login` member with:

```ts
import type { AuthInteraction, AuthType, Credential } from '@earendil-works/pi-ai'

export interface PassportModelRuntimeLike extends ModelRuntimeLike {
  login(providerId: string, type: AuthType, interaction: AuthInteraction): Promise<Credential>
}
```

and update the `createOAuthPassport` implementation's `notify`/`prompt` callback parameter types to match `AuthInteraction`'s own event/prompt union types (the same ones `src/main/ipc/settingsHandlers.ts`'s pre-Task-6 `loginCopilot`/`loginAnthropicOAuth` already destructured via `event.type`/`prompt.type` narrowing, which still works unchanged since the runtime shapes are identical -- only the compile-time parameter types move from this task's placeholder shape to the SDK's real ones). No cast should be needed once the real type is used directly.

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: PASS, all suites (no regressions in `sessionHandlers.test.ts`, `settingsHandlers.test.ts`, `passportHandlers.test.ts`, `passportsRepository.test.ts`, `authMethodHandlers.test.ts`, `migratePassports.test.ts`, `appSettingsRepository.test.ts`).

- [ ] **Step 11: Commit**

```bash
git add src/main/ipc/settingsHandlers.ts src/main/ipc/register.ts src/preload/index.ts src/main/index.ts src/shared/types.ts tests/main/ipc/settingsHandlers.test.ts
git commit -m "feat: wire passports IPC and retire the four legacy auth channels"
```

---

### Task 7: Passports UI (list, Add popup, Details popup)

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.passports.*` (Task 6), `Passport`, `PassportOAuthPrompt` (Tasks 1, 3).

No test file -- this is a pure UI change with no existing renderer component test harness for `SettingsPanel.tsx` (there is none on `main`); verified manually in Task 8.

- [ ] **Step 1: Add the CSS**

Append to the end of `src/renderer/src/theme.css` (these introduce no new tokens -- every value below is one of the existing `--bg`/`--sheet-bg`/`--editor-bg`/`--border`/`--border-subtle`/`--fg`/`--fg-dim`/`--fg-faint`/`--accent`/`--accent-wash`/`--list-hover`/`--list-active`/`--input-bg`/`--button-bg`/`--button-fg`/`--success`/`--danger`/`--font-mono`/`--radius`/`--radius-sm` tokens already defined per-theme near the top of this file):

```css
/* ---------------------------------------------------------------------
   Passports (Settings)
   --------------------------------------------------------------------- */
.passport-group {
  margin-bottom: 22px;
}

.passport-group-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-faint);
  margin-bottom: 8px;
}

.passport-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--editor-bg);
  margin-bottom: 8px;
}

.passport-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--list-active);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}

.passport-main {
  flex: 1;
  min-width: 0;
}

.passport-name {
  font-size: 13.5px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--fg-bright);
}

.passport-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 5px;
  flex-wrap: wrap;
}

.passport-meta-item {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-faint);
  display: flex;
  align-items: center;
  gap: 4px;
}

.passport-meta-item b {
  color: var(--fg-dim);
  font-weight: 600;
}

.passport-usage-bar {
  width: 64px;
  height: 4px;
  border-radius: 999px;
  background: var(--border-subtle);
  overflow: hidden;
}

.passport-usage-bar span {
  display: block;
  height: 100%;
  background: var(--accent);
}

.passport-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.passport-dot.is-on {
  background: var(--success);
}

.passport-dot.is-off {
  border: 1.4px solid var(--fg-faint);
  background: none;
}

.passport-badge {
  font-family: var(--font-mono);
  font-size: 9.5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--fg-dim);
}

.passport-tag-active {
  font-family: var(--font-mono);
  font-size: 9.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-wash);
  color: var(--accent);
  font-weight: 600;
}

.passport-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.passport-link-btn {
  font-size: 11.5px;
  color: var(--fg-dim);
  background: none;
  border: none;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
}

.passport-link-btn:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.passport-kebab {
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  color: var(--fg-faint);
  font-size: 16px;
  position: relative;
}

.passport-kebab:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.passport-kebab-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--editor-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.2);
  z-index: 10;
  min-width: 130px;
  overflow: hidden;
}

.passport-kebab-menu button {
  display: block;
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  font-size: 12px;
  background: none;
  border: none;
  color: var(--fg);
}

.passport-kebab-menu button:hover {
  background: var(--list-hover);
}

.passport-add-btn {
  font-size: 12.5px;
  font-weight: 500;
  padding: 8px 15px;
  border-radius: var(--radius);
  background: var(--button-bg);
  color: var(--button-fg);
  border: none;
}

.passport-add-btn:hover {
  background: var(--button-hover);
}

.passport-popup-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.38);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}

.passport-popup {
  width: 420px;
  max-height: 520px;
  overflow: auto;
  background: var(--editor-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 20px 44px -18px rgba(0, 0, 0, 0.4);
}

.passport-popup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.passport-popup-head h3 {
  font-size: 15px;
  margin: 0;
  color: var(--fg-bright);
}

.passport-popup-close {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: none;
  border: none;
  color: var(--fg-faint);
  font-size: 14px;
}

.passport-popup-close:hover {
  background: var(--list-hover);
  color: var(--fg);
}

.passport-popup-body {
  padding: 18px;
}

.passport-steps {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
}

.passport-step {
  font-family: var(--font-mono);
  font-size: 9.5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--fg-faint);
}

.passport-step.is-done {
  color: var(--accent);
  border-color: var(--accent);
}

.passport-step.is-now {
  background: var(--accent);
  color: var(--button-fg);
  border-color: var(--accent);
  font-weight: 600;
}

.passport-provider-grid,
.passport-method-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.passport-method-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 11px 13px;
  background: var(--bg);
  cursor: pointer;
}

.passport-method-card.is-selected {
  border-color: var(--accent);
  background: var(--accent-wash);
}

.passport-method-card .passport-radio {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.6px solid var(--border);
  flex-shrink: 0;
  margin-top: 2px;
}

.passport-method-card.is-selected .passport-radio {
  border-color: var(--accent);
  background: radial-gradient(var(--accent) 0 40%, transparent 42%);
}

.passport-method-card .passport-method-title {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-bright);
}

.passport-method-card .passport-method-desc {
  font-size: 11px;
  color: var(--fg-dim);
  margin-top: 2px;
}

.passport-field-label {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 6px;
  display: block;
  color: var(--fg-bright);
}

.passport-btn-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 18px;
  border-top: 1px solid var(--border-subtle);
}

.passport-btn-row.is-split {
  justify-content: space-between;
}

.passport-btn {
  font-size: 12.5px;
  font-weight: 500;
  padding: 8px 15px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
}

.passport-btn.is-primary {
  background: var(--button-bg);
  color: var(--button-fg);
}

.passport-btn.is-primary:hover {
  background: var(--button-hover);
}

.passport-btn.is-primary:disabled {
  opacity: 0.5;
}

.passport-btn.is-ghost {
  background: transparent;
  border-color: var(--border);
  color: var(--fg);
}

.passport-btn.is-danger {
  background: transparent;
  border-color: var(--danger);
  color: var(--danger);
}

.passport-detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 14px;
  font-size: 12.5px;
  margin-bottom: 16px;
  color: var(--fg);
}

.passport-detail-grid dt {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--fg-faint);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: 1px;
}

.passport-detail-grid dd {
  margin: 0;
}

.passport-detail-usage {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 12px 14px;
}

.passport-detail-usage-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 4px 0;
  color: var(--fg);
}

.passport-detail-usage-row b {
  font-family: var(--font-mono);
}
```

- [ ] **Step 2: Replace the Providers section with Passports in `SettingsPanel.tsx`**

This step replaces a large, self-contained portion of the file. Apply each change below in order.

**2a.** Update the imports at the top -- replace:

```ts
import type {
  AuthStatus,
  CopilotQuota,
  DeviceCodeChallenge,
  ToolApprovalPolicy,
  UsageTelemetryConfig
} from '../../../shared/types'
```

with:

```ts
import type {
  CopilotQuota,
  Passport,
  PassportOAuthPrompt,
  ToolApprovalPolicy,
  UsageTelemetryConfig
} from '../../../shared/types'
```

**2b.** Rename the `Section` type and `SECTIONS` array's `'providers'` entry to `'passports'`:

```ts
type Section = 'general' | 'passports' | 'permissions'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'passports', label: 'Passports' },
  { value: 'permissions', label: 'Permissions' }
]
```

**2c.** Delete the `StatusDot` component (no longer used -- `.passport-dot` inlines the same idea per-row) and the `COPILOT_QUOTA_LABELS`/`formatQuotaResetDate` helpers stay (still used inside the new Copilot detail popup).

**2d.** Replace all of the provider-related `useState` declarations:

```ts
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [anthropicError, setAnthropicError] = useState<string | null>(null)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [copilotError, setCopilotError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
```

with:

```ts
  const [passports, setPassports] = useState<Passport[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [detailPassportId, setDetailPassportId] = useState<string | null>(null)
  const [addStep, setAddStep] = useState<'provider' | 'method' | 'connect'>('provider')
  const [addProviderId, setAddProviderId] = useState<string | null>(null)
  const [addMethod, setAddMethod] = useState<'api_key' | 'oauth' | null>(null)
  const [addDisplayName, setAddDisplayName] = useState('')
  const [addApiKey, setAddApiKey] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addPopupOpen, setAddPopupOpen] = useState(false)
  const [oauthPrompt, setOauthPrompt] = useState<PassportOAuthPrompt | null>(null)
  const [oauthCodeDraft, setOauthCodeDraft] = useState('')
```

**2e.** Replace `quota` state's provider gating and the whole Copilot-quota effect. Change:

```ts
  useEffect(() => {
    if (section !== 'providers' || !status?.copilot) {
      setQuota(null)
      return
    }
    let cancelled = false
    window.api.settings
      .getCopilotQuota()
      .then((result) => {
        if (!cancelled) setQuota(result)
      })
      .catch(() => {
        if (!cancelled) setQuota(null)
      })
    return () => {
      cancelled = true
    }
  }, [section, status?.copilot])
```

to:

```ts
  const copilotPassport = passports.find((p) => p.providerId === 'github-copilot' && p.isActive)

  useEffect(() => {
    if (section !== 'passports' || !copilotPassport) {
      setQuota(null)
      return
    }
    let cancelled = false
    window.api.settings
      .getCopilotQuota()
      .then((result) => {
        if (!cancelled) setQuota(result)
      })
      .catch(() => {
        if (!cancelled) setQuota(null)
      })
    return () => {
      cancelled = true
    }
  }, [section, copilotPassport])
```

**2f.** Replace `async function refresh(): Promise<void> { setStatus(await window.api.settings.getAuthStatus()) }` with:

```ts
  async function refreshPassports(): Promise<void> {
    setPassports(await window.api.passports.list())
  }
```

And in the top-level `useEffect`, replace `refresh()` with `refreshPassports()`, and remove the `onCopilotChallenge` subscription (device-code prompts now flow through `onOAuthPrompt`, wired inside the Add-popup handler in 2h):

```ts
  useEffect(() => {
    refreshPassports()
    window.api.approvals.getPolicy().then(setPolicy)
    window.api.settings.getUsageTelemetryConfig().then((config) => {
      setTelemetryConfig(config)
      setTelemetryPathDraft(config.outputPath)
    })
  }, [])
```

**2g.** Delete `handleSaveKey`, `handleSaveGeminiKey`, `handleCopilotLogin` entirely (replaced by the popup handlers below).

**2h.** Add the new handlers (place them where the deleted ones were):

```ts
  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic',
    google: 'Google',
    'github-copilot': 'GitHub Copilot'
  }
  const PROVIDER_ICONS: Record<string, string> = {
    anthropic: '\u{1F170}',
    google: '\u{1F1EC}',
    'github-copilot': '\u{1F419}'
  }
  const PROVIDERS_FOR_ADD = ['anthropic', 'google', 'github-copilot']
  const METHODS_FOR_PROVIDER: Record<string, { value: 'api_key' | 'oauth'; title: string; desc: string }[]> = {
    anthropic: [
      { value: 'oauth', title: 'Sign in with browser (Claude Pro/Max)', desc: 'Usage covered by your subscription' },
      { value: 'api_key', title: 'API Key', desc: 'Paste a key from console.anthropic.com' }
    ],
    google: [{ value: 'api_key', title: 'API Key', desc: 'Paste a key from Google AI Studio' }],
    'github-copilot': [{ value: 'oauth', title: 'Sign in with device code', desc: 'Authorize this app from github.com/login/device' }]
  }

  function openAddPopup(): void {
    setAddStep('provider')
    setAddProviderId(null)
    setAddMethod(null)
    setAddDisplayName('')
    setAddApiKey('')
    setAddError(null)
    setOauthPrompt(null)
    setOauthCodeDraft('')
    setAddPopupOpen(true)
  }

  function closeAddPopup(): void {
    if (oauthPrompt) window.api.passports.cancelOAuth()
    setAddPopupOpen(false)
  }

  async function handleAddContinue(): Promise<void> {
    if (addStep === 'provider' && addProviderId) {
      setAddStep('method')
      return
    }
    if (addStep === 'method' && addMethod && addProviderId) {
      setAddDisplayName(
        addMethod === 'oauth' ? `${PROVIDER_LABELS[addProviderId]} Sign-in` : `${PROVIDER_LABELS[addProviderId]} API Key`
      )
      setAddStep('connect')
      return
    }
    if (addStep === 'connect' && addProviderId && addMethod === 'api_key') {
      setAddError(null)
      setAddBusy(true)
      const result = await window.api.passports.createApiKey(addProviderId, addDisplayName, addApiKey)
      setAddBusy(false)
      if (!result.ok) {
        setAddError(result.error)
        return
      }
      await refreshPassports()
      setAddPopupOpen(false)
    }
  }

  async function handleStartOAuth(): Promise<void> {
    if (!addProviderId) return
    setAddError(null)
    setAddBusy(true)
    const unsubscribe = window.api.passports.onOAuthPrompt(setOauthPrompt)
    const result = await window.api.passports.createOAuth(addProviderId, addDisplayName)
    unsubscribe()
    setAddBusy(false)
    setOauthPrompt(null)
    if (!result.ok) {
      setAddError(result.error)
      return
    }
    await refreshPassports()
    setAddPopupOpen(false)
  }

  async function handleSubmitOAuthCode(): Promise<void> {
    await window.api.passports.submitOAuthCode(oauthCodeDraft)
    setOauthCodeDraft('')
  }

  async function handleSetActive(id: string): Promise<void> {
    setOpenMenuId(null)
    await window.api.passports.setActive(id)
    await refreshPassports()
  }

  async function handleRemove(id: string): Promise<void> {
    setOpenMenuId(null)
    setDetailPassportId(null)
    await window.api.passports.remove(id)
    await refreshPassports()
  }
```

Note: for the `'connect'` step with `addMethod === 'oauth'`, the Continue button in the popup body (Step 2i) calls `handleStartOAuth` directly rather than `handleAddContinue`, since it starts a long-running flow rather than advancing a step.

**2i.** Replace the entire `{section === 'providers' && (...)}` block with:

```tsx
          {section === 'passports' && (
            <div className="settings-group" style={{ background: 'transparent', border: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                <button className="passport-add-btn" onClick={openAddPopup}>
                  + Add Passport
                </button>
              </div>
              {Object.entries(
                passports.reduce<Record<string, Passport[]>>((groups, p) => {
                  ;(groups[p.providerId] ??= []).push(p)
                  return groups
                }, {})
              ).map(([providerId, rows]) => (
                <div key={providerId} className="passport-group">
                  <div className="passport-group-label">{PROVIDER_LABELS[providerId] ?? providerId}</div>
                  {rows.map((passport) => (
                    <div key={passport.id} className="passport-row">
                      <div className="passport-icon">{PROVIDER_ICONS[providerId] ?? '\u{1F511}'}</div>
                      <div className="passport-main">
                        <div className="passport-name">
                          <span className={`passport-dot ${passport.isActive ? 'is-on' : 'is-off'}`} />
                          {passport.displayName}
                          {passport.isActive && <span className="passport-tag-active">Active</span>}
                        </div>
                        <div className="passport-meta">
                          <span className="passport-badge">
                            {passport.authMethod === 'api_key' ? 'API Key' : 'OAuth'}
                          </span>
                          {passport.authMethod === 'api_key' && passport.apiKey && (
                            <span className="passport-meta-item">
                              {passport.apiKey.slice(0, 7)}…{passport.apiKey.slice(-4)}
                            </span>
                          )}
                          <span className="passport-meta-item">
                            {passport.lastUsedAt ? (
                              <>Last used <b>{new Date(passport.lastUsedAt).toLocaleDateString()}</b></>
                            ) : (
                              'Never used'
                            )}
                          </span>
                          {passport.authMethod === 'api_key' && (
                            <span className="passport-meta-item">
                              <b>{(passport.totalInputTokens + passport.totalOutputTokens).toLocaleString()}</b> tokens all-time
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="passport-row-actions">
                        <button className="passport-link-btn" onClick={() => setDetailPassportId(passport.id)}>
                          View details
                        </button>
                        <div style={{ position: 'relative' }}>
                          <button
                            className="passport-kebab"
                            onClick={() => setOpenMenuId(openMenuId === passport.id ? null : passport.id)}
                          >
                            ⋯
                          </button>
                          {openMenuId === passport.id && (
                            <div className="passport-kebab-menu">
                              {!passport.isActive && (
                                <button onClick={() => handleSetActive(passport.id)}>Set Active</button>
                              )}
                              <button onClick={() => handleRemove(passport.id)}>Remove</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {passports.length === 0 && (
                <div className="settings-row-desc" style={{ padding: '18px' }}>
                  No Passports yet -- add one to connect a provider.
                </div>
              )}
            </div>
          )}
```

**2j.** Add the two popups as siblings right after the `</div>` that closes `.settings-scroll-area` (still inside `.settings-dialog`):

```tsx
        {addPopupOpen && (
          <div className="passport-popup-backdrop" onClick={closeAddPopup}>
            <div className="passport-popup" onClick={(e) => e.stopPropagation()}>
              <div className="passport-popup-head">
                <h3>Add Passport</h3>
                <button className="passport-popup-close" onClick={closeAddPopup}>
                  ✕
                </button>
              </div>
              <div className="passport-popup-body">
                <div className="passport-steps">
                  <span className={`passport-step ${addStep !== 'provider' ? 'is-done' : 'is-now'}`}>1 · Provider</span>
                  <span
                    className={`passport-step ${addStep === 'connect' ? 'is-done' : addStep === 'method' ? 'is-now' : ''}`}
                  >
                    2 · Method
                  </span>
                  <span className={`passport-step ${addStep === 'connect' ? 'is-now' : ''}`}>3 · Connect</span>
                </div>

                {addStep === 'provider' && (
                  <div className="passport-provider-grid">
                    {PROVIDERS_FOR_ADD.map((providerId) => (
                      <div
                        key={providerId}
                        className={`passport-method-card ${addProviderId === providerId ? 'is-selected' : ''}`}
                        onClick={() => setAddProviderId(providerId)}
                      >
                        <span className="passport-radio" />
                        <div className="passport-method-title">{PROVIDER_LABELS[providerId]}</div>
                      </div>
                    ))}
                  </div>
                )}

                {addStep === 'method' && addProviderId && (
                  <div className="passport-method-grid">
                    {METHODS_FOR_PROVIDER[addProviderId].map((m) => (
                      <div
                        key={m.value}
                        className={`passport-method-card ${addMethod === m.value ? 'is-selected' : ''}`}
                        onClick={() => setAddMethod(m.value)}
                      >
                        <span className="passport-radio" />
                        <div>
                          <div className="passport-method-title">{m.title}</div>
                          <div className="passport-method-desc">{m.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {addStep === 'connect' && addMethod === 'api_key' && (
                  <div>
                    <label className="passport-field-label">Display name</label>
                    <input
                      className="settings-input"
                      style={{ width: '100%', marginBottom: '10px' }}
                      value={addDisplayName}
                      onChange={(e) => setAddDisplayName(e.target.value)}
                    />
                    <label className="passport-field-label">API Key</label>
                    <input
                      className="settings-input"
                      style={{ width: '100%', marginBottom: '10px' }}
                      type="password"
                      value={addApiKey}
                      onChange={(e) => setAddApiKey(e.target.value)}
                      placeholder={addProviderId === 'google' ? 'AIza...' : 'sk-ant-...'}
                    />
                    {addError && <span className="settings-row-error">{addError}</span>}
                  </div>
                )}

                {addStep === 'connect' && addMethod === 'oauth' && (
                  <div>
                    {!oauthPrompt && !addBusy && (
                      <p className="settings-row-desc">Click Continue to start signing in.</p>
                    )}
                    {oauthPrompt?.kind === 'browser' && (
                      <p className="settings-row-desc">
                        A browser window opened to sign in.{' '}
                        {oauthPrompt.instructions ?? 'If it didn’t redirect back automatically, paste the code or URL it gave you below.'}
                      </p>
                    )}
                    {oauthPrompt?.kind === 'device_code' && (
                      <p className="settings-row-desc">
                        Go to {oauthPrompt.verificationUri} and enter code <strong>{oauthPrompt.userCode}</strong>
                      </p>
                    )}
                    {oauthPrompt?.kind === 'browser' && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                        <input
                          className="settings-input"
                          style={{ flex: 1 }}
                          value={oauthCodeDraft}
                          onChange={(e) => setOauthCodeDraft(e.target.value)}
                          placeholder="Paste code or URL"
                        />
                        <button className="settings-btn" onClick={handleSubmitOAuthCode}>
                          Submit
                        </button>
                      </div>
                    )}
                    {addError && <span className="settings-row-error">{addError}</span>}
                  </div>
                )}
              </div>
              <div className="passport-btn-row">
                {addStep !== 'provider' && (
                  <button
                    className="passport-btn is-ghost"
                    onClick={() => setAddStep(addStep === 'connect' ? 'method' : 'provider')}
                  >
                    Back
                  </button>
                )}
                <button
                  className="passport-btn is-primary"
                  disabled={
                    (addStep === 'provider' && !addProviderId) ||
                    (addStep === 'method' && !addMethod) ||
                    addBusy
                  }
                  onClick={addStep === 'connect' && addMethod === 'oauth' ? handleStartOAuth : handleAddContinue}
                >
                  {addBusy ? 'Working…' : addStep === 'connect' ? 'Connect' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {detailPassportId &&
          (() => {
            const passport = passports.find((p) => p.id === detailPassportId)
            if (!passport) return null
            return (
              <div className="passport-popup-backdrop" onClick={() => setDetailPassportId(null)}>
                <div className="passport-popup" onClick={(e) => e.stopPropagation()}>
                  <div className="passport-popup-head">
                    <h3>{passport.displayName}</h3>
                    <button className="passport-popup-close" onClick={() => setDetailPassportId(null)}>
                      ✕
                    </button>
                  </div>
                  <div className="passport-popup-body">
                    <dl className="passport-detail-grid">
                      <dt>Provider</dt>
                      <dd>{PROVIDER_LABELS[passport.providerId] ?? passport.providerId}</dd>
                      <dt>Method</dt>
                      <dd>{passport.authMethod === 'api_key' ? 'API Key' : 'OAuth'}</dd>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={`passport-dot ${passport.isActive ? 'is-on' : 'is-off'}`}
                          style={{ display: 'inline-block', marginRight: '5px' }}
                        />
                        {passport.isActive ? 'Active' : 'Saved, not active'}
                      </dd>
                      {passport.authMethod === 'api_key' && passport.apiKey && (
                        <>
                          <dt>Key</dt>
                          <dd>
                            {passport.apiKey.slice(0, 7)}…{passport.apiKey.slice(-4)}
                          </dd>
                        </>
                      )}
                      <dt>Added</dt>
                      <dd>{new Date(passport.createdAt).toLocaleString()}</dd>
                    </dl>
                    <div className="passport-detail-usage">
                      <div className="passport-detail-usage-row">
                        <span>Total tokens (all-time)</span>
                        <b>{(passport.totalInputTokens + passport.totalOutputTokens).toLocaleString()}</b>
                      </div>
                      <div className="passport-detail-usage-row">
                        <span>Requests</span>
                        <b>{passport.totalRequests.toLocaleString()}</b>
                      </div>
                      <div className="passport-detail-usage-row">
                        <span>Last used</span>
                        <b>{passport.lastUsedAt ? new Date(passport.lastUsedAt).toLocaleString() : 'Never'}</b>
                      </div>
                    </div>
                  </div>
                  <div className="passport-btn-row is-split">
                    <button className="passport-btn is-danger" onClick={() => handleRemove(passport.id)}>
                      Remove
                    </button>
                    {passport.isActive ? (
                      <button className="passport-btn is-ghost" onClick={() => setDetailPassportId(null)}>
                        Close
                      </button>
                    ) : (
                      <button
                        className="passport-btn is-primary"
                        onClick={async () => {
                          await handleSetActive(passport.id)
                          setDetailPassportId(null)
                        }}
                      >
                        Set Active
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
```

The Copilot quota bar (`quota`, already fetched by the `copilotPassport` effect in 2e) still needs wiring into that provider's row. In the passport-row markup from 2i, inside `.passport-meta`, right after the existing `passport-meta-item` spans, add:

```tsx
                          {providerId === 'github-copilot' && passport.isActive && quota && (
                            (() => {
                              const premium = quota.categories.find((c) => c.id === 'premium_interactions')
                              if (!premium || premium.unlimited) return null
                              return (
                                <span className="passport-meta-item">
                                  <span className="passport-usage-bar">
                                    <span
                                      style={{
                                        width: `${Math.max(0, Math.min(100, 100 - premium.percentRemaining))}%`
                                      }}
                                    />
                                  </span>{' '}
                                  <b>{Math.round(100 - premium.percentRemaining)}%</b> premium quota
                                </span>
                              )
                            })()
                          )}
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/theme.css
git commit -m "feat: redesign Settings Providers tab as Passports"
```

---

### Task 8: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run the full automated test suite**

Run: `npm test`
Expected: PASS, every suite.

- [ ] **Step 3: Restart the dev server**

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { \$_.CommandLine -match 'electron-vite|npm-cli.js.*run dev' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue"
```

Then, from this worktree's root:

```bash
unset ELECTRON_RUN_AS_NODE; npm run dev > /tmp/dev-log-passports.txt 2>&1 &
```

Wait ~60 seconds, then check the log for `dev server running` and no build errors:

```bash
grep -E "dev server running|Error|error TS" /tmp/dev-log-passports.txt
```

Expected: `dev server running for the electron renderer process at:` present; no `error TS` lines.

- [ ] **Step 4: Passive visual check**

Per this project's established safety rule, do not simulate clicks or drags. Ask the user to open Settings → Passports (or take your own window-bounded screenshot if the harness supports a passive, click-free screenshot) and confirm:
- The nav item reads "Passports", not "Providers".
- Any pre-existing credential (migrated from before this branch) appears as a row with the right badge (API Key / OAuth) and an "Active" tag.
- "+ Add Passport" opens the 3-step popup; "View details" opens the detail popup; both close on the ✕ or backdrop click.
- Both light and dark themes render the new rows/popups with legible text and correctly colored accents (no default-black-on-dark or invisible borders).

- [ ] **Step 5: Report results**

Summarize the typecheck, test suite, and dev-server-log outcomes; attach or describe the visual check result. Do not mark this task complete on typecheck/tests alone if the dev server log shows any renderer build error.
