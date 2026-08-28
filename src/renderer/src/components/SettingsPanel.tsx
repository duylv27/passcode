import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge, ToolApprovalPolicy } from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'

export function SettingsPanel(): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [anthropicError, setAnthropicError] = useState<string | null>(null)
  const [copilotError, setCopilotError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)

  async function refresh(): Promise<void> {
    setStatus(await window.api.settings.getAuthStatus())
  }

  useEffect(() => {
    refresh()
    window.api.approvals.getPolicy().then(setPolicy)
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    return unsubscribe
  }, [])

  async function toggleAutoApprove(toolName: string): Promise<void> {
    if (!policy) return
    const next: ToolApprovalPolicy = {
      autoApprove: { ...policy.autoApprove, [toolName]: !policy.autoApprove[toolName] }
    }
    setPolicy(next)
    await window.api.approvals.setPolicy(next)
  }

  async function handleSaveKey(): Promise<void> {
    setAnthropicError(null)
    const result = await window.api.settings.setAnthropicApiKey(apiKey)
    if (!result.ok) {
      setAnthropicError(result.error)
      return
    }
    setApiKey('')
    await refresh()
  }

  async function handleCopilotLogin(): Promise<void> {
    setCopilotError(null)
    setLoggingIn(true)
    setChallenge(null)
    const result = await window.api.settings.loginCopilot()
    setLoggingIn(false)
    setChallenge(null)
    if (!result.ok) {
      setCopilotError(result.error)
      return
    }
    await refresh()
  }

  return (
    <div className="settings">
      <h3>Settings</h3>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className={`status-dot${status?.anthropic ? ' is-connected' : ''}`} />
          <span>Anthropic</span>
        </div>
        <div className="settings-card-row">
          <input
            className="field"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveKey()
            }}
            placeholder="Anthropic API key"
          />
          <button className="btn" onClick={handleSaveKey}>
            Save
          </button>
        </div>
        {anthropicError && <div className="error-text">{anthropicError}</div>}
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span className={`status-dot${status?.copilot ? ' is-connected' : ''}`} />
          <span>GitHub Copilot</span>
        </div>
        <button className="btn" onClick={handleCopilotLogin} disabled={loggingIn}>
          {loggingIn ? 'Signing in…' : 'Sign in'}
        </button>
        {challenge && (
          <div className="settings-challenge">
            Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
          </div>
        )}
        {copilotError && <div className="error-text">{copilotError}</div>}
      </div>

      <div className="settings-card">
        <div className="settings-card-header">
          <span>Tool Approval</span>
        </div>
        <p className="settings-card-description">
          Tools left unchecked run automatically. Checked tools pause and ask before running.
        </p>
        <div className="approval-policy-list">
          {KNOWN_TOOL_NAMES.map((toolName) => (
            <label key={toolName} className="approval-policy-row">
              <input
                type="checkbox"
                checked={policy ? !policy.autoApprove[toolName] : false}
                onChange={() => toggleAutoApprove(toolName)}
              />
              <span>{toolName}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  )
}
