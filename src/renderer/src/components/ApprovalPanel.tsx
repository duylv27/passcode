import { useEffect, useRef, useState } from 'react'
import type { ApprovalRequest } from '../../../shared/types'
import { HIGH_IMPACT_TOOLS, TOOL_ICONS, summarizeToolCall } from '../lib/toolDisplay'
import { ChevronIcon } from './icons'

/** Inline, non-blocking panel docked above the composer for the session
 * the pending request belongs to -- not a full-screen modal, which would
 * block switching tabs to check on other sessions for what's really a
 * single-session concern.
 *
 * Deliberately a single compact row by default: icon + one-line truncated
 * summary + Skip/Allow, nothing else. Full args and "always allow" only
 * appear behind an explicit expand -- so approving/skipping never requires
 * reading anything extra or growing the card. Allow auto-focuses so
 * Enter/Space acts immediately, and Escape skips -- both work the instant
 * the panel appears, no click needed first. */
export function ApprovalPanel({
  requests,
  onRespond
}: {
  requests: ApprovalRequest[]
  onRespond: (requestId: string, approved: boolean) => void
}): JSX.Element | null {
  const current = requests[0]
  const allowRef = useRef<HTMLButtonElement>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [alwaysAllowSaved, setAlwaysAllowSaved] = useState(false)

  // Re-focus Allow (and collapse any previously-opened details) whenever a
  // *different* request becomes current -- keyed on requestId, not on
  // `requests` itself, so it doesn't yank focus back mid-interaction while
  // the same request is still pending (e.g. after opening details).
  useEffect(() => {
    setDetailsOpen(false)
    setAlwaysAllowSaved(false)
    if (current) allowRef.current?.focus()
  }, [current?.requestId])

  if (!current) return null

  const Icon = TOOL_ICONS[current.toolName]
  const highImpact = HIGH_IMPACT_TOOLS.has(current.toolName)
  const summary = summarizeToolCall(current.toolName, current.input) ?? current.toolName

  async function handleAlwaysAllow(): Promise<void> {
    const policy = await window.api.approvals.getPolicy()
    await window.api.approvals.setPolicy({
      autoApprove: { ...policy.autoApprove, [current.toolName]: true }
    })
    setAlwaysAllowSaved(true)
    // A beat to register the confirmation before moving on, matching how
    // Allow itself feels instantaneous rather than a jarring instant swap.
    window.setTimeout(() => onRespond(current.requestId, true), 400)
  }

  return (
    <div
      className={`approval-panel-wrap${highImpact ? ' is-high-impact' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onRespond(current.requestId, false)
        }
      }}
    >
      <div className="approval-bar">
        {Icon && <Icon className="approval-bar-icon" />}
        <span className="approval-bar-text">{summary}</span>
        <button
          type="button"
          className="approval-bar-expand"
          onClick={() => setDetailsOpen((v) => !v)}
          title={detailsOpen ? 'Hide details' : 'Show details'}
        >
          <ChevronIcon className={`chevron${detailsOpen ? ' is-open' : ''}`} />
        </button>
        <div className="approval-bar-actions">
          <button className="approval-skip" onClick={() => onRespond(current.requestId, false)}>
            Skip
          </button>
          <button ref={allowRef} className="approval-allow" onClick={() => onRespond(current.requestId, true)}>
            Allow ↵
          </button>
        </div>
      </div>
      {detailsOpen && (
        <div className="approval-bar-details">
          <pre className="approval-bar-command">{stringifyInput(current.input)}</pre>
          {alwaysAllowSaved ? (
            <span className="approval-bar-always-confirm">Won't ask again</span>
          ) : (
            <button type="button" className="approval-bar-always" onClick={handleAlwaysAllow}>
              Always allow {current.toolName}
            </button>
          )}
        </div>
      )}
      {requests.length > 1 && <div className="approval-panel-queue-hint">{requests.length - 1} more waiting</div>}
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
