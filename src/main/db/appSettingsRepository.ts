import type { DatabaseSync } from 'node:sqlite'
import type { ToolApprovalPolicy, UsageTelemetryConfig } from '../../shared/types'

const POLICY_KEY = 'toolApprovalPolicy'

export const DEFAULT_TOOL_APPROVAL_POLICY: ToolApprovalPolicy = {
  autoApprove: {
    read: true,
    grep: true,
    find: true,
    ls: true,
    bash: false,
    powershell: false,
    edit: false,
    write: false
  }
}

const USAGE_TELEMETRY_KEY = 'usageTelemetryConfig'

export const DEFAULT_USAGE_TELEMETRY_CONFIG: UsageTelemetryConfig = {
  enabled: false,
  outputPath: ''
}

// ModelRuntime.setRuntimeApiKey() is explicitly documented (in the SDK's
// RuntimeCredentials class) as a non-persistent, in-memory-only override --
// it's wiped on every process restart, including electron-vite's dev-mode
// auto-restart on a main-process file change. Persisting the raw key
// ourselves here and replaying setRuntimeApiKey() on startup (see
// main/index.ts) is what makes "Connected" survive a restart. Stored in
// plaintext in this app's own local SQLite DB -- the same trust boundary
// this app already relies on for other local secrets.
const PROVIDER_API_KEYS_KEY = 'providerApiKeys'

function readProviderApiKeys(db: DatabaseSync): Record<string, string> {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(PROVIDER_API_KEYS_KEY) as
    | { value: string }
    | undefined
  if (!row) return {}
  try {
    const parsed = JSON.parse(row.value) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const result: Record<string, string> = {}
    for (const [providerId, apiKey] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof apiKey === 'string') result[providerId] = apiKey
    }
    return result
  } catch {
    return {}
  }
}

// The hidden project+repo backing project-less "general" sessions (see
// sessionHandlers.ts's createGeneralSession) -- a repo row always needs a
// real project_id (NOT NULL FK), so one hidden project is created once and
// its id/repo id are remembered here rather than re-created on every call
// or looked up by a reserved name (which a user could otherwise collide
// with by typing the same project name themselves).
const GENERAL_REPO_KEY = 'generalRepo'

export interface GeneralRepoInfo {
  projectId: string
  repoId: string
}

export interface AppSettingsRepository {
  getToolApprovalPolicy(): ToolApprovalPolicy
  setToolApprovalPolicy(policy: ToolApprovalPolicy): void
  getUsageTelemetryConfig(): UsageTelemetryConfig
  setUsageTelemetryConfig(config: UsageTelemetryConfig): void
  getProviderApiKeys(): Record<string, string>
  setProviderApiKey(providerId: string, apiKey: string): void
  getGeneralRepo(): GeneralRepoInfo | null
  setGeneralRepo(info: GeneralRepoInfo): void
}

export function createAppSettingsRepository(db: DatabaseSync): AppSettingsRepository {
  return {
    getToolApprovalPolicy(): ToolApprovalPolicy {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(POLICY_KEY) as
        | { value: string }
        | undefined
      if (!row) return DEFAULT_TOOL_APPROVAL_POLICY
      try {
        const parsed = JSON.parse(row.value) as Partial<ToolApprovalPolicy>
        return {
          autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, ...parsed.autoApprove }
        }
      } catch {
        return DEFAULT_TOOL_APPROVAL_POLICY
      }
    },
    setToolApprovalPolicy(policy: ToolApprovalPolicy): void {
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(POLICY_KEY, JSON.stringify(policy))
    },
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
    },
    getProviderApiKeys(): Record<string, string> {
      return readProviderApiKeys(db)
    },
    setProviderApiKey(providerId: string, apiKey: string): void {
      const next = { ...readProviderApiKeys(db), [providerId]: apiKey }
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(PROVIDER_API_KEYS_KEY, JSON.stringify(next))
    },
    getGeneralRepo(): GeneralRepoInfo | null {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(GENERAL_REPO_KEY) as
        | { value: string }
        | undefined
      if (!row) return null
      try {
        const parsed = JSON.parse(row.value) as Partial<GeneralRepoInfo>
        if (typeof parsed.projectId === 'string' && typeof parsed.repoId === 'string') {
          return { projectId: parsed.projectId, repoId: parsed.repoId }
        }
        return null
      } catch {
        return null
      }
    },
    setGeneralRepo(info: GeneralRepoInfo): void {
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(GENERAL_REPO_KEY, JSON.stringify(info))
    }
  }
}
