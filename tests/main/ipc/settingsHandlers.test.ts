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
