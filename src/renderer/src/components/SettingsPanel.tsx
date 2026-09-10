import { useEffect, useState } from 'react'
import type { ToolApprovalPolicy, UsageTelemetryConfig } from '../../../shared/types'
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

// The 'providers' section (Anthropic/Gemini API key fields, Copilot device
// sign-in, quota) was retired here -- Passports now owns provider
// credential management via the passports:* IPC surface (see
// src/main/ipc/passportHandlers.ts). Its replacement panel lands in a
// later task; this file only keeps the sections that don't depend on the
// four retired settings:* auth channels.
type Section = 'general' | 'permissions'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'general', label: 'General' },
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

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<Section>('general')
  const [policy, setPolicy] = useState<ToolApprovalPolicy | null>(null)
  const [theme, setTheme] = useTheme()
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

  useEffect(() => {
    window.api.approvals.getPolicy().then(setPolicy)
    window.api.settings.getUsageTelemetryConfig().then((config) => {
      setTelemetryConfig(config)
      setTelemetryPathDraft(config.outputPath)
    })
  }, [])

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
