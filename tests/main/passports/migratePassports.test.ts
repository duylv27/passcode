import { describe, it, expect, vi, beforeEach } from 'vitest'
import { migratePassportsFromLegacyAuth } from '../../../src/main/passports/migratePassports'
import type { PassportsRepository, CreatePassportInput } from '../../../src/main/db/passportsRepository'
import type { AppSettingsRepository } from '../../../src/main/db/appSettingsRepository'
import type { Passport } from '../../../src/shared/types'

function makeFakeRepo(): PassportsRepository & { rows: Passport[] } {
  const rows: Passport[] = []
  return {
    rows,
    create(input: CreatePassportInput): Passport {
      const passport: Passport = {
        id: `id-${rows.length + 1}`,
        providerId: input.providerId,
        authMethod: input.authMethod,
        displayName: input.displayName,
        isActive: true,
        apiKey: input.apiKey,
        status: 'unknown',
        lastValidatedAt: null,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalRequests: 0,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z'
      }
      rows.push(passport)
      return passport
    },
    list: () => [...rows],
    getById: (id) => rows.find((r) => r.id === id),
    setActive: () => {},
    rename: () => {},
    remove: () => {},
    updateStatus: () => {},
    recordUsageForActiveProvider: () => {}
  }
}

describe('migratePassportsFromLegacyAuth', () => {
  let passportsRepo: ReturnType<typeof makeFakeRepo>
  let appSettingsRepo: Pick<
    AppSettingsRepository,
    'getProviderApiKeys' | 'getPassportsMigrated' | 'setPassportsMigrated'
  >
  let migrated: boolean
  let checkAuth: ReturnType<typeof vi.fn>

  beforeEach(() => {
    passportsRepo = makeFakeRepo()
    migrated = false
    appSettingsRepo = {
      getProviderApiKeys: () => ({}),
      getPassportsMigrated: () => migrated,
      setPassportsMigrated: () => {
        migrated = true
      }
    }
    checkAuth = vi.fn(async () => undefined)
  })

  it('does nothing when already migrated', async () => {
    migrated = true
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123' })
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(0)
  })

  it('creates an api_key passport for each legacy provider API key', async () => {
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123', google: 'AIza-456' })
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(2)
    expect(passportsRepo.rows.find((r) => r.providerId === 'anthropic')).toMatchObject({
      authMethod: 'api_key',
      apiKey: 'sk-ant-123',
      displayName: 'Anthropic API Key'
    })
    expect(passportsRepo.rows.find((r) => r.providerId === 'google')).toMatchObject({
      authMethod: 'api_key',
      apiKey: 'AIza-456',
      displayName: 'Google API Key'
    })
  })

  it('creates an oauth passport for a provider with a live OAuth credential and no api key', async () => {
    checkAuth.mockImplementation(async (providerId: string) =>
      providerId === 'github-copilot' ? { type: 'oauth' as const } : undefined
    )
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(1)
    expect(passportsRepo.rows[0]).toMatchObject({
      providerId: 'github-copilot',
      authMethod: 'oauth',
      apiKey: null,
      displayName: 'GitHub Copilot'
    })
  })

  it('does not create an oauth passport for a provider that already got an api_key passport', async () => {
    appSettingsRepo.getProviderApiKeys = () => ({ anthropic: 'sk-ant-123' })
    checkAuth.mockImplementation(async (providerId: string) => (providerId === 'anthropic' ? { type: 'oauth' as const } : undefined))
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(passportsRepo.rows).toHaveLength(1)
    expect(passportsRepo.rows[0].authMethod).toBe('api_key')
  })

  it('marks migration complete even when there is nothing to migrate', async () => {
    await migratePassportsFromLegacyAuth({ appSettingsRepo, passportsRepo, checkAuth })
    expect(migrated).toBe(true)
  })
})
