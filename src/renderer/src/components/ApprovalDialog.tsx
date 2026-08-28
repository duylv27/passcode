import { useEffect, useState } from 'react'
import type { ApprovalRequest } from '../../../shared/types'

export function ApprovalDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<ApprovalRequest[]>([])

  useEffect(() => {
    const unsubscribe = window.api.approvals.onRequest((request) => {
      setQueue((prev) => [...prev, request])
    })
    return unsubscribe
  }, [])

  if (queue.length === 0) return null

  const current = queue[0]

  async function respond(approved: boolean): Promise<void> {
    await window.api.approvals.respond(current.requestId, approved)
    setQueue((prev) => prev.slice(1))
  }

  return (
    <div className="approval-overlay">
      <div className="approval-dialog">
        <div className="approval-title">Run {current.toolName}?</div>
        <pre className="approval-input">{stringifyInput(current.input)}</pre>
        {queue.length > 1 && <div className="approval-queue-hint">{queue.length - 1} more waiting</div>}
        <div className="approval-actions">
          <button className="approval-skip" onClick={() => respond(false)}>
            Skip
          </button>
          <button className="approval-allow" onClick={() => respond(true)}>
            Allow
          </button>
        </div>
      </div>
    </div>
  )
}

function stringifyInput(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
