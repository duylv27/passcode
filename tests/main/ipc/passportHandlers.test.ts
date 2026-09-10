import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPassportHandlers, type PassportHandlers } from '../../../src/main/ipc/passportHandlers'
import type { ModelRuntimeLike } from '../../../src/main/passports/authMethodHandlers'
import type { PassportsRepository, CreatePassportInput } from '../../../src/main/db/passportsRepository'
import type { Passport } from '../../../src/shared/types'

const { validateAnthropicApiKeyMock, validateGeminiApiKeyMock } = vi.hoisted(() => ({
  validateAnthropicApiKeyMock: vi.fn(async () => ({ ok: true as const })),
  validateGeminiApiKeyMock: vi.fn(async () => ({ ok: true as const }))
}))

vi.mock('../../../src/main/agent/providerValidation', () => ({
  validateAnthropicApiKey: validateAnthropicApiKeyMock,
  validateGeminiApiKey: validateGeminiApiKeyMock
}))

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
        isActive: !rows.some((r) => r.providerId === input.providerId),
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
    setActive: (id) => {
      const target = rows.find((r) => r.id === id)
      if (!target) return
      for (const r of rows) if (r.providerId === target.providerId) r.isActive = r.id === id
    },
    rename: (id, displayName) => {
      const target = rows.find((r) => r.id === id)
      if (target) target.displayName = displayName
    },
    remove: (id) => {
      const idx = rows.findIndex((r) => r.id === id)
      if (idx !== -1) rows.splice(idx, 1)
    },
    updateStatus: (id, status) => {
      const target = rows.find((r) => r.id === id)
      if (target) target.status = status
    },
    recordUsageForActiveProvider: () => {}
  }
}

