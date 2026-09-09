import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appendUsageTelemetryRecord, probeUsageTelemetryPath } from '../../../src/main/agent/usageTelemetry'

describe('appendUsageTelemetryRecord', () => {
  let dir: string
  let outputPath: string
  const originalEnv = process.env.OTEL_RESOURCE_ATTRIBUTES

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'usage-telemetry-test-'))
    outputPath = join(dir, 'usage.jsonl')
    delete process.env.OTEL_RESOURCE_ATTRIBUTES
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    if (originalEnv === undefined) delete process.env.OTEL_RESOURCE_ATTRIBUTES
    else process.env.OTEL_RESOURCE_ATTRIBUTES = originalEnv
  })

  // appendUsageTelemetryRecord writes fire-and-forget (it's a sync-signature,
  // async-internally function) -- these tests give the microtask/IO queue a
  // moment to flush before asserting on the file.
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  it('does not write anything when disabled', async () => {
    appendUsageTelemetryRecord(
      { enabled: false, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()
    expect(() => readFileSync(outputPath, 'utf-8')).toThrow()
  })

  it('does not write anything when enabled but no output path is set', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath: '' },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()
    expect(() => readFileSync(outputPath, 'utf-8')).toThrow()
  })

  it('appends one correctly-shaped JSON line when enabled with a valid path', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 12345, output: 678, cacheRead: 0, cacheWrite: 0 }, sessionId: 'session-abc' }
    )
    await flush()

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const record = JSON.parse(lines[0])

    expect(Array.isArray(record.hrTime)).toBe(true)
    expect(record.hrTime).toHaveLength(2)
    expect(record.hrTime[0]).toBeGreaterThan(1_700_000_000)
    expect(record.hrTime[0]).toBeLessThan(Date.now() / 1000 + 5)
    expect(record.hrTime[1]).toBeLessThan(1_000_000_000)
    expect(record.attributes['event.name']).toBe('gen_ai.client.inference.operation.details')
    expect(record.attributes['gen_ai.operation.name']).toBe('chat')
    expect(record.resource._rawAttributes).toContainEqual(['service.name', 'passcode-desktop'])
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(rawAttrs['session.id']).toBe('session-abc')
    expect(record.attributes['gen_ai.request.model']).toBe('claude-opus-4-5')
    expect(record.attributes['gen_ai.response.model']).toBe('claude-opus-4-5')
    expect(record.attributes['gen_ai.usage.input_tokens']).toBe(12345)
    expect(record.attributes['gen_ai.usage.output_tokens']).toBe(678)
    expect(typeof record.attributes['gen_ai.response.id']).toBe('string')
    expect(record.attributes['gen_ai.response.id'].length).toBeGreaterThan(0)
  })

  it('appends multiple records across multiple calls (one line each)', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('populates user.name and team.id from OTEL_RESOURCE_ATTRIBUTES when set', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'user.name=duylv-epam,team.id=skii-epam'
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(rawAttrs['user.name']).toBe('duylv-epam')
    expect(rawAttrs['team.id']).toBe('skii-epam')
  })

  it('falls back to the OS username and omits team.id when OTEL_RESOURCE_ATTRIBUTES is unset', async () => {
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const keys = record.resource._rawAttributes.map((pair: [string, string]) => pair[0])
    expect(keys).toContain('user.name')
    expect(keys).not.toContain('team.id')
  })

  it('falls back gracefully on a malformed OTEL_RESOURCE_ATTRIBUTES value', async () => {
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'not-a-valid-format;;;'
    appendUsageTelemetryRecord(
      { enabled: true, outputPath },
      { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
    )
    await flush()

    // Must not throw and must still produce a valid record with a fallback user.name.
    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    const rawAttrs = Object.fromEntries(record.resource._rawAttributes)
    expect(typeof rawAttrs['user.name']).toBe('string')
    expect(rawAttrs['user.name'].length).toBeGreaterThan(0)
  })

  it('does not throw when the output path is unwritable', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      appendUsageTelemetryRecord(
        { enabled: true, outputPath: join(dir, 'does', 'not', 'exist', 'usage.jsonl') },
        { model: { provider: 'anthropic', id: 'claude-opus-4-5', name: 'Claude Opus 4.5' }, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, sessionId: 's1' }
      )
    ).not.toThrow()
    await flush()
    expect(consoleWarn).toHaveBeenCalled()
    consoleWarn.mockRestore()
  })
})

describe('probeUsageTelemetryPath', () => {
  let dir: string
  let outputPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'usage-telemetry-probe-test-'))
    outputPath = join(dir, 'probe.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns ok without touching the filesystem when disabled', async () => {
    const result = await probeUsageTelemetryPath({ enabled: false, outputPath: '' })
    expect(result).toEqual({ ok: true })
    expect(() => readFileSync(outputPath, 'utf-8')).toThrow()
  })

  it('returns an error when enabled with no output path', async () => {
    const result = await probeUsageTelemetryPath({ enabled: true, outputPath: '' })
    expect(result.ok).toBe(false)
  })

  it('returns ok and does not write any content for a valid, writable path', async () => {
    const result = await probeUsageTelemetryPath({ enabled: true, outputPath })
    expect(result).toEqual({ ok: true })
    expect(readFileSync(outputPath, 'utf-8')).toBe('')
  })

  it('returns an error when the path points at a directory instead of a file', async () => {
    // Regression test: open(dirPath, 'a') succeeds on Windows -- the
    // EISDIR error only surfaces on the actual write -- so this case
    // needs an explicit isDirectory() check, not just open+close.
    const result = await probeUsageTelemetryPath({ enabled: true, outputPath: dir })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('directory')
  })

  it('returns an error for a path whose parent directory does not exist', async () => {
    const result = await probeUsageTelemetryPath({
      enabled: true,
      outputPath: join(dir, 'does', 'not', 'exist', 'usage.jsonl')
    })
    expect(result.ok).toBe(false)
  })
})
