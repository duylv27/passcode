import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge, ToolApprovalPolicy } from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { useTheme, type ThemePreference } from '../hooks/useTheme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' }
]

const TOOL_LABELS: Record<(typeof KNOWN_TOOL_NAMES)[number], string> = {
  read: 'Read',
  grep: 'Grep',
  find: 'Find',
  ls: 'List directory',
  bash: 'Bash',
  powershell: 'PowerShell',
  edit: 'Edit',
  write: 'Write'
}

function Switch({
  checked,
  onChange
}: {
  checked: boolean
  onChange: () => void
}): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}

export function SettingsPanel(): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [anthropicError, setAnthropicError] = useState<string | null>(null)
  const [copilotError, setCopilotError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)
  const [theme, setTheme] = useTheme()

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
    <div className="settings-light">
      <h2 className="settings-light-title">Settings</h2>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">Appearance</span>
            <span className="settings-row-desc">Color scheme for the app window</span>
          </div>
          <div className="settings-row-control">
            <div className="segmented">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segmented-option${theme === opt.value ? ' is-selected' : ''}`}
                  onClick={() => setTheme(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">Anthropic API Key</span>
            <span className="settings-row-desc">
              {status?.anthropic ? 'Connected' : 'Used for direct Anthropic model access'}
            </span>
            {anthropicError && <span className="settings-row-error">{anthropicError}</span>}
          </div>
          <div className="settings-row-control settings-key-control">
            <input
              className="settings-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveKey()
              }}
              placeholder="sk-ant-..."
            />
            <button className="settings-btn" onClick={handleSaveKey}>
              Save
            </button>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <span className="settings-row-title">GitHub Copilot</span>
            <span className="settings-row-desc">
              {status?.copilot ? 'Connected' : 'Sign in with a device code'}
            </span>
            {challenge && (
              <span className="settings-row-hint">
                Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
              </span>
            )}
            {copilotError && <span className="settings-row-error">{copilotError}</span>}
          </div>
          <div className="settings-row-control">
            <button className="settings-btn" onClick={handleCopilotLogin} disabled={loggingIn}>
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </div>

        {KNOWN_TOOL_NAMES.map((toolName) => {
          const requiresApproval = policy ? !policy.autoApprove[toolName] : false
          return (
            <div key={toolName} className="settings-row">
              <div className="settings-row-text">
                <span className="settings-row-title">{TOOL_LABELS[toolName]}</span>
                <span className="settings-row-desc">
                  {requiresApproval ? 'Pauses and asks before running' : 'Runs automatically'}
                </span>
              </div>
              <div className="settings-row-control">
                <Switch checked={requiresApproval} onChange={() => toggleAutoApprove(toolName)} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
