import type { AuthType, Credential } from '@earendil-works/pi-ai'
import { validateAnthropicApiKey, validateGeminiApiKey } from '../agent/providerValidation'
import { getAuthMethodHandler, type ModelRuntimeLike } from '../passports/authMethodHandlers'
import type { PassportsRepository } from '../db/passportsRepository'
import type { Passport, PassportOAuthPrompt } from '../../shared/types'

export interface PassportModelRuntimeLike extends ModelRuntimeLike {
  login(
    providerId: string,
    type: AuthType,
    interaction: {
      notify: (event: unknown) => void
      prompt: (prompt: { type: string; signal?: AbortSignal }) => Promise<string>
    }
  ): Promise<Credential>
}

export interface PassportHandlers {
  listPassports(): Passport[]
  createApiKeyPassport(
    providerId: string,
    displayName: string,
    apiKey: string
  ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
  createOAuthPassport(
    providerId: string,
    displayName: string,
    onPrompt: (prompt: PassportOAuthPrompt) => void
  ): Promise<{ ok: true; passport: Passport } | { ok: false; error: string }>
  submitOAuthCode(code: string): void
  cancelOAuth(): void
  setActivePassport(id: string): Promise<void>
  renamePassport(id: string, displayName: string): void
  removePassport(id: string): Promise<void>
}

async function validateApiKey(
  providerId: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (providerId === 'anthropic') return validateAnthropicApiKey(apiKey)
  if (providerId === 'google') return validateGeminiApiKey(apiKey)
  return { ok: true }
}

export function createPassportHandlers(
  passportsRepo: PassportsRepository,
  modelRuntime: PassportModelRuntimeLike,
  openExternal: (url: string) => void
): PassportHandlers {
  // Set only while a manual_code prompt from an OAuth flow (Anthropic's
  // browser fallback) is pending -- resolved by submitOAuthCode() once the
  // user pastes something back, or rejected by cancelOAuth()/the flow's own
  // abort signal firing first (the browser redirect already won the race).
  let pendingCode: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null

  async function activatePassport(passport: Passport): Promise<void> {
    const previous = passportsRepo.list().find((p) => p.providerId === passport.providerId && p.isActive)
    if (previous && previous.id !== passport.id) {
      await getAuthMethodHandler(previous.authMethod).deactivate(previous, modelRuntime)
    }
    await getAuthMethodHandler(passport.authMethod).activate(passport, modelRuntime)
    passportsRepo.setActive(passport.id)
  }

  return {
    listPassports(): Passport[] {
      return passportsRepo.list()
    },
    async createApiKeyPassport(providerId, displayName, apiKey) {
      const trimmed = apiKey.trim()
      if (!trimmed) return { ok: false, error: 'API key must not be empty' }
      const validation = await validateApiKey(providerId, trimmed)
      if (!validation.ok) return validation
      const passport = passportsRepo.create({ providerId, authMethod: 'api_key', displayName, apiKey: trimmed })
      try {
        await activatePassport(passport)
      } catch (err) {
        passportsRepo.remove(passport.id)
        return { ok: false, error: (err as Error).message }
      }
      return { ok: true, passport: passportsRepo.getById(passport.id)! }
    },
    async createOAuthPassport(providerId, displayName, onPrompt) {
      let passport: Passport | undefined
      try {
        await modelRuntime.login(providerId, 'oauth', {
          notify: (event) => {
            const e = event as { type?: string; url?: string; instructions?: string; userCode?: string; verificationUri?: string }
            if (e.type === 'auth_url' && e.url) {
              openExternal(e.url)
              onPrompt({ kind: 'browser', url: e.url, instructions: e.instructions })
            } else if (e.type === 'device_code' && e.userCode && e.verificationUri) {
              onPrompt({ kind: 'device_code', userCode: e.userCode, verificationUri: e.verificationUri })
            }
          },
          prompt: (prompt) => {
            // A GitHub Enterprise-domain prompt (Copilot) or any other
            // plain text prompt: blank means "use the default", the only
            // case we have UI for.
            if (prompt.type === 'text') return Promise.resolve('')
            if (prompt.type === 'manual_code') {
              return new Promise<string>((resolve, reject) => {
                pendingCode = { resolve, reject }
                prompt.signal?.addEventListener(
                  'abort',
                  () => {
                    pendingCode = null
                    reject(new Error('Sign-in completed another way'))
                  },
                  { once: true }
                )
              })
            }
            return Promise.reject(new Error(`Interactive login prompt of type "${prompt.type}" is not supported yet`))
          }
        })
        passport = passportsRepo.create({ providerId, authMethod: 'oauth', displayName, apiKey: null })
        await activatePassport(passport)
        return { ok: true, passport: passportsRepo.getById(passport.id)! }
      } catch (err) {
        if (passport) passportsRepo.remove(passport.id)
        return { ok: false, error: (err as Error).message }
      } finally {
        pendingCode = null
      }
    },
    submitOAuthCode(code) {
      if (!pendingCode) return
      pendingCode.resolve(code)
      pendingCode = null
    },
    cancelOAuth() {
      if (!pendingCode) return
      pendingCode.reject(new Error('Sign-in cancelled'))
      pendingCode = null
    },
    async setActivePassport(id) {
      const passport = passportsRepo.getById(id)
      if (!passport) return
      await activatePassport(passport)
    },
    renamePassport(id, displayName) {
      passportsRepo.rename(id, displayName)
    },
    async removePassport(id) {
      const passport = passportsRepo.getById(id)
      if (!passport) return
      if (passport.isActive) {
        await getAuthMethodHandler(passport.authMethod).deactivate(passport, modelRuntime)
      }
      passportsRepo.remove(id)
    }
  }
}
