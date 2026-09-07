# Usage Telemetry Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PassCode emits its own LLM inference usage as OpenTelemetry log records, in the exact JSON shape VS Code's Copilot Chat extension already writes, to a user-configured file — so an existing external PowerShell aggregator/dashboard pipeline picks up PassCode's usage with zero changes on its side.

**Architecture:** A new main-process module (`usageTelemetry.ts`) builds and appends one OTel-shaped JSON line per real LLM inference call. It's wired into the existing event pipeline in `sessionHandlers.ts` at the exact point that already captures per-call token usage. A new Settings → General toggle + path field (persisted via the existing `app_settings` key/value table) controls whether/where it writes.

**Tech Stack:** TypeScript, Node's `fs/promises`, `crypto.randomUUID()`, Electron IPC, Vitest.

## Global Constraints

- Record shape must match VS Code Copilot Chat's own OTel log records exactly in the fields the existing `Export-CopilotTokens.ps1` aggregator actually reads: `hrTime` (epoch-seconds + nanos tuple), `resource._rawAttributes` (array of `[key, value]` pairs, must include `user.name` and, when available, `team.id`), and `attributes`' `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.model` (preferred) / `gen_ai.request.model` (fallback), `gen_ai.response.id`.
- One record per actual LLM inference call (the existing `model_usage` event), not one per user turn.
- Off by default. Never writes anywhere unless the user has explicitly enabled it and set an output path.
- Identity: `user.name`/`team.id` parsed from the `OTEL_RESOURCE_ATTRIBUTES` environment variable (format `key1=value1,key2=value2`), falling back to the OS login name for `user.name` and omitting `team.id` if that variable is unset or doesn't contain those keys. Never hardcoded.
- Every failure path (bad path, permission denied, malformed env var) is caught and logged via `console.warn` — never thrown, never surfaced to the renderer, never blocks or slows a chat turn.
- No changes to `Export-CopilotTokens.ps1` or any other file outside this repo.
- This repo's test suite includes files that import `node:sqlite`, which needs Node ≥22; this environment may only have Node 20 available, in which case those specific test files fail to even load ("Failed to load url sqlite") — a pre-existing, unrelated environment gap. Where a task's test file hits this, verify via `tsc --noEmit` plus careful manual reading of the test code instead of a green run, and say so plainly in the report; do not attempt to fix the environment.

---

## Task 1: Shared type + persistence for the telemetry config

**Files:**
- Modify: `src/shared/types.ts:161-163` (add `UsageTelemetryConfig` right after `ToolApprovalPolicy`)
- Modify: `src/main/db/appSettingsRepository.ts`
- Test: `tests/main/db/appSettingsRepository.test.ts`

**Interfaces:**
- Produces: `UsageTelemetryConfig { enabled: boolean; outputPath: string }` (in `src/shared/types.ts`, shared across IPC), `DEFAULT_USAGE_TELEMETRY_CONFIG: UsageTelemetryConfig`, and `AppSettingsRepository.getUsageTelemetryConfig(): UsageTelemetryConfig` / `setUsageTelemetryConfig(config: UsageTelemetryConfig): void` — consumed by Task 3's `settingsHandlers.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/main/db/appSettingsRepository.test.ts` (inside the existing `describe('AppSettingsRepository', ...)` block, and add `DEFAULT_USAGE_TELEMETRY_CONFIG` to the existing import from `'../../../src/main/db/appSettingsRepository'`):

```typescript
  it('returns the default usage telemetry config when none has been saved', () => {
    expect(repo.getUsageTelemetryConfig()).toEqual(DEFAULT_USAGE_TELEMETRY_CONFIG)
  })

  it('persists and retrieves a saved usage telemetry config', () => {
    const config = { enabled: true, outputPath: 'C:/Code/.telemetry/copilot-working.jsonl' }
    repo.setUsageTelemetryConfig(config)
    expect(repo.getUsageTelemetryConfig()).toEqual(config)
  })

  it('overwrites a previously saved usage telemetry config rather than duplicating it', () => {
    repo.setUsageTelemetryConfig({ enabled: true, outputPath: '/first/path.jsonl' })
    repo.setUsageTelemetryConfig({ enabled: false, outputPath: '/second/path.jsonl' })
    expect(repo.getUsageTelemetryConfig()).toEqual({ enabled: false, outputPath: '/second/path.jsonl' })
  })

  it('does not let a saved usage telemetry config leak into the tool approval policy or vice versa', () => {
    repo.setToolApprovalPolicy({ autoApprove: { bash: true } })
    repo.setUsageTelemetryConfig({ enabled: true, outputPath: '/x.jsonl' })
    expect(repo.getToolApprovalPolicy()).toEqual({
      autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, bash: true }
    })
    expect(repo.getUsageTelemetryConfig()).toEqual({ enabled: true, outputPath: '/x.jsonl' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/db/appSettingsRepository.test.ts`
