/** Live key validation for providers whose SDK definition doesn't implement
 * an `auth.apiKey.check` hook -- @earendil-works/pi-ai's checkAuth() only
 * confirms *a* key is stored for Anthropic/Google, never that it actually
 * works, so a typo'd or revoked key otherwise shows "Connected" until the
 * first real prompt fails. These make one cheap authenticated call each,
 * before the key is ever persisted via setRuntimeApiKey. */

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string }
    const message = typeof body.error === 'string' ? body.error : body.error?.message
    if (message) return message
  } catch {
    // response body wasn't JSON (or was empty) -- fall through to the status line
  }
  return `${response.status} ${response.statusText}`
}

export async function validateAnthropicApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(8000)
    })
    if (response.ok) return { ok: true }
    return { ok: false, error: `Anthropic rejected this key: ${await parseErrorMessage(response)}` }
  } catch (err) {
    return { ok: false, error: `Couldn't verify this key: ${(err as Error).message}` }
  }
}

export async function validateGeminiApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(apiKey)}`
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (response.ok) return { ok: true }
    return { ok: false, error: `Gemini rejected this key: ${await parseErrorMessage(response)}` }
  } catch (err) {
    return { ok: false, error: `Couldn't verify this key: ${(err as Error).message}` }
  }
}
