import { randomUUID } from 'node:crypto'
import type { ApprovalRequest, ToolApprovalPolicy } from '../../shared/types'

export interface CreateApprovalHandlersDeps {
  getPolicy: () => ToolApprovalPolicy
  setPolicy: (policy: ToolApprovalPolicy) => void
  onRequest: (request: ApprovalRequest) => void
}

export interface ApprovalHandlers {
  getPolicy(): ToolApprovalPolicy
  setPolicy(policy: ToolApprovalPolicy): void
  /** Resolves once the user responds, or immediately if the policy auto-approves this tool. */
  requestApproval(sessionId: string, toolName: string, input: unknown): Promise<boolean>
  respond(requestId: string, approved: boolean): void
}

export function createApprovalHandlers(deps: CreateApprovalHandlersDeps): ApprovalHandlers {
  const pending = new Map<string, (approved: boolean) => void>()

  return {
    getPolicy(): ToolApprovalPolicy {
      return deps.getPolicy()
    },
    setPolicy(policy: ToolApprovalPolicy): void {
      deps.setPolicy(policy)
    },
    requestApproval(sessionId: string, toolName: string, input: unknown): Promise<boolean> {
      const policy = deps.getPolicy()
      if (policy.autoApprove[toolName]) return Promise.resolve(true)

      return new Promise((resolve) => {
        const requestId = randomUUID()
        pending.set(requestId, resolve)
        deps.onRequest({ requestId, sessionId, toolName, input })
      })
    },
    respond(requestId: string, approved: boolean): void {
      const resolve = pending.get(requestId)
      if (!resolve) return
      pending.delete(requestId)
      resolve(approved)
    }
  }
}
