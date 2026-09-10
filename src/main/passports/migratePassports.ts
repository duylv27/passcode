import type { AuthCheck } from '@earendil-works/pi-ai'
import type { PassportsRepository } from '../db/passportsRepository'
import type { AppSettingsRepository } from '../db/appSettingsRepository'

const KNOWN_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  'github-copilot': 'GitHub Copilot'
}

function displayNameFor(providerId: string, suffix: string): string {
  const provider = KNOWN_PROVIDER_DISPLAY_NAMES[providerId] ?? providerId
  return suffix ? `${provider} ${suffix}` : provider
}

export interface MigratePassportsDeps {
  appSettingsRepo: Pick<AppSettingsRepository, 'getProviderApiKeys' | 'getPassportsMigrated' | 'setPassportsMigrated'>
  passportsRepo: PassportsRepository
  checkAuth: (providerId: string) => Promise<AuthCheck | undefined>
}

/** One-time, idempotent copy of every credential PassCode already knew
 * about before Passports existed into real `passports` rows: each legacy
 * providerApiKeys entry becomes an api_key Passport, and any provider with
 * a live OAuth credential (Copilot's device sign-in, or a prior Anthropic
 * OAuth login) but no API key becomes an oauth Passport. Never deletes the
 * underlying credential -- only ever adds rows. Gated by a persisted flag
 * so it runs at most once, regardless of how many providers it finds. */
export async function migratePassportsFromLegacyAuth(deps: MigratePassportsDeps): Promise<void> {
  if (deps.appSettingsRepo.getPassportsMigrated()) return

  const legacyApiKeys = deps.appSettingsRepo.getProviderApiKeys()
  const migratedProviders = new Set<string>()

  for (const [providerId, apiKey] of Object.entries(legacyApiKeys)) {
    deps.passportsRepo.create({
      providerId,
      authMethod: 'api_key',
      displayName: displayNameFor(providerId, 'API Key'),
      apiKey
    })
    migratedProviders.add(providerId)
  }

  const candidateOAuthProviders = ['anthropic', 'google', 'github-copilot']
  for (const providerId of candidateOAuthProviders) {
    if (migratedProviders.has(providerId)) continue
    const auth = await deps.checkAuth(providerId)
    if (auth?.type === 'oauth') {
      deps.passportsRepo.create({
        providerId,
        authMethod: 'oauth',
        displayName: displayNameFor(providerId, ''),
        apiKey: null
      })
    }
  }

  deps.appSettingsRepo.setPassportsMigrated()
}