Expected: FAIL — `repo.getUsageTelemetryConfig is not a function`. (If this environment's Node is <22, this whole file fails to load instead with a `node:sqlite` error — in that case, skip straight to Step 3 and verify via `tsc --noEmit` plus a careful read-through of the test code instead of a red/green run, noting this in your report.)

- [ ] **Step 3: Add the shared type**

In `src/shared/types.ts`, add right after the existing `ToolApprovalPolicy` interface (currently lines 161-163):

```typescript
export interface UsageTelemetryConfig {
  enabled: boolean
  outputPath: string
}
```

- [ ] **Step 4: Implement the repository additions**

In `src/main/db/appSettingsRepository.ts`, update the import line:

```typescript
import type { ToolApprovalPolicy, UsageTelemetryConfig } from '../../shared/types'
```

Add a second key constant and default, next to the existing `POLICY_KEY`/`DEFAULT_TOOL_APPROVAL_POLICY`:

```typescript
const USAGE_TELEMETRY_KEY = 'usageTelemetryConfig'

export const DEFAULT_USAGE_TELEMETRY_CONFIG: UsageTelemetryConfig = {
  enabled: false,
  outputPath: ''
}
```

Add two methods to the `AppSettingsRepository` interface:

```typescript
export interface AppSettingsRepository {
  getToolApprovalPolicy(): ToolApprovalPolicy
  setToolApprovalPolicy(policy: ToolApprovalPolicy): void
  getUsageTelemetryConfig(): UsageTelemetryConfig
  setUsageTelemetryConfig(config: UsageTelemetryConfig): void
}
```

Add the implementations inside `createAppSettingsRepository`'s returned object, alongside the existing two methods:

```typescript
    getUsageTelemetryConfig(): UsageTelemetryConfig {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(USAGE_TELEMETRY_KEY) as
        | { value: string }
        | undefined
      if (!row) return DEFAULT_USAGE_TELEMETRY_CONFIG
      try {
        const parsed = JSON.parse(row.value) as Partial<UsageTelemetryConfig>
        return {
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_USAGE_TELEMETRY_CONFIG.enabled,
          outputPath: typeof parsed.outputPath === 'string' ? parsed.outputPath : DEFAULT_USAGE_TELEMETRY_CONFIG.outputPath
        }
      } catch {
        return DEFAULT_USAGE_TELEMETRY_CONFIG
      }
    },
    setUsageTelemetryConfig(config: UsageTelemetryConfig): void {
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(USAGE_TELEMETRY_KEY, JSON.stringify(config))
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/db/appSettingsRepository.test.ts`
Expected: PASS (9 tests: 5 existing + 4 new)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/db/appSettingsRepository.ts tests/main/db/appSettingsRepository.test.ts
git commit -m "feat: add usage telemetry config persistence"
```

---

## Task 2: Usage telemetry record writer

**Files:**
- Create: `src/main/agent/usageTelemetry.ts`
- Test: `tests/main/agent/usageTelemetry.test.ts`

**Interfaces:**
- Consumes: `UsageTelemetryConfig` from Task 1's `src/shared/types.ts`, `TokenUsage` (already in `src/shared/types.ts:88-91`).
- Produces: `appendUsageTelemetryRecord(config: UsageTelemetryConfig, params: { model: { provider: string; id: string; name: string }; usage: TokenUsage; sessionId: string }): void` — consumed by Task 4's `sessionHandlers.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/main/agent/usageTelemetry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendUsageTelemetryRecord } from '../../../src/main/agent/usageTelemetry'

