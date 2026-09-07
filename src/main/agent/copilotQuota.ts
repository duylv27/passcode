import type { Credential } from '@earendil-works/pi-ai'
import type { CopilotQuota, CopilotQuotaCategory } from '../../shared/types'

// Matches the headers the SDK's own Copilot token-refresh call sends to
// this same endpoint (`@earendil-works/pi-ai`'s github-copilot.js) --
// duplicated here rather than imported since that module doesn't export
// them, and this is a small, stable constant.
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat'
}

const QUOTA_CATEGORY_IDS = ['chat', 'completions', 'premium_interactions'] as const

function hostnameFromEnterpriseUrl(enterpriseUrl: unknown): string | null {
  if (typeof enterpriseUrl !== 'string' || !enterpriseUrl.trim()) return null
  try {
    const url = enterpriseUrl.includes('://') ? new URL(enterpriseUrl) : new URL(`https://${enterpriseUrl}`)
    return url.hostname
  } catch {
    return null
  }
}

/** Fetches account/quota info from GitHub Copilot's internal user-info
 * endpoint (`/copilot_internal/user`) -- a separate, richer endpoint from
 * the token-exchange call (`/copilot_internal/v2/token`) the SDK already
 * makes internally to mint the short-lived Copilot API token. The token
 * endpoint's response carries no quota data at all; this endpoint is
 * where `quota_snapshots`, `copilot_plan`, and `quota_reset_date_utc`
 * actually live. Authenticated the same way (the stored GitHub OAuth
 * refresh token as bearer). Every failure path returns null -- this is
 * enrichment info, never something that should throw to its caller. */
export async function fetchCopilotQuota(): Promise<CopilotQuota | null> {
  // @earendil-works/pi-coding-agent is ESM-only (no "require" export
  // condition), so it must be dynamically imported from this CJS-bundled
  // main-process module -- a static top-level import compiles to a
  // require() call here and crashes at startup with
  // ERR_PACKAGE_PATH_NOT_EXPORTED. See piSession.ts for the same pattern.
  let credential: Credential | undefined
  try {
    const { readStoredCredential } = await import('@earendil-works/pi-coding-agent')
    credential = readStoredCredential('github-copilot')
  } catch (err) {
    console.warn('[copilotQuota] failed to read stored credential:', err)
    return null
  }
  if (!credential || credential.type !== 'oauth' || typeof credential.refresh !== 'string') return null

  const domain = hostnameFromEnterpriseUrl((credential as { enterpriseUrl?: unknown }).enterpriseUrl) ?? 'github.com'
  const url = `https://api.${domain}/copilot_internal/user`

  let raw: unknown
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.refresh}`,
        ...COPILOT_HEADERS
      },
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) {
      console.warn('[copilotQuota] non-OK response:', response.status, response.statusText)
      return null
    }
    raw = await response.json()
  } catch (err) {
    console.warn('[copilotQuota] failed to fetch quota:', err)
    return null
  }

  return parseCopilotQuota(raw)
}

function parseCopilotQuota(raw: unknown): CopilotQuota | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const snapshots = data.quota_snapshots
  if (!snapshots || typeof snapshots !== 'object' || Array.isArray(snapshots)) return null

  const categories: CopilotQuotaCategory[] = []
  for (const id of QUOTA_CATEGORY_IDS) {
    const category = parseCategory(id, (snapshots as Record<string, unknown>)[id])
    if (category) categories.push(category)
  }
  if (categories.length === 0) return null

  return {
    planName: typeof data.copilot_plan === 'string' ? data.copilot_plan : 'unknown',
    resetDate: typeof data.quota_reset_date_utc === 'string' ? data.quota_reset_date_utc : '',
    categories
  }
}

function parseCategory(id: string, raw: unknown): CopilotQuotaCategory | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Record<string, unknown>
  if (
    typeof c.unlimited !== 'boolean' ||
    typeof c.remaining !== 'number' ||
    typeof c.entitlement !== 'number' ||
    typeof c.percent_remaining !== 'number' ||
    typeof c.overage_count !== 'number' ||
    typeof c.overage_permitted !== 'boolean'
  ) {
    return null
  }
  return {
    id,
    unlimited: c.unlimited,
    remaining: c.remaining,
    entitlement: c.entitlement,
    percentRemaining: c.percent_remaining,
    overageCount: c.overage_count,
    overagePermitted: c.overage_permitted
  }
}
