import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge, ToolApprovalPolicy } from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { useTheme, type ThemePreference } from '../hooks/useTheme'

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'dracula', label: 'Dracula' },
  { value: 'nord', label: 'Nord' },
  { value: 'high-contrast', label: 'High Contrast' },
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

type Section = 'general' | 'providers' | 'permissions'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'providers', label: 'Providers' },
  { value: 'permissions', label: 'Permissions' }
]

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </label>
  )
}

function StatusDot({ connected }: { connected: boolean }): JSX.Element {
  return <span className={`provider-dot${connected ? ' is-connected' : ''}`} title={connected ? 'Connected' : 'Not connected'} />
}

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('general')
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
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          {SECTIONS.map((s) => (
            <button
              key={s.value}
              className={`settings-nav-item${section === s.value ? ' is-active' : ''}`}
              onClick={() => setSection(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          <div className="settings-content-header">
            <h2 className="settings-light-title">{SECTIONS.find((s) => s.value === section)!.label}</h2>
            <button className="settings-close" onClick={onClose} title="Close">
              ✕
            </button>
          </div>

          {section === 'general' && (
            <div className="settings-group">
              <div className="settings-row settings-row-theme">
                <div className="settings-row-text">
                  <span className="settings-row-title">Appearance</span>
                  <span className="settings-row-desc">Color scheme for the app window</span>
                </div>
              </div>
              <div className="theme-swatches">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`theme-swatch theme-swatch-${opt.value}${theme === opt.value ? ' is-selected' : ''}`}
                    onClick={() => setTheme(opt.value)}
                  >
                    <span className="theme-swatch-preview" />
                    <span className="theme-swatch-label">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {section === 'providers' && (
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    Anthropic API Key
                    <StatusDot connected={!!status?.anthropic} />
                  </span>
                  <span className="settings-row-desc">Used for direct Anthropic model access</span>
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
                  <span className="settings-row-title">
                    GitHub Copilot
                    <StatusDot connected={!!status?.copilot} />
                  </span>
                  <span className="settings-row-desc">Sign in with a device code</span>
                  {challenge && (
                    <span className="settings-row-hint">
                      Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
                    </span>
                  )}
                  {copilotError && <span className="settings-row-error">{copilotError}</span>}
                </div>
                {!status?.copilot && (
                  <div className="settings-row-control">
                    <button className="settings-btn" onClick={handleCopilotLogin} disabled={loggingIn}>
                      {loggingIn ? 'Signing in…' : 'Sign in'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'permissions' && (
            <div className="settings-group">
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
          )}
        </div>
      </div>
    </div>
  )
}