describe('passportHandlers', () => {
  let passportsRepo: ReturnType<typeof makeFakeRepo>
  let modelRuntime: ModelRuntimeLike & { login: ReturnType<typeof vi.fn> }
  let openExternal: ReturnType<typeof vi.fn>
  let refreshModels: ReturnType<typeof vi.fn>
  let handlers: PassportHandlers

  beforeEach(() => {
    passportsRepo = makeFakeRepo()
    validateAnthropicApiKeyMock.mockReset().mockResolvedValue({ ok: true })
    validateGeminiApiKeyMock.mockReset().mockResolvedValue({ ok: true })
    modelRuntime = {
      setRuntimeApiKey: vi.fn(async () => {}),
      removeRuntimeApiKey: vi.fn(async () => {}),
      checkAuth: vi.fn(async () => undefined),
      login: vi.fn(async () => ({ type: 'oauth', refresh: '', access: '', expires: 0 }) as never)
    }
    openExternal = vi.fn()
    refreshModels = vi.fn(async () => {})
    handlers = createPassportHandlers(passportsRepo, modelRuntime, openExternal, refreshModels)
  })

  it('lists passports from the repository', () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    expect(handlers.listPassports()).toHaveLength(1)
  })

  it('creates a valid API-key passport, activating it on the runtime', async () => {
    const result = await handlers.createApiKeyPassport('anthropic', 'My Key', 'sk-ant-123')
    expect(result.ok).toBe(true)
    expect(validateAnthropicApiKeyMock).toHaveBeenCalledWith('sk-ant-123')
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-123')
    if (result.ok) expect(result.passport.displayName).toBe('My Key')
    expect(refreshModels).toHaveBeenCalled()
  })

  it('rejects an API key that fails live validation, without creating a passport', async () => {
    validateAnthropicApiKeyMock.mockResolvedValue({ ok: false, error: 'Anthropic rejected this key' })
    const result = await handlers.createApiKeyPassport('anthropic', 'Bad Key', 'sk-bad')
    expect(result).toEqual({ ok: false, error: 'Anthropic rejected this key' })
    expect(passportsRepo.rows).toHaveLength(0)
  })

  it('rejects an empty API key', async () => {
    const result = await handlers.createApiKeyPassport('anthropic', 'Empty', '   ')
    expect(result).toEqual({ ok: false, error: 'API key must not be empty' })
    expect(validateAnthropicApiKeyMock).not.toHaveBeenCalled()
  })

  it('validates google keys with validateGeminiApiKey', async () => {
    await handlers.createApiKeyPassport('google', 'My Gemini Key', 'AIza-123')
    expect(validateGeminiApiKeyMock).toHaveBeenCalledWith('AIza-123')
  })

  it('deactivates the previously active passport for the provider before activating a new API-key passport', async () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Old OAuth', apiKey: null })
    await handlers.createApiKeyPassport('anthropic', 'New Key', 'sk-ant-999')
    // The old oauth passport is no longer active; deactivating it is a
    // no-op on the runtime (oauthAuthMethodHandler), but setRuntimeApiKey
    // for the new one must still have been called.
    expect(passportsRepo.rows.find((r) => r.displayName === 'Old OAuth')?.isActive).toBe(false)
    expect(modelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('anthropic', 'sk-ant-999')
  })

  it('creates an oauth passport via the browser flow and opens the URL', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (e: unknown) => void }) => {
        interaction.notify({ type: 'auth_url', url: 'https://claude.ai/oauth/authorize?x=1', instructions: 'go' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const prompts: unknown[] = []
    const result = await handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', (p) => prompts.push(p))
    expect(result.ok).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?x=1')
    expect(prompts).toEqual([{ kind: 'browser', url: 'https://claude.ai/oauth/authorize?x=1', instructions: 'go' }])
    if (result.ok) expect(result.passport.apiKey).toBeNull()
    expect(refreshModels).toHaveBeenCalled()
  })

  it('removes the passport row if activation fails after an oauth login succeeds', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (e: unknown) => void }) => {
        interaction.notify({ type: 'auth_url', url: 'https://claude.ai/oauth/authorize?x=1', instructions: 'go' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    passportsRepo.setActive = () => {
      throw new Error('activation failed')
    }
    const result = await handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    expect(result).toEqual({ ok: false, error: 'activation failed' })
    expect(passportsRepo.rows).toHaveLength(0)
    expect(refreshModels).not.toHaveBeenCalled()
  })

  it('creates an oauth passport via the device-code flow without opening a browser itself', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { notify: (e: unknown) => void }) => {
        interaction.notify({ type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const prompts: unknown[] = []
    const result = await handlers.createOAuthPassport('github-copilot', 'Copilot', (p) => prompts.push(p))
    expect(result.ok).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
    expect(prompts).toEqual([{ kind: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' }])
  })

  it('answers a text prompt during oauth login automatically', async () => {
    let prompted: string | undefined
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        prompted = await interaction.prompt({ type: 'text' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    await handlers.createOAuthPassport('github-copilot', 'Copilot', () => {})
    expect(prompted).toBe('')
  })

  it('answers a select prompt during oauth login with the first option (e.g. OpenAI Codex\'s browser-vs-device-code choice)', async () => {
    let selected: string | undefined
    modelRuntime.login.mockImplementationOnce(
      async (
        _providerId: string,
        _type: string,
        interaction: {
          prompt: (p: {
            type: string
            options?: readonly { id: string; label: string }[]
          }) => Promise<string>
        }
      ) => {
        selected = await interaction.prompt({
          type: 'select',
          options: [
            { id: 'browser', label: 'Browser login (default)' },
            { id: 'device_code', label: 'Device code login (headless)' }
          ]
        })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    await handlers.createOAuthPassport('openai-codex', 'ChatGPT', () => {})
    expect(selected).toBe('browser')
  })

  it('resolves a pending manual_code prompt via submitOAuthCode', async () => {
    let resolvedCode: string | undefined
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        resolvedCode = await interaction.prompt({ type: 'manual_code' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const promise = handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    // Give the mocked login() a tick to reach its prompt() call before we submit.
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.submitOAuthCode('the-pasted-code')
    await promise
    expect(resolvedCode).toBe('the-pasted-code')
  })

  it('rejects the pending manual_code prompt via cancelOAuth', async () => {
    modelRuntime.login.mockImplementationOnce(
      async (_providerId: string, _type: string, interaction: { prompt: (p: { type: string }) => Promise<string> }) => {
        await interaction.prompt({ type: 'manual_code' })
        return { type: 'oauth', refresh: '', access: '', expires: 0 }
      }
    )
    const promise = handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    handlers.cancelOAuth()
    const result = await promise
    expect(result).toEqual({ ok: false, error: 'Sign-in cancelled' })
  })

  it('reports a failed oauth login', async () => {
    modelRuntime.login.mockRejectedValueOnce(new Error('user cancelled'))
    const result = await handlers.createOAuthPassport('anthropic', 'Claude Pro/Max', () => {})
    expect(result).toEqual({ ok: false, error: 'user cancelled' })
  })

  it('setActivePassport activates the target on the runtime and deactivates the previous one', async () => {
    const oldKey = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'old' })
    const oauth = passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'New', apiKey: null })
    await handlers.setActivePassport(oauth.id)
    expect(modelRuntime.removeRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(passportsRepo.getById(oldKey.id)?.isActive).toBe(false)
    expect(passportsRepo.getById(oauth.id)?.isActive).toBe(true)
    expect(refreshModels).toHaveBeenCalled()
  })

  it('renamePassport delegates to the repository', () => {
    const passport = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Old', apiKey: 'k' })
    handlers.renamePassport(passport.id, 'New Name')
    expect(passportsRepo.getById(passport.id)?.displayName).toBe('New Name')
  })

  it('removePassport deactivates an active passport on the runtime before deleting it', async () => {
    const passport = passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'A', apiKey: 'k' })
    await handlers.removePassport(passport.id)
    expect(modelRuntime.removeRuntimeApiKey).toHaveBeenCalledWith('anthropic')
    expect(passportsRepo.getById(passport.id)).toBeUndefined()
    expect(refreshModels).toHaveBeenCalled()
  })

  it('removePassport does not touch the runtime for an inactive passport', async () => {
    passportsRepo.create({ providerId: 'anthropic', authMethod: 'api_key', displayName: 'Active', apiKey: 'k' })
    const inactive = passportsRepo.create({ providerId: 'anthropic', authMethod: 'oauth', displayName: 'Inactive', apiKey: null })
    await handlers.removePassport(inactive.id)
    expect(modelRuntime.removeRuntimeApiKey).not.toHaveBeenCalled()
    expect(passportsRepo.getById(inactive.id)).toBeUndefined()
    expect(refreshModels).not.toHaveBeenCalled()
  })
})
