import type { DatabaseSync } from 'node:sqlite'
import type { ToolApprovalPolicy } from '../../shared/types'

const POLICY_KEY = 'toolApprovalPolicy'

export const DEFAULT_TOOL_APPROVAL_POLICY: ToolApprovalPolicy = {
  autoApprove: {
    read: true,
    grep: true,
    find: true,
    ls: true,
    bash: false,
    powershell: false,
    edit: false,
    write: false
  }
}

export interface AppSettingsRepository {
  getToolApprovalPolicy(): ToolApprovalPolicy
  setToolApprovalPolicy(policy: ToolApprovalPolicy): void
}

export function createAppSettingsRepository(db: DatabaseSync): AppSettingsRepository {
  return {
    getToolApprovalPolicy(): ToolApprovalPolicy {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(POLICY_KEY) as
        | { value: string }
        | undefined
      if (!row) return DEFAULT_TOOL_APPROVAL_POLICY
      try {
        const parsed = JSON.parse(row.value) as Partial<ToolApprovalPolicy>
        return {
          autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, ...parsed.autoApprove }
        }
      } catch {
        return DEFAULT_TOOL_APPROVAL_POLICY
      }
    },
    setToolApprovalPolicy(policy: ToolApprovalPolicy): void {
      db.prepare(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).run(POLICY_KEY, JSON.stringify(policy))
    }
  }
}
