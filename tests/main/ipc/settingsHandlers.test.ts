import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSettingsHandlers,
  type ModelRuntimeLike,
  type SettingsHandlers
} from '../../../src/main/ipc/settingsHandlers'
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
import type { UsageTelemetryConfig } from '../../../src/shared/types'

const { probeUsageTelemetryPathMock } = vi.hoisted(() => ({
  probeUsageTelemetryPathMock: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../../src/main/agent/usageTelemetry', () => ({
  probeUsageTelemetryPath: probeUsageTelemetryPathMock
}))

const { validateAnthropicApiKeyMock, validateGeminiApiKeyMock } = vi.hoisted(() => ({
  validateAnthropicApiKeyMock: vi.fn(async () => ({ ok: true as const })),
  validateGeminiApiKeyMock: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../../src/main/agent/providerValidation', () => ({
  validateAnthropicApiKey: validateAnthropicApiKeyMock,
  validateGeminiApiKey: validateGeminiApiKeyMock
}))

describe('settingsHandlers', () => {
  let modelRuntime: ModelRuntimeLike
  let handlers: SettingsHandlers
  let appSettingsRepo: AppSettingsRepository
  let storedTelemetryConfig: UsageTelemetryConfig
  let storedProviderApiKeys: Record<string, string>

  beforeEach(() => {
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async (providerId: string) =>
        providerId === 'anthropic' ? { type: 'api_key' as const } : undefined
      ),
      login: vi.fn(async () => ({ type: 'oauth', refresh: '', access: '', expires: 0 }) as never)
    }
    storedTelemetryConfig = { enabled: false, outputPath: '' }
    probeUsageTelemetryPathMock.mockReset()
    probeUsageTelemetryPathMock.mockResolvedValue({ ok: true })
    validateAnthropicApiKeyMock.mockReset()
    validateAnthropicApiKeyMock.mockResolvedValue({ ok: true })
    validateGeminiApiKeyMock.mockReset()
    validateGeminiApiKeyMock.mockResolvedValue({ ok: true })
    storedProviderApiKeys = {}
    appSettingsRepo = {
      getToolApprovalPolicy: () => ({ autoApprove: {} }),
      setToolApprovalPolicy: () => {},
      getUsageTelemetryConfig: () => storedTelemetryConfig,
      setUsageTelemetryConfig: (config) => {
        storedTelemetryConfig = config
      },
      getProviderApiKeys: () => storedProviderApiKeys,
      setProviderApiKey: (providerId, apiKey) => {
        storedProviderApiKeys = { ...storedProviderApiKeys, [providerId]: apiKey }
      }
    }
    handlers = createSettingsHandlers(modelRuntime, appSettingsRepo)
  })

  it('sets a valid Anthropic API key', async () => {
    const result = await handlers.setAnthropicApiKey('sk-test-123')
    expect(result.ok).toBe(true)
    expect(validateAnthropicApiKeyMock).toHaveBeenCalledWith('sk-test-123')
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-test-123')
  })

  it('persists a valid Anthropic API key to appSettingsRepo, so it survives a restart', async () => {
    await handlers.setAnthropicApiKey('sk-test-123')
    expect(appSettingsRepo.getProviderApiKeys()).toEqual({ anthropic: 'sk-test-123' })
  })

  it('rejects an empty API key', async () => {
    const result = await handlers.setAnthropicApiKey('   ')
    expect(result.ok).toBe(false)
    expect(validateAnthropicApiKeyMock).not.toHaveBeenCalled()
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
  })

  it('rejects an Anthropic key that fails live validation, without persisting it', async () => {
    validateAnthropicApiKeyMock.mockResolvedValue({ ok: false, error: 'Anthropic rejected this key: 401 Unauthorized' })
    const result = await handlers.setAnthropicApiKey('sk-bad-key')
    expect(result).toEqual({ ok: false, error: 'Anthropic rejected this key: 401 Unauthorized' })
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
    expect(appSettingsRepo.getProviderApiKeys()).toEqual({})
  })

  it('reports auth status per provider based on whether checkAuth resolves a value', async () => {
    const status = await handlers.getAuthStatus()
    expect(status).toEqual({ anthropic: true, copilot: false, gemini: false })
  })

  it('sets a valid Gemini API key', async () => {
    const result = await handlers.setGeminiApiKey('AIza-test-123')
    expect(result.ok).toBe(true)
    expect(validateGeminiApiKeyMock).toHaveBeenCalledWith('AIza-test-123')
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('google', 'AIza-test-123')
  })

  it('persists a valid Gemini API key to appSettingsRepo, so it survives a restart', async () => {
    await handlers.setGeminiApiKey('AIza-test-123')
    expect(appSettingsRepo.getProviderApiKeys()).toEqual({ google: 'AIza-test-123' })
  })

  it('rejects an empty Gemini API key', async () => {
    const result = await handlers.setGeminiApiKey('   ')
    expect(result.ok).toBe(false)
    expect(validateGeminiApiKeyMock).not.toHaveBeenCalled()
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
  })

  it('rejects a Gemini key that fails live validation, without persisting it', async () => {
    validateGeminiApiKeyMock.mockResolvedValue({ ok: false, error: 'Gemini rejected this key: 400 Bad Request' })
    const result = await handlers.setGeminiApiKey('bad-key')
    expect(result).toEqual({ ok: false, error: 'Gemini rejected this key: 400 Bad Request' })
    expect(modelRuntime.setRuntimeApiKey).not.toHaveBeenCalled()
    expect(appSettingsRepo.getProviderApiKeys()).toEqual({})
  })

  it('reports gemini connected once checkAuth resolves a value for google', async () => {
    ;(modelRuntime.checkAuth as ReturnType<typeof vi.fn>).mockImplementation(async (providerId: string) =>
      providerId === 'google' ? { type: 'api_key' as const } : undefined
    )
    const status = await handlers.getAuthStatus()
    expect(status).toEqual({ anthropic: false, copilot: false, gemini: true })
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
