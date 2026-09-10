import type { AuthCheck, AuthInteraction, AuthType, Credential } from '@earendil-works/pi-ai'
import { fetchCopilotQuota } from '../agent/copilotQuota'
import { validateAnthropicApiKey, validateGeminiApiKey } from '../agent/providerValidation'
import { probeUsageTelemetryPath } from '../agent/usageTelemetry'
import type { AppSettingsRepository } from '../db/appSettingsRepository'
import type {
  AnthropicOAuthPrompt,
  AuthStatus,
  CopilotQuota,
  DeviceCodeChallenge,
  UsageTelemetryConfig
} from '../../shared/types'

export interface ModelRuntimeLike {
  setRuntimeApiKey(providerId: string, apiKey: string): Promise<void>
  checkAuth(providerId: string): Promise<AuthCheck | undefined>
  login(providerId: string, type: AuthType, interaction: AuthInteraction): Promise<Credential>
}

export interface SettingsHandlers {
  setAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  setGeminiApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }>
  getAuthStatus(): Promise<AuthStatus>
  loginCopilot(
    onChallenge: (challenge: DeviceCodeChallenge) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
  getCopilotQuota(): Promise<CopilotQuota | null>
  /** Signs in with a Claude Pro/Max subscription (OAuth) instead of a
   * pasted API key. */
  loginAnthropicOAuth(
    onPrompt: (prompt: AnthropicOAuthPrompt) => void
  ): Promise<{ ok: true } | { ok: false; error: string }>
  submitAnthropicOAuthCode(code: string): void
  cancelAnthropicOAuth(): void
  getUsageTelemetryConfig(): Promise<UsageTelemetryConfig>
  setUsageTelemetryConfig(config: UsageTelemetryConfig): Promise<{ ok: true } | { ok: false; error: string }>
}

export function createSettingsHandlers(
  modelRuntime: ModelRuntimeLike,
  appSettingsRepo: AppSettingsRepository,
  openExternal: (url: string) => void
): SettingsHandlers {
  // Set only while a manual_code prompt from the Anthropic OAuth flow is
  // pending -- resolved by submitAnthropicOAuthCode() once the user pastes
  // something back, or rejected by cancelAnthropicOAuth()/the flow's own
  // abort signal firing first (e.g. the browser redirect won the race, so
  // the manual fallback is no longer needed).
  let pendingAnthropicCode: { resolve: (code: string) => void; reject: (err: Error) => void } | null = null

  return {
    async setAnthropicApiKey(apiKey: string) {
      const trimmed = apiKey.trim()
      if (!trimmed) return { ok: false, error: 'API key must not be empty' }
      // Validate against the real API before persisting -- checkAuth() alone
      // only confirms a key is stored for this provider, not that it works,
      // since Anthropic's provider definition has no auth.apiKey.check hook.
      const validation = await validateAnthropicApiKey(trimmed)
      if (!validation.ok) return validation
      try {
        await modelRuntime.setRuntimeApiKey('anthropic', trimmed)
        // setRuntimeApiKey() is in-memory only (see appSettingsRepository.ts) --
        // persist it ourselves so it survives a restart, replayed in
        // main/index.ts on the next launch.
        appSettingsRepo.setProviderApiKey('anthropic', trimmed)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async setGeminiApiKey(apiKey: string) {
      const trimmed = apiKey.trim()
      if (!trimmed) return { ok: false, error: 'API key must not be empty' }
      const validation = await validateGeminiApiKey(trimmed)
      if (!validation.ok) return validation
      try {
        await modelRuntime.setRuntimeApiKey('google', trimmed)
        appSettingsRepo.setProviderApiKey('google', trimmed)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async getAuthStatus() {
      const [anthropic, copilot, gemini] = await Promise.all([
        modelRuntime.checkAuth('anthropic'),
        modelRuntime.checkAuth('github-copilot'),
        modelRuntime.checkAuth('google')
      ])
      return { anthropic: anthropic !== undefined, copilot: copilot !== undefined, gemini: gemini !== undefined }
    },
    async loginCopilot(onChallenge) {
      try {
        await modelRuntime.login('github-copilot', 'oauth', {
          notify: (event) => {
            if (event.type === 'device_code') {
              onChallenge({ userCode: event.userCode, verificationUri: event.verificationUri })
            }
          },
          prompt: async (prompt) => {
            // GitHub Copilot's real login flow asks a "text" prompt for an
            // optional GitHub Enterprise domain before it ever reaches the
            // device-code step. Blank means "use github.com" — the vast
            // majority case, and the only one we have no UI for yet, so we
            // answer it automatically instead of blocking the flow.
            if (prompt.type === 'text') return ''
            throw new Error(`Interactive login prompt of type "${prompt.type}" is not supported yet`)
          }
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },
    async getCopilotQuota() {
      return fetchCopilotQuota()
    },
    async loginAnthropicOAuth(onPrompt) {
      try {
        await modelRuntime.login('anthropic', 'oauth', {
          notify: (event) => {
            if (event.type === 'auth_url') {
              openExternal(event.url)
              onPrompt({ url: event.url, instructions: event.instructions })
            }
          },
          prompt: (prompt) => {
            if (prompt.type !== 'manual_code') {
              return Promise.reject(new Error(`Interactive login prompt of type "${prompt.type}" is not supported yet`))
            }
            return new Promise<string>((resolve, reject) => {
              pendingAnthropicCode = { resolve, reject }
              // Fires once the flow's own callback server already won the
              // race (the browser redirected successfully) -- this manual
              // fallback is no longer needed, so reject quietly rather than
              // leave it dangling.
              prompt.signal?.addEventListener(
                'abort',
                () => {
                  pendingAnthropicCode = null
                  reject(new Error('Sign-in completed another way'))
                },
                { once: true }
              )
            })
          }
        })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      } finally {
        pendingAnthropicCode = null
      }
    },
    submitAnthropicOAuthCode(code) {
      if (!pendingAnthropicCode) return
      pendingAnthropicCode.resolve(code)
      pendingAnthropicCode = null
    },
    cancelAnthropicOAuth() {
      if (!pendingAnthropicCode) return
      pendingAnthropicCode.reject(new Error('Sign-in cancelled'))
      pendingAnthropicCode = null
    },
    async getUsageTelemetryConfig() {
      return appSettingsRepo.getUsageTelemetryConfig()
    },
    async setUsageTelemetryConfig(config: UsageTelemetryConfig) {
      // Persist regardless of probe outcome -- a bad path shouldn't lose
      // the user's toggle/path input, it should just surface an error so
      // they can fix it without re-entering everything.
      const probeResult = await probeUsageTelemetryPath(config)
      appSettingsRepo.setUsageTelemetryConfig(config)
      return probeResult
    }
  }
}
