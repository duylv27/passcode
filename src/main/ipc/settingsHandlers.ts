import { fetchCopilotQuota } from '../agent/copilotQuota'
import { probeUsageTelemetryPath } from '../agent/usageTelemetry'
import type { AppSettingsRepository } from '../db/appSettingsRepository'
import type { CopilotQuota, UsageTelemetryConfig } from '../../shared/types'

export interface SettingsHandlers {
  getCopilotQuota(): Promise<CopilotQuota | null>
  getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
  setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<{ ok: true } | { ok: false; error: string }>
}

// fetchCopilotQuota() is a real network call to GitHub's Copilot API, and
// every open Copilot-model session's ChatPanel calls this IPC on mount --
// a short cache collapses that burst (and any quick popover re-opens) into
// one real request instead of one per session.
const QUOTA_CACHE_TTL_MS = 5 * 60_000

export function createSettingsHandlers(
  appSettingsRepo: Pick<AppSettingsRepository, 'getUsageTelemetryConfig' | 'setUsageTelemetryConfig'>
): SettingsHandlers {
  let quotaCache: { at: number; quota: CopilotQuota | null } | null = null
  return {
    async getCopilotQuota() {
      if (quotaCache && Date.now() - quotaCache.at < QUOTA_CACHE_TTL_MS) return quotaCache.quota
      const quota = await fetchCopilotQuota()
      quotaCache = { at: Date.now(), quota }
      return quota
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
