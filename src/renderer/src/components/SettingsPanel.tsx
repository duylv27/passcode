import { useEffect, useState } from 'react'
import type {
  CopilotQuota,
  Passport,
  PassportOAuthPrompt,
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

type Section = 'general' | 'passports' | 'permissions'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'passports', label: 'Passports' },
  { value: 'permissions', label: 'Permissions' }
]

const COPILOT_QUOTA_LABELS: Record<string, string> = {
  premium_interactions: 'Premium interactions',
  chat: 'Chat',
  completions: 'Completions'
}

function formatQuotaResetDate(resetDate: string): string {
  const date = new Date(resetDate)
  if (Number.isNaN(date.getTime())) return resetDate
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

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

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('general')
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)
  const [theme, setTheme] = useTheme()
  const [telemetryConfig, setTelemetryConfig] = useState<UsageTelemetryConfig | null>(null)
  const [telemetryPathDraft, setTelemetryPathDraft] = useState('')
  const [telemetryError, setTelemetryError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const [passports, setPassports] = useState<Passport[]>([])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [detailPassportId, setDetailPassportId] = useState<string | null>(null)
  const [addStep, setAddStep] = useState<'provider' | 'method' | 'connect'>('provider')
  const [addProviderId, setAddProviderId] = useState<string | null>(null)
  const [addMethod, setAddMethod] = useState<'api_key' | 'oauth' | null>(null)
  const [addDisplayName, setAddDisplayName] = useState('')
  const [addApiKey, setAddApiKey] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addPopupOpen, setAddPopupOpen] = useState(false)
  const [oauthPrompt, setOauthPrompt] = useState<PassportOAuthPrompt | null>(null)
  const [oauthCodeDraft, setOauthCodeDraft] = useState('')
  const [quota, setQuota] = useState<CopilotQuota | null>(null)

  function pushToast(text: string, variant: ToastMessage['variant']): void {
    setToasts((prev) => [...prev, { id: crypto.randomUUID(), text, variant }])
  }

  function dismissToast(id: string): void {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function refreshPassports(): Promise<void> {
    setPassports(await window.api.passports.list())
  }

  useEffect(() => {
    refreshPassports()
    window.api.approvals.getPolicy().then(setPolicy)
    window.api.settings.getUsageTelemetryConfig().then((config) => {
      setTelemetryConfig(config)
      setTelemetryPathDraft(config.outputPath)
    })
  }, [])

  const copilotPassport = passports.find((p) => p.providerId === 'github-copilot' && p.isActive)

  useEffect(() => {
    if (section !== 'passports' || !copilotPassport) {
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
  }, [section, copilotPassport])

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

  const PROVIDER_LABELS: Record<string, string> = {
    anthropic: 'Anthropic',
    google: 'Google',
    'github-copilot': 'GitHub Copilot'
  }
  const PROVIDER_ICONS: Record<string, string> = {
    anthropic: '\u{1F170}',
    google: '\u{1F1EC}',
    'github-copilot': '\u{1F419}'
  }
  const PROVIDERS_FOR_ADD = ['anthropic', 'google', 'github-copilot']
  const METHODS_FOR_PROVIDER: Record<string, { value: 'api_key' | 'oauth'; title: string; desc: string }[]> = {
    anthropic: [
      { value: 'oauth', title: 'Sign in with browser (Claude Pro/Max)', desc: 'Usage covered by your subscription' },
      { value: 'api_key', title: 'API Key', desc: 'Paste a key from console.anthropic.com' }
    ],
    google: [{ value: 'api_key', title: 'API Key', desc: 'Paste a key from Google AI Studio' }],
    'github-copilot': [{ value: 'oauth', title: 'Sign in with device code', desc: 'Authorize this app from github.com/login/device' }]
  }

  function openAddPopup(): void {
    setAddStep('provider')
    setAddProviderId(null)
    setAddMethod(null)
    setAddDisplayName('')
    setAddApiKey('')
    setAddError(null)
    setOauthPrompt(null)
    setOauthCodeDraft('')
    setAddPopupOpen(true)
  }

  function closeAddPopup(): void {
    if (oauthPrompt) window.api.passports.cancelOAuth()
    setAddPopupOpen(false)
  }

  async function handleAddContinue(): Promise<void> {
    if (addStep === 'provider' && addProviderId) {
      setAddStep('method')
      return
    }
    if (addStep === 'method' && addMethod && addProviderId) {
      setAddDisplayName(
        addMethod === 'oauth' ? `${PROVIDER_LABELS[addProviderId]} Sign-in` : `${PROVIDER_LABELS[addProviderId]} API Key`
      )
      setAddStep('connect')
      return
    }
    if (addStep === 'connect' && addProviderId && addMethod === 'api_key') {
      setAddError(null)
      setAddBusy(true)
      const result = await window.api.passports.createApiKey(addProviderId, addDisplayName, addApiKey)
      setAddBusy(false)
      if (!result.ok) {
        setAddError(result.error)
        return
      }
      await refreshPassports()
      setAddPopupOpen(false)
    }
  }

  async function handleStartOAuth(): Promise<void> {
    if (!addProviderId) return
    setAddError(null)
    setAddBusy(true)
    const unsubscribe = window.api.passports.onOAuthPrompt(setOauthPrompt)
    const result = await window.api.passports.createOAuth(addProviderId, addDisplayName)
    unsubscribe()
    setAddBusy(false)
    setOauthPrompt(null)
    if (!result.ok) {
      setAddError(result.error)
      return
    }
    await refreshPassports()
    setAddPopupOpen(false)
  }

  async function handleSubmitOAuthCode(): Promise<void> {
    await window.api.passports.submitOAuthCode(oauthCodeDraft)
    setOauthCodeDraft('')
  }

  async function handleSetActive(id: string): Promise<void> {
    setOpenMenuId(null)
    await window.api.passports.setActive(id)
    await refreshPassports()
  }

  async function handleRemove(id: string): Promise<void> {
    setOpenMenuId(null)
    setDetailPassportId(null)
    await window.api.passports.remove(id)
    await refreshPassports()
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

          {section === 'passports' && (
            <div className="settings-group" style={{ background: 'transparent', border: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
                <button className="passport-add-btn" onClick={openAddPopup}>
                  + Add Passport
                </button>
              </div>
              {Object.entries(
                passports.reduce<Record<string, Passport[]>>((groups, p) => {
                  ;(groups[p.providerId] ??= []).push(p)
                  return groups
                }, {})
              ).map(([providerId, rows]) => (
                <div key={providerId} className="passport-group">
                  <div className="passport-group-label">{PROVIDER_LABELS[providerId] ?? providerId}</div>
                  {rows.map((passport) => (
                    <div key={passport.id} className="passport-row">
                      <div className="passport-icon">{PROVIDER_ICONS[providerId] ?? '\u{1F511}'}</div>
                      <div className="passport-main">
                        <div className="passport-name">
                          <span className={`passport-dot ${passport.isActive ? 'is-on' : 'is-off'}`} />
                          {passport.displayName}
                          {passport.isActive && <span className="passport-tag-active">Active</span>}
                        </div>
                        <div className="passport-meta">
                          <span className="passport-badge">
                            {passport.authMethod === 'api_key' ? 'API Key' : 'OAuth'}
                          </span>
                          {passport.authMethod === 'api_key' && passport.apiKey && (
                            <span className="passport-meta-item">
                              {passport.apiKey.slice(0, 7)}…{passport.apiKey.slice(-4)}
                            </span>
                          )}
                          <span className="passport-meta-item">
                            {passport.lastUsedAt ? (
                              <>Last used <b>{new Date(passport.lastUsedAt).toLocaleDateString()}</b></>
                            ) : (
                              'Never used'
                            )}
                          </span>
                          {passport.authMethod === 'api_key' && (
                            <span className="passport-meta-item">
                              <b>{(passport.totalInputTokens + passport.totalOutputTokens).toLocaleString()}</b> tokens all-time
                            </span>
                          )}
                          {providerId === 'github-copilot' && passport.isActive && quota && (
                            (() => {
                              const premium = quota.categories.find((c) => c.id === 'premium_interactions')
                              if (!premium || premium.unlimited) return null
                              return (
                                <span className="passport-meta-item">
                                  <span className="passport-usage-bar">
                                    <span
                                      style={{
                                        width: `${Math.max(0, Math.min(100, 100 - premium.percentRemaining))}%`
                                      }}
                                    />
                                  </span>{' '}
                                  <b>{Math.round(100 - premium.percentRemaining)}%</b> premium quota
                                </span>
                              )
                            })()
                          )}
                        </div>
                      </div>
                      <div className="passport-row-actions">
                        <button className="passport-link-btn" onClick={() => setDetailPassportId(passport.id)}>
                          View details
                        </button>
                        <div style={{ position: 'relative' }}>
                          <button
                            className="passport-kebab"
                            onClick={() => setOpenMenuId(openMenuId === passport.id ? null : passport.id)}
                          >
                            ⋯
                          </button>
                          {openMenuId === passport.id && (
                            <div className="passport-kebab-menu">
                              {!passport.isActive && (
                                <button onClick={() => handleSetActive(passport.id)}>Set Active</button>
                              )}
                              <button onClick={() => handleRemove(passport.id)}>Remove</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {passports.length === 0 && (
                <div className="settings-row-desc" style={{ padding: '18px' }}>
                  No Passports yet -- add one to connect a provider.
                </div>
              )}
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

        {addPopupOpen && (
          <div className="passport-popup-backdrop" onClick={closeAddPopup}>
            <div className="passport-popup" onClick={(e) => e.stopPropagation()}>
              <div className="passport-popup-head">
                <h3>Add Passport</h3>
                <button className="passport-popup-close" onClick={closeAddPopup}>
                  ✕
                </button>
              </div>
              <div className="passport-popup-body">
                <div className="passport-steps">
                  <span className={`passport-step ${addStep !== 'provider' ? 'is-done' : 'is-now'}`}>1 · Provider</span>
                  <span
                    className={`passport-step ${addStep === 'connect' ? 'is-done' : addStep === 'method' ? 'is-now' : ''}`}
                  >
                    2 · Method
                  </span>
                  <span className={`passport-step ${addStep === 'connect' ? 'is-now' : ''}`}>3 · Connect</span>
                </div>

                {addStep === 'provider' && (
                  <div className="passport-provider-grid">
                    {PROVIDERS_FOR_ADD.map((providerId) => (
                      <div
                        key={providerId}
                        className={`passport-method-card ${addProviderId === providerId ? 'is-selected' : ''}`}
                        onClick={() => setAddProviderId(providerId)}
                      >
                        <span className="passport-radio" />
                        <div className="passport-method-title">{PROVIDER_LABELS[providerId]}</div>
                      </div>
                    ))}
                  </div>
                )}

                {addStep === 'method' && addProviderId && (
                  <div className="passport-method-grid">
                    {METHODS_FOR_PROVIDER[addProviderId].map((m) => (
                      <div
                        key={m.value}
                        className={`passport-method-card ${addMethod === m.value ? 'is-selected' : ''}`}
                        onClick={() => setAddMethod(m.value)}
                      >
                        <span className="passport-radio" />
                        <div>
                          <div className="passport-method-title">{m.title}</div>
                          <div className="passport-method-desc">{m.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {addStep === 'connect' && addMethod === 'api_key' && (
                  <div>
                    <label className="passport-field-label">Display name</label>
                    <input
                      className="settings-input"
                      style={{ width: '100%', marginBottom: '10px' }}
                      value={addDisplayName}
                      onChange={(e) => setAddDisplayName(e.target.value)}
                    />
                    <label className="passport-field-label">API Key</label>
                    <input
                      className="settings-input"
                      style={{ width: '100%', marginBottom: '10px' }}
                      type="password"
                      value={addApiKey}
                      onChange={(e) => setAddApiKey(e.target.value)}
                      placeholder={addProviderId === 'google' ? 'AIza...' : 'sk-ant-...'}
                    />
                    {addError && <span className="settings-row-error">{addError}</span>}
                  </div>
                )}

                {addStep === 'connect' && addMethod === 'oauth' && (
                  <div>
                    {!oauthPrompt && !addBusy && (
                      <p className="settings-row-desc">Click Continue to start signing in.</p>
                    )}
                    {oauthPrompt?.kind === 'browser' && (
                      <p className="settings-row-desc">
                        A browser window opened to sign in.{' '}
                        {oauthPrompt.instructions ?? 'If it didn’t redirect back automatically, paste the code or URL it gave you below.'}
                      </p>
                    )}
                    {oauthPrompt?.kind === 'device_code' && (
                      <p className="settings-row-desc">
                        Go to {oauthPrompt.verificationUri} and enter code <strong>{oauthPrompt.userCode}</strong>
                      </p>
                    )}
                    {oauthPrompt?.kind === 'browser' && (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                        <input
                          className="settings-input"
                          style={{ flex: 1 }}
                          value={oauthCodeDraft}
                          onChange={(e) => setOauthCodeDraft(e.target.value)}
                          placeholder="Paste code or URL"
                        />
                        <button className="settings-btn" onClick={handleSubmitOAuthCode}>
                          Submit
                        </button>
                      </div>
                    )}
                    {addError && <span className="settings-row-error">{addError}</span>}
                  </div>
                )}
              </div>
              <div className="passport-btn-row">
                {addStep !== 'provider' && (
                  <button
                    className="passport-btn is-ghost"
                    onClick={() => setAddStep(addStep === 'connect' ? 'method' : 'provider')}
                  >
                    Back
                  </button>
                )}
                <button
                  className="passport-btn is-primary"
                  disabled={
                    (addStep === 'provider' && !addProviderId) ||
                    (addStep === 'method' && !addMethod) ||
                    addBusy
                  }
                  onClick={addStep === 'connect' && addMethod === 'oauth' ? handleStartOAuth : handleAddContinue}
                >
                  {addBusy ? 'Working…' : addStep === 'connect' ? 'Connect' : 'Continue'}
                </button>
              </div>
            </div>
          </div>
        )}

        {detailPassportId &&
          (() => {
            const passport = passports.find((p) => p.id === detailPassportId)
            if (!passport) return null
            const showCopilotQuota = passport.providerId === 'github-copilot' && passport.isActive && quota
            return (
              <div className="passport-popup-backdrop" onClick={() => setDetailPassportId(null)}>
                <div className="passport-popup" onClick={(e) => e.stopPropagation()}>
                  <div className="passport-popup-head">
                    <h3>{passport.displayName}</h3>
                    <button className="passport-popup-close" onClick={() => setDetailPassportId(null)}>
                      ✕
                    </button>
                  </div>
                  <div className="passport-popup-body">
                    <dl className="passport-detail-grid">
                      <dt>Provider</dt>
                      <dd>{PROVIDER_LABELS[passport.providerId] ?? passport.providerId}</dd>
                      <dt>Method</dt>
                      <dd>{passport.authMethod === 'api_key' ? 'API Key' : 'OAuth'}</dd>
                      <dt>Status</dt>
                      <dd>
                        <span
                          className={`passport-dot ${passport.isActive ? 'is-on' : 'is-off'}`}
                          style={{ display: 'inline-block', marginRight: '5px' }}
                        />
                        {passport.isActive ? 'Active' : 'Saved, not active'}
                      </dd>
                      {passport.authMethod === 'api_key' && passport.apiKey && (
                        <>
                          <dt>Key</dt>
                          <dd>
                            {passport.apiKey.slice(0, 7)}…{passport.apiKey.slice(-4)}
                          </dd>
                        </>
                      )}
                      <dt>Added</dt>
                      <dd>{new Date(passport.createdAt).toLocaleString()}</dd>
                    </dl>
                    <div className="passport-detail-usage">
                      <div className="passport-detail-usage-row">
                        <span>Total tokens (all-time)</span>
                        <b>{(passport.totalInputTokens + passport.totalOutputTokens).toLocaleString()}</b>
                      </div>
                      <div className="passport-detail-usage-row">
                        <span>Requests</span>
                        <b>{passport.totalRequests.toLocaleString()}</b>
                      </div>
                      <div className="passport-detail-usage-row">
                        <span>Last used</span>
                        <b>{passport.lastUsedAt ? new Date(passport.lastUsedAt).toLocaleString() : 'Never'}</b>
                      </div>
                    </div>
                    {showCopilotQuota && (
                      <div className="passport-detail-usage" style={{ marginTop: '10px' }}>
                        <div className="passport-detail-usage-row">
                          <span>Plan</span>
                          <b>{quota!.planName}</b>
                        </div>
                        {quota!.categories.map((cat) => (
                          <div key={cat.id} className="passport-detail-usage-row">
                            <span>{COPILOT_QUOTA_LABELS[cat.id] ?? cat.id}</span>
                            <b>{cat.unlimited ? 'Unlimited' : `${Math.round(cat.percentRemaining)}% remaining`}</b>
                          </div>
                        ))}
                        <div className="passport-detail-usage-row">
                          <span>Resets</span>
                          <b>{formatQuotaResetDate(quota!.resetDate)}</b>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="passport-btn-row is-split">
                    <button className="passport-btn is-danger" onClick={() => handleRemove(passport.id)}>
                      Remove
                    </button>
                    {passport.isActive ? (
                      <button className="passport-btn is-ghost" onClick={() => setDetailPassportId(null)}>
                        Close
                      </button>
                    ) : (
                      <button
                        className="passport-btn is-primary"
                        onClick={async () => {
                          await handleSetActive(passport.id)
                          setDetailPassportId(null)
                        }}
                      >
                        Set Active
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}
      </div>
    </div>
  )
}
