import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPromptText } from '../../../src/main/agent/promptBuilder'

describe('buildPromptText', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-agent-prompt-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the text unchanged when no options are given', async () => {
    expect(await buildPromptText('hello')).toBe('hello')
  })

  it('prepends an attached file\'s content before the user text', async () => {
    const filePath = join(dir, 'notes.txt')
    writeFileSync(filePath, 'line one\nline two')

    const result = await buildPromptText('summarize this', { attachedFilePath: filePath })

    expect(result).toContain(filePath)
    expect(result).toContain('line one\nline two')
    expect(result.endsWith('summarize this')).toBe(true)
  })

  it('falls back to a bracketed error note when the attached file cannot be read', async () => {
    const missingPath = join(dir, 'missing.txt')

    const result = await buildPromptText('summarize this', { attachedFilePath: missingPath })

    expect(result).toContain('Could not read attached file')
    expect(result.endsWith('summarize this')).toBe(true)
  })

  it('wraps the text in the skill\'s instructions when a skill is picked', async () => {
    const filePath = join(dir, 'SKILL.md')
    writeFileSync(filePath, '---\nname: reviewer\ndescription: reviews code\n---\n\nCheck for bugs.')

    const result = await buildPromptText('look at this diff', { skillFilePath: filePath, skillName: 'reviewer' })

    expect(result).toContain('Use the "reviewer" skill')
    expect(result).toContain('Check for bugs.')
    expect(result.endsWith('look at this diff')).toBe(true)
  })

  it('applies the attachment first and the skill wrapper around the whole result', async () => {
    const attachPath = join(dir, 'notes.txt')
    writeFileSync(attachPath, 'context notes')
    const skillPath = join(dir, 'SKILL.md')
    writeFileSync(skillPath, '---\nname: reviewer\ndescription: reviews code\n---\n\nCheck for bugs.')

    const result = await buildPromptText('look at this', {
      attachedFilePath: attachPath,
      skillFilePath: skillPath,
      skillName: 'reviewer'
    })

    const skillWrapperIndex = result.indexOf('Use the "reviewer" skill')
    const attachmentIndex = result.indexOf('context notes')
    expect(skillWrapperIndex).toBeGreaterThanOrEqual(0)
    expect(attachmentIndex).toBeGreaterThan(skillWrapperIndex)
    expect(result.endsWith('look at this')).toBe(true)
  })
})