describe('appendUsageTelemetryRecord', () => {
  let dir: string
  let outputPath: string
  const originalEnv = process.env.OTEL_RESOURCE_ATTRIBUTES

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'usage-telemetry-test-'))
    outputPath = join(dir, 'usage.jsonl')
    delete process.env.OTEL_RESOURCE_ATTRIBUTES
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (originalEnv === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
    else process.env.OTEL_RESOURCE_ATTRIBUTES = originalEnv
  })

  // appendUsageTelemetryRecord writes fire-and-forget (it's a sync-signature,
  // async-internally function) -- these tests give the microtask/IO queue a
  // moment to flush before asserting on the file.
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  it('does not write anything when disabled', async () => {
    appendUsageTelemetryRecord(
      { enabled: false, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 100, output: 20 }, sessionId: 's1' }
    )
    await flush()
    expect(() => readFileSync(outputPath, 'utf-8')).toThrow()
  })

  it('does not write anything when enabled but no output path is set', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath: '' },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 100, output: 20 }, sessionId: 's1' }
    )
    await flush()
    expect(() => readFileSync(outputPath, 'utf-8')).toThrow()
  })

  it('appends one correctly-shaped JSON line when enabled with a valid path', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 12345, output: 678 }, sessionId: 'session-abc' }
    )
    await flush()

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])

    expect(Array.isArray(record.hrTime)).toBe(true)
    expect(record.hrTime).toHaveLength(2)
    expect(record.resource._rawAttributes).toContainEqual(['service.name', 'passcode-desktop'])
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(rawAttrs['session.id']).toBe('session-abc')
    expect(record.attributes['gen_ai.request.model']).toBe('claude-opus-4-5')
    expect(record.attributes['gen_ai.response.model']).toBe('claude-opus-4-5')
    expect(record.attributes['gen_ai.usage.input_tokens']).toBe(12345)
    expect(record.attributes['gen_ai.usage.output_tokens']).toBe(678)
    expect(typeof record.attributes['gen_ai.response.id']).toBe('string')
    expect(record.attributes['gen_ai.response.id'].length).toBeGreaterThan(0)
  })

  it('appends multiple records across multiple calls (one line each)', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1 }, sessionId: 's1' }
    )
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 2, output: 2 }, sessionId: 's1' }
    )
    await flush()

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('populates user.name and team.id from OTEL_RESOURCE_ATTRIBUTES when set', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'user.name=duylv-epam,team.id=skii-epam'
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1 }, sessionId: 's1' }
    )
    await flush()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(rawAttrs['user.name']).toBe('duylv-epam')
    expect(rawAttrs['team.id']).toBe('skii-epam')
  })

  it('falls back to the OS username and omits team.id when OTEL_RESOURCE_ATTRIBUTES is unset', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1 }, sessionId: 's1' }
    )
    await flush()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const keys = record.resource._rawAttributes.map((pair: [string, string]) => pair[0])
    expect(keys).toContain('user.name')
    expect(keys).not.toContain('team.id')
  })

  it('falls back gracefully on a malformed OTEL_RESOURCE_ATTRIBUTES value', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'not-a-valid-format;;;'
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1 }, sessionId: 's1' }
    )
    await flush()

    // Must not throw and must still produce a valid record with a fallback user.name.
    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(typeof rawAttrs['user.name']).toBe('string')
    expect(rawAttrs['user.name'].length).toBeGreaterThan(0)
  })

  it('does not throw when the output path is unwritable', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      appendUsageTelemetryRecord(
        { enabled: true, outputPath: join(dir, 'does', 'not', 'exist', 'usage.jsonl') },
        { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1 }, sessionId: 's1' }
      )
    ).not.toThrow()
    await flush()
    expect(consoleWarn).toHaveBeenCalled()
    consoleWarn.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/main/agent/usageTelemetry.test.ts`
Expected: FAIL — `Cannot find module '../../../src/main/agent/usageTelemetry'`

- [ ] **Step 3: Implement the writer**

Create `src/main/agent/usageTelemetry.ts`:

```typescript
import { appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import type { TokenUsage, UsageTelemetryConfig } from '../../shared/types'

const APP_VERSION = process.env.npm_package_version ?? '0.0.0'

function resolveIdentity(): { userName: string; teamId?: string } {
  const raw = process.env.OTEL_RESOURCE_ATTRIBUTES
  const attrs: Record<string, string> = {}
  if (raw) {
    for (const pair of raw.split(',')) {
      const [key, value] = pair.split('=')
      if (key && value) attrs[key.trim()] = value.trim()
    }
  }
  let userName = attrs['user.name']
  if (!userName) {
    try {
      userName = userInfo().username
    } catch {
      userName = 'unknown'
    }
  }
  return { userName, teamId: attrs['team.id'] }
}

/** Appends one OpenTelemetry-shaped log record for a single real LLM
 * inference call, matching the exact JSON shape VS Code's Copilot Chat
 * extension already writes to its own OTel export file -- so an existing
 * external aggregator (Export-CopilotTokens.ps1) picks these records up
 * with zero changes on its side. Fire-and-forget: this never throws to
 * its caller, and every failure (disabled, unset path, write error) is
 * either a silent no-op or a console.warn, never a rejection the caller
 * has to handle. */
export function appendUsageTelemetryRecord(
  config: UsageTelemetryConfig,
  params: { model: { provider: string; id: string; name: string }; usage: TokenUsage; sessionId: string }
): void {
  if (!config.enabled || !config.outputPath) return

  const now = Date.now()
  const hrTime: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1_000_000]
  const { userName, teamId } = resolveIdentity()

  const rawAttributes: [string, string][] = [
    ['service.name', 'passcode-desktop'],
    ['service.version', APP_VERSION],
    ['session.id', params.sessionId],
    ['user.name', userName]
  ]
  if (teamId) rawAttributes.push(['team.id', teamId])

  const record = {
    hrTime,
    hrTimeObserved: hrTime,
    resource: { _rawAttributes: rawAttributes },
    instrumentationScope: { name: 'passcode-desktop', version: APP_VERSION },
    attributes: {
      'event.name': 'gen_ai.client.inference.operation.details',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': params.model.id,
      'gen_ai.response.model': params.model.id,
      'gen_ai.response.id': randomUUID(),
      'gen_ai.usage.input_tokens': params.usage.input,
      'gen_ai.usage.output_tokens': params.usage.output
    },
    _body: `GenAI inference: ${params.model.id}`
  }

  void appendFile(config.outputPath, JSON.stringify(record) + '\n', 'utf-8').catch((err) => {
    console.warn('[usageTelemetry] failed to write usage record:', err)
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/agent/usageTelemetry.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/usageTelemetry.ts tests/main/agent/usageTelemetry.test.ts
git commit -m "feat: add OTel-shaped usage telemetry record writer"
```

---

## Task 3: Settings config IPC (get/set UsageTelemetryConfig)

**Files:**
- Modify: `src/shared/types.ts:213-219` (`Api.settings`)
- Modify: `src/main/ipc/settingsHandlers.ts`
- Modify: `src/main/ipc/register.ts`
- Modify: `src/preload/index.ts:48-58` (`settings` bridge)
- Modify: `src/main/index.ts:121` (`createSettingsHandlers` call site)
- Test: `tests/main/ipc/settingsHandlers.test.ts`

**Interfaces:**
- Consumes: `AppSettingsRepository.getUsageTelemetryConfig()`/`setUsageTelemetryConfig()` from Task 1.
- Produces: `Api.settings.getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>` / `setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<void>` — consumed by Task 5's `SettingsPanel.tsx`. Also produces `createSettingsHandlers`'s new second parameter shape, which Task 4 does NOT need (Task 4 only touches `createSessionHandlers`, a separate factory) — noted here only so nobody confuses the two.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc/settingsHandlers.test.ts`, update the import to add `UsageTelemetryConfig`:

```typescript
import type { CopilotQuota, UsageTelemetryConfig } from '../../../src/shared/types'
```

Add a minimal fake `AppSettingsRepository`, and update the `beforeEach`'s `createSettingsHandlers` call to pass it as a second argument. `storedTelemetryConfig` must be readable and writable from inside individual `it()` blocks (some of the new tests below read it after calling a handler method, others set it before), so it — like the existing `modelRuntime`/`handlers` — must be declared at `describe`-level, NOT inside `beforeEach`.

Add this import at the top of the file, alongside the existing imports:

```typescript
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
```

Add these two lines at `describe`-level, right next to the existing `let modelRuntime: ModelRuntimeLike` / `let handlers: SettingsHandlers` declarations (NOT inside `beforeEach`):

```typescript
  let appSettingsRepo: AppSettingsRepository
  let storedTelemetryConfig: UsageTelemetryConfig
```

Inside the existing `beforeEach`, right after the `modelRuntime = {...}` assignment, add:

```typescript
    storedTelemetryConfig = { enabled: false, outputPath: '' }
    appSettingsRepo = {
      getToolApprovalPolicy: () => ({ autoApprove: {} }),
      setToolApprovalPolicy: () => {},
      getUsageTelemetryConfig: () => storedTelemetryConfig,
      setUsageTelemetryConfig: (config) => {
        storedTelemetryConfig = config
      }
    }
```

Then change the existing `handlers = createSettingsHandlers(modelRuntime)` line (still inside `beforeEach`) to:

```typescript
    handlers = createSettingsHandlers(modelRuntime, appSettingsRepo)
```

Then add these tests inside the `describe('settingsHandlers', ...)` block:

```typescript
  it('returns the current usage telemetry config from the repository', async () => {
    storedTelemetryConfig = { enabled: true, outputPath: '/some/path.jsonl' }
    expect(await handlers.getUsageTelemetryConfig()).toEqual({ enabled: true, outputPath: '/some/path.jsonl' })
  })

  it('persists a new usage telemetry config via the repository', async () => {
    await handlers.setUsageTelemetryConfig({ enabled: true, outputPath: '/new/path.jsonl' })
    expect(storedTelemetryConfig).toEqual({ enabled: true, outputPath: '/new/path.jsonl' })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/main/ipc/settingsHandlers.test.ts`
Expected: FAIL — `createSettingsHandlers` called with 2 arguments but the current signature only accepts 1 (a type error at minimum, and `handlers.getUsageTelemetryConfig is not a function` at runtime).

- [ ] **Step 3: Add the IPC surface to the shared `Api` type**

In `src/shared/types.ts`, extend `Api.settings` (currently lines 213-219):

```typescript
  settings: {
    setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
    getAuthStatus(): Promise<AuthStatus>
    loginCopilot(): Promise<{ ok: true } | { ok: false; error: string }>
    onCopilotChallenge(listener: (challenge: DeviceCodeChallenge) => void): () => void
    getCopilotQuota(): Promise<CopilotQuota | null>
    getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
    setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<void>
  }
```

- [ ] **Step 4: Wire the main-process handler**

In `src/main/ipc/settingsHandlers.ts`, update the imports:

```typescript
import type { AuthCheck, AuthInteraction, AuthType, Credential } from '@earendil-works/pi-ai'
import { fetchCopilotQuota } from '../agent/copilotQuota'
import type { AppSettingsRepository } from '../db/appSettingsRepository'
import type { AuthStatus, CopilotQuota, DeviceCodeChallenge, UsageTelemetryConfig } from '../../shared/types'
```

Add the two methods to the `SettingsHandlers` interface:

```typescript
export interface SettingsHandlers {
  setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  getAuthStatus(): Promise<AuthStatus>
  loginCopilot(
    onChallenge: (challenge: DeviceCodeChallenge) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
  getCopilotQuota(): Promise<CopilotQuota | null>
  getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
  setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<void>
}
```

Update `createSettingsHandlers`'s signature to accept the repository, and add the two implementations:

```typescript
export function createSettingsHandlers(
  modelRuntime: ModelRuntimeLike,
  appSettingsRepo: AppSettingsRepository
): SettingsHandlers {
  return {
    // ...existing methods unchanged...
    async getCopilotQuota() {
      return fetchCopilotQuota()
    },
    async getUsageTelemetryConfig() {
      return appSettingsRepo.getUsageTelemetryConfig()
    },
    async setUsageTelemetryConfig(config: UsageTelemetryConfig) {
      appSettingsRepo.setUsageTelemetryConfig(config)
    }
  }
}
```

- [ ] **Step 5: Wire the IPC channel**

In `src/main/ipc/register.ts`, add these two lines right after the existing `settings:getCopilotQuota` handler registration:

```typescript
  ipcMain.handle('settings:getUsageTelemetryConfig', () => handlers.settings.getUsageTelemetryConfig())
  ipcMain.handle('settings:setUsageTelemetryConfig', (_e, config: UsageTelemetryConfig) =>
    handlers.settings.setUsageTelemetryConfig(config)
  )
```

`register.ts` currently has this import line near the top:

```typescript
import type { PromptOptions, ToolApprovalPolicy } from '../../shared/types'
```

Change it to:

```typescript
import type { PromptOptions, ToolApprovalPolicy, UsageTelemetryConfig } from '../../shared/types'
```

- [ ] **Step 6: Wire the preload bridge**

In `src/preload/index.ts`, add to the `settings` object (currently lines 48-58):

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
    getCopilotQuota: () => ipcRenderer.invoke('settings:getCopilotQuota'),
    getUsageTelemetryConfig: () => ipcRenderer.invoke('settings:getUsageTelemetryConfig'),
    setUsageTelemetryConfig: (config) => ipcRenderer.invoke('settings:setUsageTelemetryConfig', config)
  },
```

- [ ] **Step 7: Update the `createSettingsHandlers` call site**

In `src/main/index.ts`, find the line `settings: createSettingsHandlers(modelRuntime),` (currently line 121) and change it to pass the already-existing `appSettingsRepo` (already created earlier in this same file for the tool-approval-policy wiring — do not create a second instance):

```typescript
    settings: createSettingsHandlers(modelRuntime, appSettingsRepo),
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/main/ipc/settingsHandlers.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add src/shared/types.ts src/main/ipc/settingsHandlers.ts src/main/ipc/register.ts src/preload/index.ts src/main/index.ts tests/main/ipc/settingsHandlers.test.ts
git commit -m "feat: expose usage telemetry config over IPC"
```

---

## Task 4: Wire emission into sessionHandlers.ts

**Files:**
- Modify: `src/main/ipc/sessionHandlers.ts:21-34` (`CreateSessionHandlersDeps`), `:82-96` (`ensureSession`'s subscribe block)
- Modify: `src/main/index.ts:107-120` (`createSessionHandlers` call site)
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `appendUsageTelemetryRecord` from Task 2's `src/main/agent/usageTelemetry.ts`, `UsageTelemetryConfig` from Task 1.
- Produces: `CreateSessionHandlersDeps.getUsageTelemetryConfig?: () => UsageTelemetryConfig` — an OPTIONAL field (see Step 3 below for why), so the 5 existing `createSessionHandlers(...)` call sites already in `tests/main/ipc/sessionHandlers.test.ts` keep compiling and passing unchanged.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc/sessionHandlers.test.ts`, add a mock for the usage-telemetry module right after the existing imports, before the `describe` block:

```typescript
const appendUsageTelemetryRecordMock = vi.fn()

vi.mock('../../../src/main/agent/usageTelemetry', () => ({
  appendUsageTelemetryRecord: appendUsageTelemetryRecordMock
}))
```

Then add this test inside the existing `describe('sessionHandlers', ...)` block, near the other `subscribeListener`-driven tests (search the file for `subscribeListener?.(` for the existing pattern to follow):

```typescript
  it('emits a usage telemetry record when a model_usage event arrives, using the current model and configured telemetry settings', async () => {
    appendUsageTelemetryRecordMock.mockClear()
    const telemetryConfig = { enabled: true, outputPath: '/fake/usage.jsonl' }
    // reposRepo itself is local to the outer beforeEach and not in scope
    // here -- follow the same fake-inline-repo workaround the existing
    // "builds the prompt text..." test above already uses.
    const localHandlers = createSessionHandlers({
      reposRepo: { getById: () => ({ id: repoId, projectId: 'p1', path: '/repo/path', name: 'demo-repo' }) } as never,
      sessionsRepo,
      openRepoSession: openRepoSessionMock,
      onEvent: () => {},
      requestApproval: async () => true,
      findModel: findModelMock,
      buildPromptText: async (text) => text,
      getUsageTelemetryConfig: () => telemetryConfig
    })
    const session = localHandlers.createSession(repoId)
    await localHandlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never

    subscribeListener?.({
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 500, output: 42 } }
    })

    expect(appendUsageTelemetryRecordMock).toHaveBeenCalledWith(telemetryConfig, {
      model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
      usage: { input: 500, output: 42 },
      sessionId: 'pi-session-1'
    })
  })

  it('does not emit a usage telemetry record when getUsageTelemetryConfig is not provided', async () => {
    appendUsageTelemetryRecordMock.mockClear()
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    currentModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' } as never

    subscribeListener?.({
      type: 'message_end',
      message: { role: 'assistant', usage: { input: 500, output: 42 } }
    })

    expect(appendUsageTelemetryRecordMock).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: FAIL — `getUsageTelemetryConfig` doesn't exist on `CreateSessionHandlersDeps` (a type error), and even if TypeScript is bypassed, `appendUsageTelemetryRecordMock` was never called.

- [ ] **Step 3: Wire the emission point**

`CreateSessionHandlersDeps` gains `getUsageTelemetryConfig` as an OPTIONAL field — this repo's test file already has 5 separate `createSessionHandlers({...})` call sites that don't (and per the second new test above, shouldn't need to) supply it, and making it required would force editing every one of them for a dependency most of those tests don't care about. Optional-with-a-no-op-default is also simply correct behavior: no config source means "don't emit."

In `src/main/ipc/sessionHandlers.ts`, update the imports:

```typescript
import type { Model } from '@earendil-works/pi-ai'
import type { RepoSession } from '../agent/piSession'
import { appendUsageTelemetryRecord } from '../agent/usageTelemetry'
import type { SessionsRepository } from '../db/sessionsRepository'
import type { ReposRepository } from '../db/reposRepository'
import type { ProjectsRepository } from '../db/projectsRepository'
import type { BuildPromptTextOptions } from '../agent/promptBuilder'
import type {
  ChatEvent,
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

Add the optional field to `CreateSessionHandlersDeps`:

```typescript
export interface CreateSessionHandlersDeps {
  reposRepo: ReposRepository
  projectsRepo: ProjectsRepository
  sessionsRepo: SessionsRepository
  openRepoSession: (
    cwd: string,
    requestApproval: (toolName: string, input: unknown) => Promise<boolean>,
    resumeSessionFile?: string
  ) => Promise<{ repoSession: RepoSession; sessionId: string; sessionFile: string | undefined }>
  onEvent: (sessionId: string, event: ChatEvent) => void
  requestApproval: (sessionId: string, toolName: string, input: unknown) => Promise<boolean>
  findModel: (provider: string, modelId: string) => Model<any> | undefined
  buildPromptText: (text: string, options?: BuildPromptTextOptions) => Promise<string>
  /** Read fresh on every emitted usage record (not cached at session-open
   * time) so toggling the setting in a running app takes effect on the
   * very next inference call. Omitted entirely (rather than a default
   * config object) when the caller doesn't wire telemetry at all. */
  getUsageTelemetryConfig?: () => UsageTelemetryConfig
}
```

Update the `subscribe` callback inside `ensureSession` (currently lines 82-96):

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

- [ ] **Step 4: Wire the real config source in `main/index.ts`**

In `src/main/index.ts`, find the `createSessionHandlers({...})` call (currently lines 107-120) and add the new field:

```typescript
    session: createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo,
      openRepoSession: (cwd, requestApproval, resumeSessionFile) =>
        createRepoSession({ cwd, modelRuntime, requestApproval, resumeSessionFile }),
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)
      },
      requestApproval: (sessionId, toolName, input) =>
        approvalHandlers.requestApproval(sessionId, toolName, input),
      findModel: (provider, modelId) => modelRegistry.find(provider, modelId),
      buildPromptText,
      getUsageTelemetryConfig: () => appSettingsRepo.getUsageTelemetryConfig()
    }),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/sessionHandlers.ts src/main/index.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "feat: emit usage telemetry records on every model inference call"
```

---

## Task 5: Settings UI — telemetry toggle and path field

**Files:**
- Modify: `src/renderer/src/components/SettingsPanel.tsx`
- Modify: `src/renderer/src/theme.css`

**Interfaces:**
- Consumes: `window.api.settings.getUsageTelemetryConfig()` / `setUsageTelemetryConfig()` and `UsageTelemetryConfig` from Task 3's `src/shared/types.ts`.

- [ ] **Step 1: Import the type and add state**

In `src/renderer/src/components/SettingsPanel.tsx`, update the import line:

```typescript
import type { AuthStatus, CopilotQuota, DeviceCodeChallenge, ToolApprovalPolicy, UsageTelemetryConfig } from '../../../shared/types'
```

Add state inside the `SettingsPanel` component, alongside the other `useState` calls:

```typescript
  const [telemetryConfig, setTelemetryConfig] = useState<UsageTelemetryConfig | null>(null)
  const [telemetryPathDraft, setTelemetryPathDraft] = useState('')
```

- [ ] **Step 2: Load the config on mount and keep a local draft of the path**

Add to the existing on-mount `useEffect` (the one that already calls `refresh()` and `window.api.approvals.getPolicy().then(setPolicy)`):

```typescript
  useEffect(() => {
    refresh()
    window.api.approvals.getPolicy().then(setPolicy)
    window.api.settings.getUsageTelemetryConfig().then((config) => {
      setTelemetryConfig(config)
      setTelemetryPathDraft(config.outputPath)
    })
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    return unsubscribe
  }, [])
```

Add two handlers, alongside the component's other handler functions (e.g. near `toggleAutoApprove`):

```typescript
  async function toggleUsageTelemetry(): Promise<void> {
    if (!telemetryConfig) return
    const next = { ...telemetryConfig, enabled: !telemetryConfig.enabled }
    setTelemetryConfig(next)
    await window.api.settings.setUsageTelemetryConfig(next)
  }

  async function saveTelemetryPath(): Promise<void> {
    if (!telemetryConfig) return
    const next = { ...telemetryConfig, outputPath: telemetryPathDraft }
    setTelemetryConfig(next)
    await window.api.settings.setUsageTelemetryConfig(next)
  }
```

- [ ] **Step 3: Render the row**

Find the `'general'` section (currently lines 159-181):

```jsx
          {section === 'general' && (
            <div className="settings-group">
              <div className="settings-row settings-row-theme">
                <div className="settings-row-text">
                  <span className="settings-row-title">Appearance</span>
                  <span className="settings-row-desc">Color scheme for the app window</span>
                </div>
              </div>
              <div className="theme-swatches">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`theme-swatch theme-swatch-${opt.value}${theme === opt.value ? ' is-selected' : ''}`}
                    onClick={() => setTheme(opt.value)}
                  >
                    <span className="theme-swatch-preview" />
                    <span className="theme-swatch-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
```

Add a new row after the `theme-swatches` div, still inside the same `settings-group`:

```jsx
          {section === 'general' && (
            <div className="settings-group">
              <div className="settings-row settings-row-theme">
                <div className="settings-row-text">
                  <span className="settings-row-title">Appearance</span>
                  <span className="settings-row-desc">Color scheme for the app window</span>
                </div>
              </div>
              <div className="theme-swatches">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`theme-swatch theme-swatch-${opt.value}${theme === opt.value ? ' is-selected' : ''}`}
                    onClick={() => setTheme(opt.value)}
                  >
                    <span className="theme-swatch-preview" />
                    <span className="theme-swatch-label">{opt.label}</span>
                  </button>
                ))}
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">Usage Telemetry</span>
                  <span className="settings-row-desc">
                    Export token usage as OpenTelemetry log records for external aggregation
                  </span>
                </div>
                <div className="settings-row-control">
                  <Switch checked={!!telemetryConfig?.enabled} onChange={toggleUsageTelemetry} />
                </div>
              </div>
              {telemetryConfig?.enabled && (
                <div className="settings-row">
                  <div className="settings-row-text">
                    <span className="settings-row-title">Output File</span>
                    <span className="settings-row-desc">Path to append OTel log records to (JSONL, one record per line)</span>
                  </div>
                  <div className="settings-row-control settings-key-control">
                    <input
                      className="settings-input"
                      type="text"
                      value={telemetryPathDraft}
                      onChange={(e) => setTelemetryPathDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveTelemetryPath()
                      }}
                      placeholder="C:\Code\.telemetry\copilot-working.jsonl"
                    />
                    <button className="settings-btn" onClick={saveTelemetryPath}>
                      Save
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 5: Manual test**

Run the app (`npm run dev`), open Settings → General. Confirm the "Usage Telemetry" toggle appears, off by default, with no path field showing. Enable it; confirm the path field appears. Type a path to a scratch file (e.g. a temp `.jsonl` file) and click Save (or press Enter). Send a chat message that completes at least one turn. Confirm the file now contains one JSON line per real inference call the turn made (more than one if the turn used a tool), each with `gen_ai.usage.input_tokens`/`output_tokens` matching what the UI's own token-count chip showed for that action. Toggle the switch off; confirm the path field disappears (but the saved path is retained if you toggle back on). Restart the app; confirm the toggle state and path both persisted.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/SettingsPanel.tsx src/renderer/src/theme.css
git commit -m "feat: add usage telemetry toggle and output path to Settings"
```
