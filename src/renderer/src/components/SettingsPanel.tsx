import { useEffect, useState } from 'react'
import type { AuthStatus, DeviceCodeChallenge } from '../../../shared/types'

export function SettingsPanel(): JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<DeviceCodeChallenge | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)

  async function refresh(): Promise<void> {
    setStatus(await window.api.settings.getAuthStatus())
  }

  useEffect(() => {
    refresh()
    const unsubscribe = window.api.settings.onCopilotChallenge(setChallenge)
    return unsubscribe
  }, [])

  async function handleSaveKey(): Promise<void> {
    setError(null)
    const result = await window.api.settings.setAnthropicApiKey(apiKey)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setApiKey('')
    await refresh()
  }

  async function handleCopilotLogin(): Promise<void> {
    setLoggingIn(true)
    setChallenge(null)
    const result = await window.api.settings.loginCopilot()
    setLoggingIn(false)
    setChallenge(null)
    if (result.ok) await refresh()
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>Settings</h3>
      <section>
        <h4>Anthropic {status?.anthropic ? '✓ connected' : ''}</h4>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Anthropic API key"
        />
        <button onClick={handleSaveKey}>Save</button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </section>
      <section>
        <h4>GitHub Copilot {status?.copilot ? '✓ connected' : ''}</h4>
        <button onClick={handleCopilotLogin} disabled={loggingIn}>
          {loggingIn ? 'Signing in...' : 'Sign in'}
        </button>
        {challenge && (
          <div>
            Go to {challenge.verificationUri} and enter code: <strong>{challenge.userCode}</strong>
          </div>
        )}
      </section>
    </div>
  )
}
