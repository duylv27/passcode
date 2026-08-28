import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApprovalRequest, ToolApprovalPolicy } from '../../../src/shared/types'
import {
  createApprovalHandlers,
  type ApprovalHandlers,
  type CreateApprovalHandlersDeps
} from '../../../src/main/ipc/approvalHandlers'

describe('approvalHandlers', () => {
  let policy: ToolApprovalPolicy
  let requests: ApprovalRequest[]
  let setPolicyMock: ReturnType<typeof vi.fn>
  let handlers: ApprovalHandlers

  beforeEach(() => {
    policy = { autoApprove: { read: true, bash: false } }
    requests = []
    setPolicyMock = vi.fn()

    const deps: CreateApprovalHandlersDeps = {
      getPolicy: () => policy,
      setPolicy: setPolicyMock,
      onRequest: (request) => requests.push(request)
    }
    handlers = createApprovalHandlers(deps)
  })

  it('returns the current policy', () => {
    expect(handlers.getPolicy()).toBe(policy)
  })

  it('delegates setPolicy to the underlying store', () => {
    const next = { autoApprove: { read: false } }
    handlers.setPolicy(next)
    expect(setPolicyMock).toHaveBeenCalledWith(next)
  })

  it('auto-approves a tool call without prompting when the policy allows it', async () => {
    const approved = await handlers.requestApproval('session-1', 'read', { path: 'a.ts' })
    expect(approved).toBe(true)
    expect(requests).toEqual([])
  })

  it('emits a request and waits for a response when the policy requires approval', async () => {
    const pending = handlers.requestApproval('session-1', 'bash', { command: 'rm -rf x' })

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      sessionId: 'session-1',
      toolName: 'bash',
      input: { command: 'rm -rf x' }
    })

    handlers.respond(requests[0].requestId, true)
    expect(await pending).toBe(true)
  })

  it('resolves false when the user denies the request', async () => {
    const pending = handlers.requestApproval('session-1', 'bash', { command: 'rm -rf x' })
    handlers.respond(requests[0].requestId, false)
    expect(await pending).toBe(false)
  })

  it('ignores a response for an unknown or already-resolved request id', async () => {
    handlers.respond('does-not-exist', true)
    // No throw is the assertion here.
  })

  it('assigns a distinct request id per pending request for the same tool', async () => {
    const first = handlers.requestApproval('session-1', 'bash', { command: 'a' })
    const second = handlers.requestApproval('session-1', 'bash', { command: 'b' })
    expect(requests).toHaveLength(2)
    expect(requests[0].requestId).not.toBe(requests[1].requestId)
    handlers.respond(requests[0].requestId, true)
    handlers.respond(requests[1].requestId, false)
    expect(await first).toBe(true)
    expect(await second).toBe(false)
  })
})
