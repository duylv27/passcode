import type { AuthCheck } from '@earendil-works/pi-ai'
import type { Passport, PassportAuthMethod, PassportStatus } from '../../shared/types'

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>
  removeRuntimeApiKey(providerId: string): Promise<void>
  checkAuth(providerId: string): Promise<AuthCheck | undefined>
}

/** One implementation per auth METHOD, not per provider -- every method
 * here takes providerId as plain data from the passport and never branches
 * on it, which is what makes a fifth provider free as long as it uses
 * 'api_key' or 'oauth'. See docs/superpowers/specs/2026-09-10-passports-design.md. */
export interface AuthMethodHandler {
  activate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  deactivate(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<void>
  checkStatus(passport: Passport, modelRuntime: ModelRuntimeLike): Promise<PassportStatus>
}

export const apiKeyAuthMethodHandler: AuthMethodHandler = {
  async activate(passport, modelRuntime) {
    if (!passport.apiKey) throw new Error(`Passport ${passport.id} has no stored API key`)
    await modelRuntime.setRuntimeApiKey(passport.providerId, passport.apiKey)
  },
  async deactivate(passport, modelRuntime) {
    await modelRuntime.removeRuntimeApiKey(passport.providerId)
  },
  async checkStatus(passport, modelRuntime) {
    const auth = await modelRuntime.checkAuth(passport.providerId)
    return auth !== undefined ? 'connected' : 'error'
  }
}

export const oauthAuthMethodHandler: AuthMethodHandler = {
  // The real login()/logout() calls already ran once during creation/removal
  // (see passportHandlers.ts) -- switching which OAuth passport is
  // "active" is bookkeeping only, since the SDK's own credential store
  // holds at most one OAuth credential per provider regardless.
  async activate() {},
  async deactivate() {},
  async checkStatus(passport, modelRuntime) {
    const auth = await modelRuntime.checkAuth(passport.providerId)
    return auth !== undefined ? 'connected' : 'error'
  }
}

export function getAuthMethodHandler(method: PassportAuthMethod): AuthMethodHandler {
  return method === 'api_key' ? apiKeyAuthMethodHandler : oauthAuthMethodHandler
}
