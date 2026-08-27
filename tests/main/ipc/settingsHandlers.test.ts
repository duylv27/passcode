import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSettingsHandlers,
  type ModelRuntimeLike,
  type SettingsHandlers
} from '../../../src/main/ipc/settingsHandlers'

describe('settingsHandlers', () => {
  let modelRuntime: ModelRuntimeLike
  let handlers: SettingsHandlers

  beforeEach(() => {
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async (providerId: string) =>
        providerId === 'anthropic' ? { type: 'api_key' as const } : undefined
      ),
      login: vi.fn(async () => ({ type: 'oauth', refresh: '', access: '', expires: 0 }) as never)
    }
    handlers = createSettingsHandlers(modelRuntime)
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
})
