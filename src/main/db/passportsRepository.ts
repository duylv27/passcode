import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Passport, PassportAuthMethod, PassportStatus } from '../../shared/types'

interface PassportRow {
  id: string
  provider_id: string
  auth_method: PassportAuthMethod
  display_name: string
  is_active: number
  credential_data: string | null
  status: PassportStatus
  last_validated_at: string | null
  total_input_tokens: number
  total_output_tokens: number
  total_requests: number
  last_used_at: string | null
  created_at: string
}

function rowToPassport(row: PassportRow): Passport {
  let apiKey: string | null = null
  if (row.credential_data) {
    try {
      const parsed = JSON.parse(row.credential_data) as { apiKey?: unknown }
      if (typeof parsed.apiKey === 'string') apiKey = parsed.apiKey
    } catch {
      apiKey = null
    }
  }
  return {
    id: row.id,
    providerId: row.provider_id,
    authMethod: row.auth_method,
    displayName: row.display_name,
    isActive: row.is_active === 1,
    apiKey,
    status: row.status,
    lastValidatedAt: row.last_validated_at,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalRequests: row.total_requests,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at
  }
}

export interface CreatePassportInput {
  providerId: string
  authMethod: PassportAuthMethod
  displayName: string
  apiKey: string | null
}

export interface PassportsRepository {
  create(input: CreatePassportInput): Passport
  list(): Passport[]
  getById(id: string): Passport | undefined
  /** Deactivates whatever passport is currently active for this passport's
   * provider (if any) and activates this one instead. */
  setActive(id: string): void
  rename(id: string, displayName: string): void
  remove(id: string): void
  updateStatus(id: string, status: PassportStatus): void
  recordUsageForActiveProvider(providerId: string, usage: { inputTokens: number; outputTokens: number }): void
}

export function createPassportsRepository(db: DatabaseSync): PassportsRepository {
  const SELECT_COLUMNS = `
    id, provider_id, auth_method, display_name, is_active, credential_data,
    status, last_validated_at, total_input_tokens, total_output_tokens,
    total_requests, last_used_at, created_at
  `

  return {
    create(input: CreatePassportInput): Passport {
      const id = randomUUID()
      const createdAt = new Date().toISOString()
      const credentialData = input.apiKey !== null ? JSON.stringify({ apiKey: input.apiKey }) : null
      // The first passport for a provider is active by default (there was
      // nothing to be active before it); a later one for the same provider
      // starts inactive so the unique index never has to reject an insert.
      const existingForProvider = db
        .prepare('SELECT COUNT(*) as count FROM passports WHERE provider_id = ?')
        .get(input.providerId) as { count: number }
      const isActive = existingForProvider.count === 0
      db.prepare(
        `INSERT INTO passports
          (id, provider_id, auth_method, display_name, is_active, credential_data, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?)`
      ).run(id, input.providerId, input.authMethod, input.displayName, isActive ? 1 : 0, credentialData, createdAt)
      return this.getById(id)!
    },
    list(): Passport[] {
      const rows = db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM passports ORDER BY created_at`)
        .all() as unknown as PassportRow[]
      return rows.map(rowToPassport)
    },
    getById(id: string): Passport | undefined {
      const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM passports WHERE id = ?`).get(id) as
        | PassportRow
        | undefined
      return row ? rowToPassport(row) : undefined
    },
    setActive(id: string): void {
      const target = db.prepare('SELECT provider_id FROM passports WHERE id = ?').get(id) as
        | { provider_id: string }
        | undefined
      if (!target) return
      // Both updates run in one transaction so the partial unique index
      // (at most one is_active=1 row per provider_id) is never violated
      // mid-way -- deactivate the old row before activating the new one.
      db.exec('BEGIN')
      try {
        db.prepare('UPDATE passports SET is_active = 0 WHERE provider_id = ? AND is_active = 1').run(
          target.provider_id
        )
        db.prepare('UPDATE passports SET is_active = 1 WHERE id = ?').run(id)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    rename(id: string, displayName: string): void {
      db.prepare('UPDATE passports SET display_name = ? WHERE id = ?').run(displayName, id)
    },
    remove(id: string): void {
      db.prepare('DELETE FROM passports WHERE id = ?').run(id)
    },
    updateStatus(id: string, status: PassportStatus): void {
      db.prepare('UPDATE passports SET status = ?, last_validated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        id
      )
    },
    recordUsageForActiveProvider(providerId: string, usage: { inputTokens: number; outputTokens: number }): void {
      db.prepare(
        `UPDATE passports
           SET total_input_tokens = total_input_tokens + ?,
               total_output_tokens = total_output_tokens + ?,
               total_requests = total_requests + 1,
               last_used_at = ?
         WHERE provider_id = ? AND is_active = 1`
      ).run(usage.inputTokens, usage.outputTokens, new Date().toISOString(), providerId)
    }
  }
}
