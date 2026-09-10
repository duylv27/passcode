import { describe, it, expect, vi, beforeEach } from 'vitest'

const promptMock = vi.fn(async () => {})
const subscribeMock = vi.fn(() => () => {})
const abortMock = vi.fn(async () => {})
const setModelMock = vi.fn(async () => {})
const getSessionFileMock = vi.fn(() => '/fake/agent/sessions/repo/abc.jsonl')
let mockMessages: unknown[] = []
let mockModel: unknown = { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }
const getContextUsageMock = vi.fn(() => ({ tokens: 12345, contextWindow: 200000, percent: 6.17 }))
const compactMock = vi.fn(async () => ({}))
const bindExtensionsMock = vi.fn(async () => {})
const getAllToolsMock = vi.fn(() => [
  { name: 'read', description: '' },
  { name: 'bash', description: '' },
  { name: 'edit', description: '' },
  { name: 'write', description: '' },
  { name: 'grep', description: '' },
  { name: 'find', description: '' },
  { name: 'ls', description: '' }
])
const setActiveToolsByNameMock = vi.fn()
const setAutoCompactionEnabledMock = vi.fn()
let mockAutoCompactionEnabled = true
const getCompactionReserveTokensMock = vi.fn(() => 16384)
const getCompactionKeepRecentTokensMock = vi.fn(() => 20000)
const createAgentSessionMock = vi.fn(async () => ({
  session: {
    prompt: promptMock,
    subscribe: subscribeMock,
    abort: abortMock,
    sessionId: 'pi-session-1',
    sessionManager: { getSessionFile: getSessionFileMock },
    agent: { state: { get messages() { return mockMessages } } },
    get model() { return mockModel },
    setModel: setModelMock,
    getContextUsage: getContextUsageMock,
    compact: compactMock,
    bindExtensions: bindExtensionsMock,
    getAllTools: getAllToolsMock,
    setActiveToolsByName: setActiveToolsByNameMock,
    get autoCompactionEnabled() { return mockAutoCompactionEnabled },
    setAutoCompactionEnabled: setAutoCompactionEnabledMock,
    settingsManager: {
      getCompactionReserveTokens: getCompactionReserveTokensMock,
      getCompactionKeepRecentTokens: getCompactionKeepRecentTokensMock
    }
  }
}))
const getAgentDirMock = vi.fn(() => '/fake/agent/dir')
const sessionManagerOpenMock = vi.fn((path: string) => ({ __opened: path }))
let capturedResourceLoaderOptions: {
  cwd: string
  agentDir: string
  extensionFactories: Array<(pi: { on: (name: string, handler: (event: unknown) => unknown) => void }) => void>
}
const resourceLoaderReloadMock = vi.fn(async () => {})
const DefaultResourceLoaderMock = vi.fn(function (
  this: { reload: typeof resourceLoaderReloadMock },
  opts: typeof capturedResourceLoaderOptions
) {
  capturedResourceLoaderOptions = opts
  this.reload = resourceLoaderReloadMock
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
    mockAutoCompactionEnabled = true
    bindExtensionsMock.mockClear()
    getAllToolsMock.mockClear()
    setActiveToolsByNameMock.mockClear()
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

  it('reloads the resource loader before creating the session, so the inline tool_call/approval extension actually loads', async () => {
    // createAgentSession() only auto-reloads a resource loader it builds
    // itself -- a caller-supplied one (required here to register the
    // approval extension) is silently never loaded otherwise, which used to
    // mean every tool call ran completely unchecked regardless of policy.
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    expect(resourceLoaderReloadMock).toHaveBeenCalled()
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

    expect(result).toEqual({ block: true, reason: 'Denied by user', terminate: true })
  })

  it("binds a UI context in 'rpc' mode -- the mode non-terminal hosts (VS Code pendant, Zed) use, which is what makes a well-behaved extension prefer these simple primitives over its own terminal-only overlay", async () => {
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    expect(bindExtensionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'rpc', uiContext: expect.anything() })
    )
  })

  it('delegates ctx.ui.select() to requestSelect, and resolves undefined without calling it for an empty options list', async () => {
    const requestSelect = vi.fn(async () => 'chosen')
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval, requestSelect })

    const { uiContext } = bindExtensionsMock.mock.calls[0][0]
    const result = await uiContext.select('Pick one', ['a', 'b'], { timeout: 5000 })
    expect(requestSelect).toHaveBeenCalledWith('Pick one', ['a', 'b'], 5000, undefined)
    expect(result).toBe('chosen')

    requestSelect.mockClear()
    const emptyResult = await uiContext.select('Pick one', [])
    expect(emptyResult).toBeUndefined()
    expect(requestSelect).not.toHaveBeenCalled()
  })

  it('delegates ctx.ui.confirm() to requestConfirm', async () => {
    const requestConfirm = vi.fn(async () => true)
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval, requestConfirm })

    const { uiContext } = bindExtensionsMock.mock.calls[0][0]
    const result = await uiContext.confirm('Proceed?', 'This will delete files', { timeout: 3000 })
    expect(requestConfirm).toHaveBeenCalledWith('Proceed?', 'This will delete files', 3000, undefined)
    expect(result).toBe(true)
  })

  it('delegates ctx.ui.input() to requestInput', async () => {
    const requestInput = vi.fn(async () => 'Bob')
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval, requestInput })

    const { uiContext } = bindExtensionsMock.mock.calls[0][0]
    const result = await uiContext.input('Name?', 'e.g. Alice')
    expect(requestInput).toHaveBeenCalledWith('Name?', 'e.g. Alice', undefined, undefined)
    expect(result).toBe('Bob')
  })

  it('delegates ctx.ui.notify() to notify, defaulting the level to info when the extension omits it', async () => {
    const notify = vi.fn()
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval, notify })

    const { uiContext } = bindExtensionsMock.mock.calls[0][0]
    uiContext.notify('Done!')
    expect(notify).toHaveBeenCalledWith('Done!', 'info')
  })

  it('select/confirm/input resolve to a safe fallback instead of throwing when the caller omits the corresponding option', async () => {
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    const { uiContext } = bindExtensionsMock.mock.calls[0][0]
    expect(await uiContext.select('t', ['a'])).toBeUndefined()
    expect(await uiContext.confirm('t', 'm')).toBe(false)
    expect(await uiContext.input('t')).toBeUndefined()
    expect(() => uiContext.notify('msg')).not.toThrow()
  })

  it('re-activates extension-registered tools alongside the fixed built-ins, since createAgentSession\'s tools: [...AGENT_TOOLS] would otherwise silently exclude them', async () => {
    getAllToolsMock.mockReturnValueOnce([
      { name: 'read', description: '' },
      { name: 'bash', description: '' },
      { name: 'edit', description: '' },
      { name: 'write', description: '' },
      { name: 'grep', description: '' },
      { name: 'find', description: '' },
      { name: 'ls', description: '' },
      { name: 'ask_test_question', description: 'test' }
    ])

    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    expect(setActiveToolsByNameMock).toHaveBeenCalledWith([
      'read',
      'bash',
      'edit',
      'write',
      'grep',
      'find',
      'ls',
      'ask_test_question'
    ])
  })

  it('does not touch the active tool list when no extension registered any tools beyond the fixed built-ins', async () => {
    await createRepoSession({ cwd: '/repo/path', modelRuntime: {} as never, requestApproval: noApproval })

    expect(setActiveToolsByNameMock).not.toHaveBeenCalled()
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

  it('exposes the current context usage from the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getContextUsage()).toEqual({ tokens: 12345, contextWindow: 200000, percent: 6.17 })
  })

  it('forwards compact to the underlying session and discards its result', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    await expect(repoSession.compact()).resolves.toBeUndefined()
    expect(compactMock).toHaveBeenCalled()
  })

  it('reads the current auto-compaction setting from the underlying session', async () => {
    mockAutoCompactionEnabled = false
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getAutoCompactionEnabled()).toBe(false)
  })

  it('forwards setAutoCompactionEnabled to the underlying session', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    repoSession.setAutoCompactionEnabled(false)
    expect(setAutoCompactionEnabledMock).toHaveBeenCalledWith(false)
  })

  it('reads compaction thresholds from the underlying session settings manager', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    expect(repoSession.getCompactionThresholds()).toEqual({ reserveTokens: 16384, keepRecentTokens: 20000 })
  })
})
