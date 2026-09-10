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
