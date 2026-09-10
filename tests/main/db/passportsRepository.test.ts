import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createPassportsRepository, type PassportsRepository } from '../../../src/main/db/passportsRepository'

describe('PassportsRepository', () => {
  let repo: PassportsRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    repo = createPassportsRepository(db)
  })

  it('creates an API-key passport with the key stored and totals at zero', () => {
    const passport = repo.create({
      providerId: 'anthropic',
      authMethod: 'api_key',
      displayName: 'Personal API Key',
      apiKey: 'sk-ant-test-123'
    })
    expect(passport).toMatchObject({
      providerId: 'anthropic',
      authMethod: 'api_key',
      displayName: 'Personal API Key',
      apiKey: 'sk-ant-test-123',
      isActive: true,
      status: 'unknown',
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      lastUsedAt: null
    })
  })

  it('creates an oauth passport with no stored credential', () => {
    const passport = repo.create({
      providerId: 'anthropic',
      authMethod: 'oauth',
      displayName: 'Claude Pro/Max',
      apiKey: null
    })
    expect(passport.apiKey).toBeNull()
    expect(passport.authMethod).toBe('oauth')
  })

  it('marks the first passport created for a provider as active', () => {
    const passport = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Key', apiKey: 'k' })
    expect(passport.isActive).toBe(true)
  })

  it('marks a second passport for the same provider as inactive', () => {
    repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'First', apiKey: 'k1' })
    const second = repo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Second', apiKey: null })
    expect(second.isActive).toBe(false)
  })

  it('lists passports across all providers', () => {
    repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.create({ providerId: 'google', authMethod: 'api_key', displayName: 'B', apiKey: 'k2' })
    expect(repo.list().map((p) => p.providerId).sort()).toEqual(['anthropic', 'google'])
  })

  it('gets a passport by id', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    expect(repo.getById(created.id)).toEqual(created)
  })

  it('returns undefined for an unknown id', () => {
    expect(repo.getById('nope')).toBeUndefined()
  })

  it('setActive flips isActive off the previously active passport and onto the target, for the same provider', () => {
    const first = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'First', apiKey: 'k1' })
    const second = repo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Second', apiKey: null })
    repo.setActive(second.id)
    expect(repo.getById(first.id)?.isActive).toBe(false)
    expect(repo.getById(second.id)?.isActive).toBe(true)
  })

  it('setActive does not affect a different provider\'s active passport', () => {
    const anthropic = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    const google = repo.create({ providerId: 'google', authMethod: 'api_key', displayName: 'G', apiKey: 'k2' })
    repo.setActive(google.id)
    expect(repo.getById(anthropic.id)?.isActive).toBe(true)
    expect(repo.getById(google.id)?.isActive).toBe(true)
  })

  it('renames a passport', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'k' })
    repo.rename(created.id, 'New Name')
    expect(repo.getById(created.id)?.displayName).toBe('New Name')
  })

  it('removes a passport', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.remove(created.id)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('updates status and lastValidatedAt', () => {
    const created = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.updateStatus(created.id, 'error')
    const updated = repo.getById(created.id)!
    expect(updated.status).toBe('error')
    expect(updated.lastValidatedAt).not.toBeNull()
  })

  it('recordUsageForActiveProvider accumulates tokens and requests on the active passport', () => {
    const passport = repo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    repo.recordUsageForActiveProvider('anthropic', { inputTokens: 100, outputTokens: 50 })
    repo.recordUsageForActiveProvider('anthropic', { inputTokens: 20, outputTokens: 10 })
    const updated = repo.getById(passport.id)!
    expect(updated.totalInputTokens).toBe(120)
    expect(updated.totalOutputTokens).toBe(60)
    expect(updated.totalRequests).toBe(2)
    expect(updated.lastUsedAt).not.toBeNull()
  })

  it('recordUsageForActiveProvider is a no-op when no passport is active for that provider', () => {
    expect(() => repo.recordUsageForActiveProvider('anthropic', { inputTokens: 1, outputTokens: 1 })).not.toThrow()
  })
})
