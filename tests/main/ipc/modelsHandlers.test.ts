import { describe, it, expect, vi } from 'vitest'
import { createModelsHandlers } from '../../../src/main/ipc/modelsHandlers'

describe('modelsHandlers', () => {
  it('maps available models to id/name/provider info, including a friendly provider display name', () => {
    const registry = {
      getAvailable: vi.fn(() => [
        { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5', extra: 'ignored' },
        { provider: 'google', id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
      ]),
      getProviderDisplayName: vi.fn((provider: string) =>
        provider === 'anthropic' ? 'Anthropic' : provider === 'google' ? 'Google' : provider
      )
    } as never

    const handlers = createModelsHandlers(registry)

    expect(handlers.listModels()).toEqual([
      { provider: 'anthropic', providerName: 'Anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
      { provider: 'google', providerName: 'Google', id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
    ])
  })

  it('returns an empty list when no models are available', () => {
    const registry = { getAvailable: vi.fn(() => []), getProviderDisplayName: vi.fn() } as never
    const handlers = createModelsHandlers(registry)
    expect(handlers.listModels()).toEqual([])
  })
})
