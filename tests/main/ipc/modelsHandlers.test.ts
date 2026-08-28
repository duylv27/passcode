import { describe, it, expect, vi } from 'vitest'
import { createModelsHandlers } from '../../../src/main/ipc/modelsHandlers'

describe('modelsHandlers', () => {
  it('maps available models to id/name/provider info', () => {
    const registry = {
      getAvailable: vi.fn(() => [
        { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5', extra: 'ignored' },
        { provider: 'openai', id: 'gpt-5', name: 'GPT-5' }
      ])
    } as never

    const handlers = createModelsHandlers(registry)

    expect(handlers.listModels()).toEqual([
      { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
      { provider: 'openai', id: 'gpt-5', name: 'GPT-5' }
    ])
  })

  it('returns an empty list when no models are available', () => {
    const registry = { getAvailable: vi.fn(() => []) } as never
    const handlers = createModelsHandlers(registry)
    expect(handlers.listModels()).toEqual([])
  })
})
