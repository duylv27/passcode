import type { AuthCheck, AuthInteraction, AuthType, Credential } from '@earendil-works/pi-ai'
import type { AuthStatus, DeviceCodeChallenge } from '../../shared/types'

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>
  checkAuth(providerId: string): Promise<AuthCheck | undefined>
  login(providerId: string, type: AuthType, interaction: AuthInteraction): Promise<Credential>
}

export interface SettingsHandlers {
  setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  getAuthStatus(): Promise<AuthStatus>
  loginCopilot(
    onChallenge: (challenge: DeviceCodeChallenge) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
}

export function createSettingsHandlers(modelRuntime: ModelRuntimeLike): SettingsHandlers {
  return {
    async setAnthropicApiKey(apiKey: string) {
      if (!apiKey.trim()) return { ok: false, error: 'API key must not be empty' }
      try {
        await modelRuntime.setRuntimeApiKey('anthropic', apiKey.trim())
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async getAuthStatus() {
      const [anthropic, copilot] = await Promise.all([
        modelRuntime.checkAuth('anthropic'),
        modelRuntime.checkAuth('github-copilot')
      ])
      return { anthropic: anthropic !== undefined, copilot: copilot !== undefined }
    },
    async loginCopilot(onChallenge) {
      try {
        await modelRuntime.login('github-copilot', 'oauth', {
          notify: (event) => {
            if (event.type === 'device_code') {
              onChallenge({ userCode: event.userCode, verificationUri: event.verificationUri })
            }
          },
          prompt: () => Promise.reject(new Error('Interactive login prompts are not supported yet'))
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  }
}
