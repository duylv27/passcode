import { describe, it, expect, vi } from 'vitest'

const promptMock = vi.fn(async () => {})
const subscribeMock = vi.fn(() => () => {})
const abortMock = vi.fn(async () => {})
const createAgentSessionMock = vi.fn(async () => ({
  session: { prompt: promptMock, subscribe: subscribeMock, abort: abortMock, sessionId: 'pi-session-1' }
}))
const getAgentDirMock = vi.fn(() => '/fake/agent/dir')
let capturedResourceLoaderOptions: {
  cwd: string
  agentDir: string
  extensionFactories: Array<(pi: { on: (name: string, handler: (event: unknown) => unknown) => void }) => void>
}
const DefaultResourceLoaderMock = vi.fn(function (
  this: unknown,
  opts: typeof capturedResourceLoaderOptions
) {
  capturedResourceLoaderOptions = opts
})

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: createAgentSessionMock,
  DefaultResourceLoader: DefaultResourceLoaderMock,
  getAgentDir: getAgentDirMock
}))

import { createRepoSession } from '../../../src/main/agent/piSession'

function noApproval(): Promise<boolean> {
  return Promise.resolve(true)
}

describe('createRepoSession', () => {
  it('creates a session scoped to the repo cwd with the expected tools', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
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
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    const listener = vi.fn()
    repoSession.subscribe(listener)
    expect(subscribeMock).toHaveBeenCalledWith(listener)

    await repoSession.abort()
    expect(abortMock).toHaveBeenCalled()
  })

  it('registers a resource loader scoped to the repo cwd and the agent config dir', async () => {
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    expect(DefaultResourceLoaderMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/repo/path', agentDir: '/fake/agent/dir' })
    )
  })

  it("registers a tool_call handler that approves when requestApproval resolves true", async () => {
    const requestApproval = vi.fn(async () => true)
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval })

    const onHandlers: Record<string, (event: unknown) => unknown> = {}
    capturedResourceLoaderOptions.extensionFactories[0]({
      on: (name, handler) => {
        onHandlers[name] = handler
      }
    })

    const result = await onHandlers['tool_call']({ toolName: 'bash', input: { command: 'ls' } })

    expect(requestApproval).toHaveBeenCalledWith('bash', { command: 'ls' })
    expect(result).toEqual({ block: false })
  })

  it('registers a tool_call handler that blocks when requestApproval resolves false', async () => {
    const requestApproval = vi.fn(async () => false)
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval })

    const onHandlers: Record<string, (event: unknown) => unknown> = {}
    capturedResourceLoaderOptions.extensionFactories[0]({
      on: (name, handler) => {
        onHandlers[name] = handler
      }
    })

    const result = await onHandlers['tool_call']({ toolName: 'write', input: { path: 'x.txt' } })

    expect(result).toEqual({ block: true, reason: 'Denied by user' })
  })
})
