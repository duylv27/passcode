import { describe, it, expect, vi } from 'vitest'

const promptMock = vi.fn(async () => {})
const subscribeMock = vi.fn(() => () => {})
const abortMock = vi.fn(async () => {})
const createAgentSessionMock = vi.fn(async () => ({
  session: { prompt: promptMock, subscribe: subscribeMock, abort: abortMock }
}))

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock
}))

import { createRepoSession } from '../../../src/main/agent/piSession'

describe('createRepoSession', () => {
  it('creates a session scoped to the repo cwd with the expected tools', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never
    })

    expect(createAgentSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/repo/path',
        tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']
      })
    )

    await repoSession.prompt('hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
  })

  it('forwards subscribe and abort to the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never
    })

    const listener = vi.fn()
    repoSession.subscribe(listener)
    expect(subscribeMock).toHaveBeenCalledWith(listener)

    await repoSession.abort()
    expect(abortMock).toHaveBeenCalled()
  })
})
