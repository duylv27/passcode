import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import {
  createAppSettingsRepository,
  DEFAULT_TOOL_APPROVAL_POLICY,
  DEFAULT_USAGE_TELEMETRY_CONFIG,
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

  it('returns the default usage telemetry config when none has been saved', () => {
    expect(repo.getUsageTelemetryConfig()).toEqual(DEFAULT_USAGE_TELEMETRY_CONFIG)
  })

  it('persists and retrieves a saved usage telemetry config', () => {
    const config = { enabled: true, outputPath: 'C:/Code/.telemetry/copilot-working.jsonl' }
    repo.setUsageTelemetryConfig(config)
    expect(repo.getUsageTelemetryConfig()).toEqual(config)
  })

  it('overwrites a previously saved usage telemetry config rather than duplicating it', () => {
    repo.setUsageTelemetryConfig({ enabled: true, outputPath: '/first/path.jsonl' })
    repo.setUsageTelemetryConfig({ enabled: false, outputPath: '/second/path.jsonl' })
    expect(repo.getUsageTelemetryConfig()).toEqual({ enabled: false, outputPath: '/second/path.jsonl' })
  })

  it('does not let a saved usage telemetry config leak into the tool approval policy or vice versa', () => {
    repo.setToolApprovalPolicy({ autoApprove: { bash: true } })
    repo.setUsageTelemetryConfig({ enabled: true, outputPath: '/x.jsonl' })
    expect(repo.getToolApprovalPolicy()).toEqual({
      autoApprove: { ...DEFAULT_TOOL_APPROVAL_POLICY.autoApprove, bash: true }
    })
    expect(repo.getUsageTelemetryConfig()).toEqual({ enabled: true, outputPath: '/x.jsonl' })
  })
})
