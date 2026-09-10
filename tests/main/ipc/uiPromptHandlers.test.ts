import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UiPromptRequest } from '../../../src/shared/types'
import {
  createUiPromptHandlers,
  type UiPromptHandlers,
  type CreateUiPromptHandlersDeps
} from '../../../src/main/ipc/uiPromptHandlers'

describe('uiPromptHandlers', () => {
  let requests: UiPromptRequest[]
  let cancelled: string[]
  let handlers: UiPromptHandlers

  beforeEach(() => {
    vi.useFakeTimers()
    requests = []
    cancelled = []

    const deps: CreateUiPromptHandlersDeps = {
      onRequest: (request) => requests.push(request),
      onCancel: (requestId) => cancelled.push(requestId)
    }
    handlers = createUiPromptHandlers(deps)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves undefined immediately without emitting a request for an empty options list', async () => {
    const value = await handlers.requestSelect('session-1', 'Pick one', [])
    expect(value).toBeUndefined()
    expect(requests).toEqual([])
  })

  it('emits a select request and resolves with the chosen option', async () => {
    const pending = handlers.requestSelect('session-1', 'Pick one', ['a', 'b'])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ sessionId: 'session-1', kind: 'select', title: 'Pick one', options: ['a', 'b'] })
    handlers.respond(requests[0].requestId, 'b')
    expect(await pending).toBe('b')
  })

  it('emits a confirm request and resolves with the boolean answer', async () => {
    const pending = handlers.requestConfirm('session-1', 'Proceed?', 'This will delete files')
    expect(requests[0]).toMatchObject({ kind: 'confirm', title: 'Proceed?', message: 'This will delete files' })
    handlers.respond(requests[0].requestId, true)
    expect(await pending).toBe(true)
  })

  it('emits an input request and resolves with the typed answer', async () => {
    const pending = handlers.requestInput('session-1', 'Name?', 'e.g. Alice')
    expect(requests[0]).toMatchObject({ kind: 'input', title: 'Name?', placeholder: 'e.g. Alice' })
    handlers.respond(requests[0].requestId, 'Bob')
    expect(await pending).toBe('Bob')
  })

  it('resolves with the type-appropriate fallback and notifies cancellation on timeout', async () => {
    const selectPending = handlers.requestSelect('session-1', 'Pick one', ['a'], 1000)
    const confirmPending = handlers.requestConfirm('session-1', 'Proceed?', 'msg', 1000)
    const inputPending = handlers.requestInput('session-1', 'Name?', undefined, 1000)

    vi.advanceTimersByTime(1000)

    expect(await selectPending).toBeUndefined()
    expect(await confirmPending).toBe(false)
    expect(await inputPending).toBeUndefined()
    expect(cancelled).toHaveLength(3)
  })

  it('resolves and notifies cancellation when the AbortSignal fires', async () => {
    const controller = new AbortController()
    const pending = handlers.requestSelect('session-1', 'Pick one', ['a'], undefined, controller.signal)
    controller.abort()
    expect(await pending).toBeUndefined()
    expect(cancelled).toEqual([requests[0].requestId])
  })

  it('a real response after abort/timeout is a no-op (request already resolved)', async () => {
    const controller = new AbortController()
    const pending = handlers.requestSelect('session-1', 'Pick one', ['a'], undefined, controller.signal)
    controller.abort()
    await pending
    // Late response for the now-resolved request -- must not throw.
    handlers.respond(requests[0].requestId, 'a')
  })

  it('ignores a response for an unknown or already-resolved request id', () => {
    handlers.respond('does-not-exist', 'x')
    // No throw is the assertion here.
  })

  it('assigns a distinct request id per pending request on the same session', () => {
    handlers.requestSelect('session-1', 'A', ['x'])
    handlers.requestSelect('session-1', 'B', ['y'])
    expect(requests).toHaveLength(2)
    expect(requests[0].requestId).not.toBe(requests[1].requestId)
  })
})
