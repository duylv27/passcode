import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSettingsHandlers,
  type ModelRuntimeLike,
  type SettingsHandlers
} from '../../../src/main/ipc/settingsHandlers'
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
import type { UsageTelemetryConfig } from '../../../src/shared/types'

describe('settingsHandlers', () => {
  let modelRuntime: ModelRuntimeLike
  let handlers: SettingsHandlers
  let appSettingsRepo: AppSettingsRepository
  let storedTelemetryConfig: UsageTelemetryConfig

  beforeEach(() => {
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async (providerId: string) =>
        providerId === 'anthropic' ? { type: 'api_key' as const } : undefined
      ),
      login: vi.fn(async () => ({ type: 'oauth', refresh: '', access: '', expires: 0 }) as never)
    }
    storedTelemetryConfig = { enabled: false, outputPath: '' }
    appSettingsRepo = {
      getToolApprovalPolicy: () => ({ autoApprove: {} }),
      setToolApprovalPolicy: () => {},
      getUsageTelemetryConfig: () => storedTelemetryConfig,
      setUsageTelemetryConfig: (config) => {
        storedTelemetryConfig = config
      }
    }
    handlers = createSettingsHandlers(modelRuntime, appSettingsRepo)
  })

  it('sets a valid Anthropic API key', async () => {
    const result = await handlers.setAnthropicApiKey('sk-test-123')
    expect(result.ok).toBe(true)
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-test-123')
  })

  it('rejects an empty API key', async () => {
    const result = await handlers.setAnthropicApiKey('   ')
    expect(result.ok).toBe(false)
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
  })

  it('reports auth status per provider based on whether checkAuth resolves a value', async () => {
    const status = await handlers.getAuthStatus()
    expect(status).toEqual({ anthropic: true, copilot: false })
  })

  it('signs in to Copilot and surfaces the device code challenge', async () => {
    const challenges: Array<{ userCode: string; verificationUri: string }> = []
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (event: unknown) => void }) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device'
        })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )

    const result = await handlers.loginCopilot((c) => challenges.push(c))

    expect(result.ok).toBe(true)
    expect(challenges).toEqual([{ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }])
  })

  it('reports a failed Copilot login', async () => {
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('user cancelled'))

    const result = await handlers.loginCopilot(() => {})

    expect(result).toEqual({ ok: false, error: 'user cancelled' })
  })

  it('answers a text prompt during Copilot login automatically (defaults to github.com)', async () => {
    let promptedValue: string | undefined
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (
        _providerId: string,
        _type: string,
        interaction: { prompt: (p: { type: string }) => Promise<string> }
      ) => {
        promptedValue = await interaction.prompt({ type: 'text' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )

    const result = await handlers.loginCopilot(() => {})

    expect(result.ok).toBe(true)
    expect(promptedValue).toBe('')
  })

  it('rejects a non-text interactive prompt during Copilot login', async () => {
    ;(modelRuntime.login as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (
        _providerId: string,
        _type: string,
        interaction: { prompt: (p: { type: string }) => Promise<string> }
      ) => {
        await interaction.prompt({ type: 'secret' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )

    const result = await handlers.loginCopilot(() => {})

    expect(result).toEqual({
      ok: false,
      error: 'Interactive login prompt of type "secret" is not supported yet'
    })
  })

  it('returns the current usage telemetry config from the repository', async () => {
    storedTelemetryConfig = { enabled: true, outputPath: '/some/path.jsonl' }
    expect(await handlers.getUsageTelemetryConfig()).toEqual({ enabled: true, outputPath: '/some/path.jsonl' })
  })

  it('persists a new usage telemetry config via the repository', async () => {
    await handlers.setUsageTelemetryConfig({ enabled: true, outputPath: '/new/path.jsonl' })
    expect(storedTelemetryConfig).toEqual({ enabled: true, outputPath: '/new/path.jsonl' })
  })
})
