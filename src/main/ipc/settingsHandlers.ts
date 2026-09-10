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
