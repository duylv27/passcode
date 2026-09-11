import type { Model } from '@earendil-works/pi-ai'
import type { ModelInfo } from '../../shared/types'

export interface ModelRegistryLike {
  getAvailable(): Model<any>[]
  getProviderDisplayName(provider: string): string
}

export interface ModelsHandlers {
  listModels(): ModelInfo[]
  /** Drop the cached list so the next listModels() call recomputes it --
   * call after anything that can change availability (a Passport
   * activated/switched/removed) so a short cache TTL never serves a stale
   * list right after a real change. */
  invalidate(): void
}

// getAvailable() itself is a cheap in-memory snapshot read, but this app can
// have many ChatPanel instances (one per open session) mounting at once and
// each calls listModels() on mount plus on every modelsRefreshKey bump --
// a short TTL collapses that burst into one real computation instead of
// repeating the same map() over the same snapshot for every session.
const CACHE_TTL_MS = 5 * 60_000

export function createModelsHandlers(registry: ModelRegistryLike): ModelsHandlers {
  let cache: { at: number; models: ModelInfo[] } | null = null
  return {
    listModels() {
      if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.models
      const models = registry.getAvailable().map((model) => ({
        provider: model.provider,
        providerName: registry.getProviderDisplayName(model.provider),
        id: model.id,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite
        }
      }))
      cache = { at: Date.now(), models }
      return models
    },
    invalidate() {
      cache = null
    }
  }
}
