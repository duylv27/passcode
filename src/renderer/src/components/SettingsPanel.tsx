import { useEffect, useState } from 'react'
import type {
  AnthropicOAuthPrompt,
  AuthStatus,
  CopilotQuota,
  DeviceCodeChallenge,
  ToolApprovalPolicy,
  UsageTelemetryConfig
} from '../../../shared/types'
import { KNOWN_TOOL_NAMES } from '../../../shared/types'
import { useTheme, type ThemePreference } from '../hooks/useTheme'
import { ToastStack, type ToastMessage } from './Toast'

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

const COPILOT_QUOTA_LABELS: Record<string, string> = {
  chat: 'Chat',
  completions: 'Code completions',
  premium_interactions: 'Premium requests'
}

function formatQuotaResetDate(resetDate: string): string {
  const date = new Date(resetDate)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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

// `connected` is `undefined` while getAuthStatus() is still in flight --
// rendering nothing then (rather than falling back to "not connected")
// avoids a flash from the wrong state to the right one once it resolves.
function StatusDot({ connected }: { connected: boolean | undefined }): JSX.Element | null {
  if (connected === undefined) return null
  return <span className={`provider-dot${connected ? ' is-connected' : ''}`} title={connected ? 'Connected' : 'Not connected'} />
}

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('general')
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [anthropicError, setAnthropicError] = useState<string | null>(null)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [geminiError, setGeminiError] = useState<string | null>(null)
  const [copilotError, setCopilotError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [anthropicOAuthPrompt, setAnthropicOAuthPrompt] = useState<AnthropicOAuthPrompt | null>(null)
  const [anthropicOAuthCode, setAnthropicOAuthCode] = useState('')
  const [anthropicOAuthLoading, setAnthropicOAuthLoading] = useState(false)
  const [anthropicOAuthError, setAnthropicOAuthError] = useState<string | null>(null)
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)
  const [theme, setTheme] = useTheme()
  const [quota, setQuota] = useState<CopilotQuota | null>(null)
  const [telemetryConfig, setTelemetryConfig] = useState<UsageTelemetryConfig | null>(null)
  const [telemetryPathDraft, setTelemetryPathDraft] = useState('')
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  function pushToast(text: string, variant: ToastMessage['variant']): void {
    setToasts((prev) => [...prev, { id: crypto.randomUUID(), text, variant }])
  }

  function dismissToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function refresh(): Promise<void> {
    setStatus(await window.api.settings.getAuthStatus())
  }

  useEffect(() => {
    refresh()
    window.api.approvals.getPolicy().then(setPolicy)
    window.api.settings.getUsageTelemetryConfig().then((config) => {
      setTelemetryConfig(config)
      setTelemetryPathDraft(config.outputPath)
    })
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    const unsubscribeAnthropicOAuth = window.api.settings.onAnthropicOAuthPrompt(setAnthropicOAuthPrompt)
    return () => {
      unsubscribe()
      unsubscribeAnthropicOAuth()
    }
  }, [])

  useEffect(() => {
    if (section !== 'providers' || !status?.copilot) {
      setQuota(null)
      return
    }
    let cancelled = false
    window.api.settings
      .getCopilotQuota()
      .then((result) => {
        if (!cancelled) setQuota(result)
      })
      .catch(() => {
        if (!cancelled) setQuota(null)
      })
    return () => {
      cancelled = true
    }
  }, [section, status?.copilot])

  async function toggleAutoApprove(toolName: string): Promise<void> {
    if (!policy) return
    const next: ToolApprovalPolicy = {
      autoApprove: { ...policy.autoApprove, [toolName]: !policy.autoApprove[toolName] }
    }
    setPolicy(next)
    await window.api.approvals.setPolicy(next)
  }

  // A success toast is transient and easy to notice regardless of scroll
  // position; a failure stays as a persistent inline message next to the
  // field, since a filesystem error is worth reading carefully rather
  // than having it disappear after a few seconds.
  function reportTelemetrySaveResult(result: { ok: true } | { ok: false; error: string }): void {
    if (result.ok) {
      setTelemetryError(null)
      pushToast('Usage telemetry settings saved', 'success')
    } else {
      setTelemetryError(result.error)
    }
  }

  async function toggleUsageTelemetry(): Promise<void> {
    if (!telemetryConfig) return
    const next = { ...telemetryConfig, enabled: !telemetryConfig.enabled }
    setTelemetryConfig(next)
    reportTelemetrySaveResult(await window.api.settings.setUsageTelemetryConfig(next))
  }

  async function saveTelemetryPath(): Promise<void> {
    if (!telemetryConfig) return
    const next = { ...telemetryConfig, outputPath: telemetryPathDraft }
    setTelemetryConfig(next)
    reportTelemetrySaveResult(await window.api.settings.setUsageTelemetryConfig(next))
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

  async function handleSaveGeminiKey(): Promise<void> {
    setGeminiError(null)
    const result = await window.api.settings.setGeminiApiKey(geminiApiKey)
    if (!result.ok) {
      setGeminiError(result.error)
      return
    }
    setGeminiApiKey('')
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

  async function handleAnthropicOAuthLogin(): Promise<void> {
    setAnthropicOAuthError(null)
    setAnthropicOAuthLoading(true)
    setAnthropicOAuthPrompt(null)
    setAnthropicOAuthCode('')
    const result = await window.api.settings.loginAnthropicOAuth()
    setAnthropicOAuthLoading(false)
    setAnthropicOAuthPrompt(null)
    setAnthropicOAuthCode('')
    if (!result.ok) {
      setAnthropicOAuthError(result.error)
      return
    }
    await refresh()
  }

  async function handleSubmitAnthropicOAuthCode(): Promise<void> {
    const trimmed = anthropicOAuthCode.trim()
    if (!trimmed) return
    await window.api.settings.submitAnthropicOAuthCode(trimmed)
  }

  async function handleCancelAnthropicOAuth(): Promise<void> {
    await window.api.settings.cancelAnthropicOAuth()
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
        <ToastStack messages={toasts} onDismiss={dismissToast} />
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
          <div className="settings-scroll-area">
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
              <div className="settings-row settings-row-telemetry">
                <div className="settings-telemetry-main">
                  <div className="settings-row-text">
                    <span className="settings-row-title">Usage Telemetry</span>
                    <span className="settings-row-desc">
                      Export token usage as OpenTelemetry log records for external aggregation
                    </span>
                  </div>
                  <div className="settings-row-control">
                    <Switch checked={!!telemetryConfig?.enabled} onChange={toggleUsageTelemetry} />
                  </div>
                </div>
                {telemetryConfig?.enabled && (
                  <div className="settings-telemetry-sub">
                    <div className="settings-row-text">
                      <span className="settings-row-title">Output File</span>
                      <span className="settings-row-desc">Path to append OTel log records to (JSONL, one record per line)</span>
                      {telemetryError && <span className="settings-row-error">{telemetryError}</span>}
                    </div>
                    <div className="settings-row-control settings-key-control">
                      <input
                        className="settings-input"
                        type="text"
                        value={telemetryPathDraft}
                        onChange={(e) => setTelemetryPathDraft(e.target.value)}
                        onBlur={saveTelemetryPath}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveTelemetryPath()
                        }}
                        placeholder="C:\Code\.telemetry\copilot-working.jsonl"
                      />
                      <button className="settings-btn" onClick={saveTelemetryPath}>
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {section === 'providers' && (
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    Anthropic API Key
                    <StatusDot connected={status ? status.anthropicAuthType === 'api_key' : undefined} />
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
                    Claude Pro/Max Subscription
                    <StatusDot connected={status ? status.anthropicAuthType === 'oauth' : undefined} />
                  </span>
                  <span className="settings-row-desc">
                    {status?.anthropicAuthType === 'oauth'
                      ? "Signed in — usage is covered by your subscription's included quota."
                      : "Sign in with your Anthropic account instead of an API key — usage is covered by your subscription's included quota, not metered billing."}
                  </span>
                  {anthropicOAuthError && <span className="settings-row-error">{anthropicOAuthError}</span>}
                  {anthropicOAuthPrompt && (
                    <span className="settings-row-hint">
                      A browser tab opened to sign in. If it didn't redirect automatically, paste the
                      authorization code or redirect URL here:
                      <div className="settings-row-control settings-key-control" style={{ marginTop: 6 }}>
                        <input
                          className="settings-input"
                          value={anthropicOAuthCode}
                          onChange={(e) => setAnthropicOAuthCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSubmitAnthropicOAuthCode()
                          }}
                          placeholder="Paste code or URL"
                        />
                        <button className="settings-btn" onClick={handleSubmitAnthropicOAuthCode}>
                          Submit
                        </button>
                        <button className="settings-btn" onClick={handleCancelAnthropicOAuth}>
                          Cancel
                        </button>
                      </div>
                    </span>
                  )}
                </div>
                {!anthropicOAuthPrompt && (
                  <div className="settings-row-control">
                    <button className="settings-btn" onClick={handleAnthropicOAuthLogin} disabled={anthropicOAuthLoading}>
                      {anthropicOAuthLoading
                        ? 'Signing in…'
                        : status?.anthropicAuthType === 'oauth'
                          ? 'Switch account'
                          : 'Sign in with Claude Pro/Max'}
                    </button>
                  </div>
                )}
              </div>

              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    Gemini API Key
                    <StatusDot connected={status?.gemini} />
                  </span>
                  <span className="settings-row-desc">Used for direct Google Gemini model access</span>
                  {geminiError && <span className="settings-row-error">{geminiError}</span>}
                </div>
                <div className="settings-row-control settings-key-control">
                  <input
                    className="settings-input"
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveGeminiKey()
                    }}
                    placeholder="AIza..."
                  />
                  <button className="settings-btn" onClick={handleSaveGeminiKey}>
                    Save
                  </button>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-text">
                  <span className="settings-row-title">
                    GitHub Copilot
                    <StatusDot connected={status?.copilot} />
                  </span>
                  <span className="settings-row-desc">Sign in with a device code</span>
                  {challenge && (
                    <span className="settings-row-hint">
                      Go to {challenge.verificationUri} and enter code <strong>{challenge.userCode}</strong>
                    </span>
                  )}
                  {copilotError && <span className="settings-row-error">{copilotError}</span>}
                  {quota && (
                    <div className="copilot-quota">
                      <span className="copilot-quota-subtitle">
                        {quota.planName} plan · resets {formatQuotaResetDate(quota.resetDate)}
                      </span>
                      {quota.categories.map((category) => (
                        <div key={category.id} className="copilot-quota-category">
                          <span className="copilot-quota-category-label">
                            {COPILOT_QUOTA_LABELS[category.id] ?? category.id}
                          </span>
                          {category.unlimited ? (
                            <span className="copilot-quota-pill">Unlimited</span>
                          ) : (
                            <div className="copilot-quota-meter">
                              <div className="copilot-quota-bar">
                                <div
                                  className="copilot-quota-bar-fill"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, category.percentRemaining))}%`,
                                    background:
                                      category.percentRemaining < 20 ? 'var(--danger)' : 'var(--success)'
                                  }}
                                />
                              </div>
                              <span className="copilot-quota-meter-text">
                                {category.remaining.toLocaleString()} / {category.entitlement.toLocaleString()}{' '}
                                remaining ({Math.round(category.percentRemaining)}%)
                                {category.overagePermitted && category.overageCount > 0
                                  ? ` · ${category.overageCount.toLocaleString()} over quota`
                                  : ''}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {status && !status.copilot && (
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
    </div>
  )
}
