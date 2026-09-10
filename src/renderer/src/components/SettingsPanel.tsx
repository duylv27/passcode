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

// Official brand marks (single path each, from simple-icons -- CC0/MIT-style
// icon set built exactly for this kind of embedding), rendered with
// currentColor so they follow the surrounding text/icon-background color in
// both themes rather than carrying a fixed brand color that could clash.
const PROVIDER_ICON_PATHS: Record<string, string> = {
  anthropic:
    'M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z',
  // Google's provider here is specifically Gemini models, so the Gemini
  // sparkle mark is the more accurate brand identifier than the plain "G".
  google:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  'github-copilot':
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  'openai-codex':
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
}

function ProviderIcon({ providerId, size = 16 }: { providerId: string; size?: number }): JSX.Element {
  const path = PROVIDER_ICON_PATHS[providerId]
  if (!path) return <span>{'\u{1F511}'}</span>
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/** Visualizes Input/Output token split as a proportional bar instead of a
 * raw number -- optionally with a legend and cost total for a bigger,
 * standalone reading (the compact row usage just shows the bar + cost). */
function UsageBar({
  input,
  output,
  cost,
  showLegend = false
}: {
  input: number
  output: number
  cost: number
  showLegend?: boolean
}): JSX.Element {
  const total = input + output
  const inputPct = total > 0 ? (input / total) * 100 : 50
  return (
    <div className="passport-usage-chart">
      <div className="passport-usage-chart-bar">
        <span style={{ width: `${inputPct}%`, background: 'var(--accent)' }} />
        <span style={{ width: `${100 - inputPct}%`, background: 'var(--success)' }} />
      </div>
      {showLegend ? (
        <div className="passport-usage-chart-legend">
          <span>
            <i style={{ background: 'var(--accent)' }} /> Input {formatTokenCount(input)}
          </span>
          <span>
            <i style={{ background: 'var(--success)' }} /> Output {formatTokenCount(output)}
          </span>
          <span className="passport-usage-chart-cost">${cost.toFixed(2)}</span>
        </div>
      ) : (
        <span className="passport-usage-chart-cost">${cost.toFixed(2)}</span>
      )}
    </div>
  )
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
  // .passport-kebab-menu is position:fixed, anchored to the kebab button's
  // own viewport coordinates on open -- it used to be position:absolute
  // inside .settings-scroll-area, which clips any absolutely-positioned
  // descendant that overflows the scrollable viewport, cutting the menu off
  // for any row near the bottom of a long, scrolled list.
  const [menuAnchor, setMenuAnchor] = useState<{ id: string; top: number; left: number; openUpward: boolean } | null>(
    null
  )
  const ESTIMATED_MENU_HEIGHT = 110
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
  const [renamingPassportId, setRenamingPassportId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

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
    'github-copilot': 'GitHub Copilot',
    'openai-codex': 'ChatGPT'
  }
  const PROVIDERS_FOR_ADD = ['anthropic', 'google', 'github-copilot', 'openai-codex']
  const METHODS_FOR_PROVIDER: Record<string, { value: 'api_key' | 'oauth'; title: string; desc: string }[]> = {
    anthropic: [
      { value: 'oauth', title: 'Sign in with browser (Claude Pro/Max)', desc: 'Usage covered by your subscription' },
      { value: 'api_key', title: 'API Key', desc: 'Paste a key from console.anthropic.com' }
    ],
    google: [{ value: 'api_key', title: 'API Key', desc: 'Paste a key from Google AI Studio' }],
    'github-copilot': [{ value: 'oauth', title: 'Sign in with device code', desc: 'Authorize this app from github.com/login/device' }],
    'openai-codex': [
      { value: 'oauth', title: 'Sign in with browser (ChatGPT Plus/Pro)', desc: 'Usage covered by your ChatGPT subscription' }
    ]
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

  function displayNameFor(providerId: string, method: 'api_key' | 'oauth'): string {
    return method === 'oauth' ? `${PROVIDER_LABELS[providerId]} Sign-in` : `${PROVIDER_LABELS[providerId]} API Key`
  }

  async function handleAddContinue(): Promise<void> {
    if (addStep === 'provider' && addProviderId) {
      const methods = METHODS_FOR_PROVIDER[addProviderId] ?? []
      // Nothing to choose between -- skip straight past the Method step
      // rather than making the user click Continue on a single option.
      if (methods.length === 1) {
        setAddMethod(methods[0].value)
        setAddDisplayName(displayNameFor(addProviderId, methods[0].value))
        setAddStep('connect')
        return
      }
      setAddStep('method')
      return
    }
    if (addStep === 'method' && addMethod && addProviderId) {
      setAddDisplayName(displayNameFor(addProviderId, addMethod))
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
    setMenuAnchor(null)
    await window.api.passports.setActive(id)
    await refreshPassports()
  }

  function startRenamePassport(passport: Passport): void {
    setMenuAnchor(null)
    setRenameValue(passport.displayName)
    setRenamingPassportId(passport.id)
  }

  async function commitRenamePassport(passport: Passport): Promise<void> {
    const trimmed = renameValue.trim()
    setRenamingPassportId(null)
    if (!trimmed || trimmed === passport.displayName) return
    await window.api.passports.rename(passport.id, trimmed)
    await refreshPassports()
  }

  async function handleRemove(id: string): Promise<void> {
    setMenuAnchor(null)
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
              {passports.length > 0 &&
                (() => {
                  const totalInput = passports.reduce((sum, p) => sum + p.totalInputTokens, 0)
                  const totalOutput = passports.reduce((sum, p) => sum + p.totalOutputTokens, 0)
                  const totalCost = passports.reduce((sum, p) => sum + p.totalCost, 0)
                  const totalRequests = passports.reduce((sum, p) => sum + p.totalRequests, 0)
                  if (totalInput + totalOutput === 0) return null
                  return (
                    <div className="passport-overview">
                      <div className="passport-overview-label">
                        Overall usage · {totalRequests.toLocaleString()} {totalRequests === 1 ? 'request' : 'requests'}
                      </div>
                      <UsageBar input={totalInput} output={totalOutput} cost={totalCost} showLegend />
                    </div>
                  )
                })()}
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
                      <div className="passport-icon">
                        <ProviderIcon providerId={providerId} />
                      </div>
                      <div className="passport-main">
                        <div className="passport-name">
                          <span className={`passport-dot ${passport.isActive ? 'is-on' : 'is-off'}`} />
                          {renamingPassportId === passport.id ? (
                            <input
                              className="settings-input passport-rename-input"
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => commitRenamePassport(passport)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur()
                                if (e.key === 'Escape') setRenamingPassportId(null)
                              }}
                            />
                          ) : (
                            passport.displayName
                          )}
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
                          {passport.totalInputTokens + passport.totalOutputTokens > 0 && (
                            <UsageBar
                              input={passport.totalInputTokens}
                              output={passport.totalOutputTokens}
                              cost={passport.totalCost}
                            />
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
                        <button
                          className="passport-kebab"
                          onClick={(e) => {
                            if (menuAnchor?.id === passport.id) {
                              setMenuAnchor(null)
                              return
                            }
                            const rect = e.currentTarget.getBoundingClientRect()
                            const openUpward = rect.bottom + ESTIMATED_MENU_HEIGHT > window.innerHeight
                            setMenuAnchor({
                              id: passport.id,
                              left: rect.right,
                              top: openUpward ? rect.top : rect.bottom,
                              openUpward
                            })
                          }}
                        >
                          ⋯
                        </button>
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

        {menuAnchor &&
          (() => {
            const passport = passports.find((p) => p.id === menuAnchor.id)
            if (!passport) return null
            return (
              <>
                {/* Full-viewport click-catcher so clicking anywhere else closes the menu. */}
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                  onClick={() => setMenuAnchor(null)}
                />
                <div
                  className="passport-kebab-menu"
                  style={{
                    position: 'fixed',
                    left: menuAnchor.left,
                    top: menuAnchor.top,
                    transform: `translate(-100%, ${menuAnchor.openUpward ? '-100%' : '0'})`,
                    zIndex: 31
                  }}
                >
                  {!passport.isActive && <button onClick={() => handleSetActive(passport.id)}>Set Active</button>}
                  <button onClick={() => startRenamePassport(passport)}>Rename</button>
                  <button onClick={() => handleRemove(passport.id)}>Remove</button>
                </div>
              </>
            )
          })()}

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
                        style={{ alignItems: 'center' }}
                      >
                        <span
                          className="passport-icon"
                          style={{ width: 28, height: 28, flexShrink: 0, marginTop: 0 }}
                        >
                          <ProviderIcon providerId={providerId} size={14} />
                        </span>
                        <div className="passport-method-title" style={{ lineHeight: 1 }}>
                          {PROVIDER_LABELS[providerId]}
                        </div>
                        <span className="passport-radio" style={{ marginLeft: 'auto', marginTop: 0 }} />
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
                      <>
                        <label className="passport-field-label">Display name</label>
                        <input
                          className="settings-input"
                          style={{ width: '100%', marginBottom: '10px' }}
                          value={addDisplayName}
                          onChange={(e) => setAddDisplayName(e.target.value)}
                        />
                        <p className="settings-row-desc">Click Continue to start signing in.</p>
                      </>
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
                    onClick={() => {
                      const skippedMethodStep =
                        addStep === 'connect' && (METHODS_FOR_PROVIDER[addProviderId ?? '']?.length ?? 0) === 1
                      setAddStep(addStep === 'connect' && !skippedMethodStep ? 'method' : 'provider')
                    }}
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
                      {passport.totalInputTokens + passport.totalOutputTokens > 0 ? (
                        <UsageBar
                          input={passport.totalInputTokens}
                          output={passport.totalOutputTokens}
                          cost={passport.totalCost}
                          showLegend
                        />
                      ) : (
                        <div className="passport-detail-usage-row">
                          <span>Usage</span>
                          <b>No activity yet</b>
                        </div>
                      )}
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
