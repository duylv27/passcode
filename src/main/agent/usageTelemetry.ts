import { appendFile, open, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import type { TokenUsage, UsageTelemetryConfig } from '../../shared/types'

const APP_VERSION = process.env.npm_package_version ?? '0.0.0'

function resolveIdentity(): { userName: string; teamId?: string } {
  const raw = process.env.OTEL_RESOURCE_ATTRIBUTES
  const attrs: Record<string, string> = {}
  if (raw) {
    for (const pair of raw.split(',')) {
      const [key, value] = pair.split('=')
      if (key && value) attrs[key.trim()] = value.trim()
    }
  }
  let userName = attrs['user.name']
  if (!userName) {
    try {
      userName = userInfo().username
    } catch {
      userName = 'unknown'
    }
  }
  return { userName, teamId: attrs['team.id'] }
}

/** Validates that a usage-telemetry config's output path is actually
 * writable, without leaving any content behind -- opens the file in
 * append mode (creating it if it doesn't exist, exactly like a real
 * write would) and immediately closes it. Used when the user saves the
 * setting in the UI, so a typo'd path or a missing directory surfaces
 * as an immediate, specific error instead of silently persisting a
 * config that will never actually write anything.
 *
 * Directories get an explicit check before the open/close probe: on
 * Windows (and some other platforms), `open(dirPath, 'a')` succeeds --
 * opening a directory for append doesn't fail until the first actual
 * write does, with an EISDIR error the probe would otherwise never see. */
export async function probeUsageTelemetryPath(
  config: UsageTelemetryConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!config.enabled) return { ok: true }
  if (!config.outputPath) return { ok: false, error: 'Enter a file path to enable usage telemetry.' }
  try {
    const stats = await stat(config.outputPath).catch(() => null)
    if (stats?.isDirectory()) {
      return {
        ok: false,
        error: `"${config.outputPath}" is a directory, not a file. Include a filename, e.g. "${config.outputPath}\\copilot-working.jsonl".`
      }
    }
    const handle = await open(config.outputPath, 'a')
    await handle.close()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

/** Appends one OpenTelemetry-shaped log record for a single real LLM
 * inference call, matching the exact JSON shape VS Code's Copilot Chat
 * extension already writes to its own OTel export file -- so an existing
 * external aggregator (Export-CopilotTokens.ps1) picks these records up
 * with zero changes on its side. Fire-and-forget: this never throws to
 * its caller, and every failure (disabled, unset path, write error) is
 * either a silent no-op or a console.warn, never a rejection the caller
 * has to handle. */
export function appendUsageTelemetryRecord(
  config: UsageTelemetryConfig,
  params: { model: { provider: string; id: string; name: string }; usage: TokenUsage; sessionId: string }
): void {
  if (!config.enabled || !config.outputPath) return

  try {
    const now = Date.now()
    const hrTime: [number, number] = [Math.floor(now / 1000), (now % 1000) * 1_000_000]
    const { userName, teamId } = resolveIdentity()

    const rawAttributes: [string, string][] = [
      ['service.name', 'passcode-desktop'],
      ['service.version', APP_VERSION],
      ['session.id', params.sessionId],
      ['user.name', userName]
    ]
    if (teamId) rawAttributes.push(['team.id', teamId])

    const record = {
      hrTime,
      hrTimeObserved: hrTime,
      resource: { _rawAttributes: rawAttributes },
      instrumentationScope: { name: 'passcode-desktop', version: APP_VERSION },
      attributes: {
        'event.name': 'gen_ai.client.inference.operation.details',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': params.model.id,
        'gen_ai.response.model': params.model.id,
        'gen_ai.response.id': randomUUID(),
        'gen_ai.usage.input_tokens': params.usage.input,
        'gen_ai.usage.output_tokens': params.usage.output,
        'gen_ai.usage.cache_read_input_tokens': params.usage.cacheRead,
        'gen_ai.usage.cache_creation_input_tokens': params.usage.cacheWrite
      },
      _body: `GenAI inference: ${params.model.id}`
    }

    void appendFile(config.outputPath, JSON.stringify(record) + '\n', 'utf-8').catch((err) => {
      console.warn('[usageTelemetry] failed to write usage record:', err)
    })
  } catch (err) {
    console.warn('[usageTelemetry] failed to build usage record:', err)
  }
}
