import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPromptText, PROMPT_CONTEXT_DELIMITER } from '../../../src/main/agent/promptBuilder'

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

  it("puts an attached file's content after the delimiter, keeping the label as the plain text", async () => {
    const filePath = join(dir, 'notes.txt')
    writeFileSync(filePath, 'line one\nline two')

    const result = await buildPromptText('summarize this', { attachedFilePath: filePath })
    const [label, context] = result.split(PROMPT_CONTEXT_DELIMITER)

    expect(label).toBe('summarize this')
    expect(context).toContain(filePath)
    expect(context).toContain('line one\nline two')
  })

  it('falls back to a bracketed error note in the context when the attached file cannot be read', async () => {
    const missingPath = join(dir, 'missing.txt')

    const result = await buildPromptText('summarize this', { attachedFilePath: missingPath })
    const [label, context] = result.split(PROMPT_CONTEXT_DELIMITER)

    expect(label).toBe('summarize this')
    expect(context).toContain('Could not read attached file')
  })

  it('labels a skill-invoked turn as "/skill-name text" and puts the full instructions after the delimiter', async () => {
    const filePath = join(dir, 'SKILL.md')
    writeFileSync(filePath, '---\nname: reviewer\ndescription: reviews code\n---\n\nCheck for bugs.')

    const result = await buildPromptText('look at this diff', { skillFilePath: filePath, skillName: 'reviewer' })
    const [label, context] = result.split(PROMPT_CONTEXT_DELIMITER)

    expect(label).toBe('/reviewer look at this diff')
    expect(context).toContain('Use the "reviewer" skill')
    expect(context).toContain('Check for bugs.')
  })

  it('includes both the attachment and the skill instructions in the context when both are given', async () => {
    const attachPath = join(dir, 'notes.txt')
    writeFileSync(attachPath, 'context notes')
    const skillPath = join(dir, 'SKILL.md')
    writeFileSync(skillPath, '---\nname: reviewer\ndescription: reviews code\n---\n\nCheck for bugs.')

    const result = await buildPromptText('look at this', {
      attachedFilePath: attachPath,
      skillFilePath: skillPath,
      skillName: 'reviewer'
    })
    const [label, context] = result.split(PROMPT_CONTEXT_DELIMITER)

    expect(label).toBe('/reviewer look at this')
    expect(context).toContain('context notes')
    expect(context).toContain('Check for bugs.')
  })
})
