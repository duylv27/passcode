import { describe, it, expect, vi, beforeEach } from 'vitest'

const promptMock = vi.fn(async () => {})
const subscribeMock = vi.fn(() => () => {})
const abortMock = vi.fn(async () => {})
const setModelMock = vi.fn(async () => {})
const getSessionFileMock = vi.fn(() => '/fake/agent/sessions/repo/abc.jsonl')
let mockMessages: unknown[] = []
let mockModel: unknown = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }
const createAgentSessionMock = vi.fn(async () => ({
  session: {
    prompt: promptMock,
    subscribe: subscribeMock,
    abort: abortMock,
    sessionId: 'pi-session-1',
    sessionManager: { getSessionFile: getSessionFileMock },
    agent: { state: { get messages() { return mockMessages } } },
    get model() { return mockModel },
    setModel: setModelMock
  }
}))
const getAgentDirMock = vi.fn(() => '/fake/agent/dir')
const sessionManagerOpenMock = vi.fn((path: string) => ({ __opened: path }))
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
  getAgentDir: getAgentDirMock,
  SessionManager: { open: sessionManagerOpenMock }
}))

import { createRepoSession } from '../../../src/main/agent/piSession'

function noApproval(): Promise<boolean> {
  return Promise.resolve(true)
}

describe('createRepoSession', () => {
  beforeEach(() => {
    mockMessages = []
    mockModel = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }
  })

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
    expect(promptMock).toHaveBeenCalledWith('hello', { streamingBehavior: 'steer' })
  })

  it('forwards images to the underlying session alongside the steer behavior', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }]

    await repoSession.prompt('what is in this screenshot?', images)

    expect(promptMock).toHaveBeenCalledWith('what is in this screenshot?', {
      images,
      streamingBehavior: 'steer'
    })
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

  it('returns the underlying session file so the caller can persist it for later resume', async () => {
    const { sessionFile } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(sessionFile).toBe('/fake/agent/sessions/repo/abc.jsonl')
  })

  it('does not pass a sessionManager to createAgentSession when not resuming', async () => {
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })
    const call = createAgentSessionMock.mock.calls[createAgentSessionMock.mock.calls.length - 1][0]
    expect(call).not.toHaveProperty('sessionManager')
  })

  it('opens the saved session file via SessionManager.open when resuming', async () => {
    await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval,
      resumeSessionFile: '/fake/agent/sessions/repo/abc.jsonl'
    })

    expect(sessionManagerOpenMock).toHaveBeenCalledWith('/fake/agent/sessions/repo/abc.jsonl')
    const call = createAgentSessionMock.mock.calls[createAgentSessionMock.mock.calls.length - 1][0]
    expect(call.sessionManager).toEqual({ __opened: '/fake/agent/sessions/repo/abc.jsonl' })
  })

  it('returns an empty history for a brand-new session', async () => {
    mockMessages = []
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getHistory()).toEqual([])
  })

  it('reconstructs user text, assistant text, and completed tool calls from history', async () => {
    mockMessages = [
      { role: 'user', content: 'add a health check' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll run the tests first." },
          { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'npm test' } }
        ]
      },
      { role: 'toolResult', toolCallId: 'call-1', isError: false, content: [{ type: 'text', text: '32 passed' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Tests pass.' }] }
    ]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([
      { kind: 'user', text: 'add a health check' },
      { kind: 'text', text: "I'll run the tests first." },
      {
        kind: 'tool',
        toolCallId: 'call-1',
        toolName: 'bash',
        input: { command: 'npm test' },
        result: '32 passed',
        isError: false
      },
      { kind: 'text', text: 'Tests pass.' }
    ])
  })

  it('reconstructs a pasted image alongside user text', async () => {
    mockMessages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this screenshot?' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
        ]
      }
    ]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([
      {
        kind: 'user',
        text: 'what is in this screenshot?',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }]
      }
    ])
  })

  it('omits the images field for a plain-text user turn', async () => {
    mockMessages = [{ role: 'user', content: 'add a health check' }]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([{ kind: 'user', text: 'add a health check' }])
  })

  it('shows only the label for a user turn that injected skill/attachment context, not the full injected text', async () => {
    mockMessages = [
      {
        role: 'user',
        content:
          '/reviewer look at this diff\n\n<<<pi-agent-context>>>\n\nUse the "reviewer" skill for this request. Its full instructions:\n\nCheck for bugs.\n\n---\n\nlook at this diff'
      }
    ]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([{ kind: 'user', text: '/reviewer look at this diff' }])
  })

  it('reconstructs thinking content alongside text and tool calls', async () => {
    mockMessages = [
      { role: 'user', content: 'why is this failing' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me check the stack trace first.' },
          { type: 'text', text: 'It looks like a null pointer.' }
        ]
      }
    ]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([
      { kind: 'user', text: 'why is this failing' },
      { kind: 'thinking', text: 'Let me check the stack trace first.' },
      { kind: 'text', text: 'It looks like a null pointer.' }
    ])
  })

  it('exposes the current model from the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getModel()).toEqual({
      provider: 'anthropic',
      id: 'claude-opus-4-5',
      name: 'Claude Opus 4.5'
    })
  })

  it('forwards setModel to the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    const model = { provider: 'openai', id: 'gpt-5', name: 'GPT-5' } as never
    await repoSession.setModel(model)
    expect(setModelMock).toHaveBeenCalledWith(model)
  })
})
