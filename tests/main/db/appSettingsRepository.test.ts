import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import {
  createAppSettingsRepository,
  DEFAULT_TOOL_APPROVAL_POLICY,
  type AppSettingsRepository
} from '../../../src/main/db/appSettingsRepository'

describe('AppSettingsRepository', () => {
  let repo: AppSettingsRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    repo = createAppSettingsRepository(db)
  })

  it('returns the default tool approval policy when none has been saved', () => {
    expect(repo.getToolApprovalPolicy()).toEqual(DEFAULT_TOOL_APPROVAL_POLICY)
  })

  it('persists and retrieves a saved tool approval policy', () => {
    const policy = { autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, bash: true } }
    repo.setToolApprovalPolicy(policy)
    expect(repo.getToolApprovalPolicy()).toEqual(policy)
  })

  it('overwrites a previously saved policy rather than duplicating it', () => {
    repo.setToolApprovalPolicy({ autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, bash: true } })
    repo.setToolApprovalPolicy({ autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, write: true } })
    const policy = repo.getToolApprovalPolicy()
    expect(policy.autoApprove.bash).toBe(false)
    expect(policy.autoApprove.write).toBe(true)
  })

  it('fills in missing tool keys from the default when reading a partial saved policy', () => {
    repo.setToolApprovalPolicy({ autoApprove: { bash: true } })
    expect(repo.getToolApprovalPolicy()).toEqual({
      autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, bash: true }
    })
  })
})
