import type { Model } from '@earendil-works/pi-ai'
import type { ModelInfo } from '../../shared/types'

export interface ModelRegistryLike {
  getAvailable(): Model<any>[]
  getProviderDisplayName(provider: string): string
}

export interface ModelsHandlers {
  listModels(): ModelInfo[]
}

export function createModelsHandlers(registry: ModelRegistryLike): ModelsHandlers {
  return {
    listModels() {
      return registry.getAvailable().map((model) => ({
        provider: model.provider,
        providerName: registry.getProviderDisplayName(model.provider),
        id: model.id,
        name: model.name
      }))
    }
  }
}
