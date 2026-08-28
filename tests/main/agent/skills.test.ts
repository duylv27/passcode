import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const loadSkillsMock = vi.fn(() => ({ skills: [], diagnostics: [] }))
const getAgentDirMock = vi.fn(() => '/fake/agent/dir')

vi.mock('@earendil-works/pi-coding-agent', () => ({
  loadSkills: loadSkillsMock,
  getAgentDir: getAgentDirMock
}))

import { getAdditionalSkillPaths, readSkillFile, listSkillsForRepo } from '../../../src/main/agent/skills'

describe('getAdditionalSkillPaths', () => {
  it('points at both the Claude and Copilot per-user skill directories', () => {
    const paths = getAdditionalSkillPaths()
    expect(paths).toEqual([join(homedir(), '.claude', 'skills'), join(homedir(), '.copilot', 'skills')])
  })
})

describe('readSkillFile', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-agent-skill-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the raw content of the skill file', async () => {
    const filePath = join(dir, 'SKILL.md')
    writeFileSync(filePath, '---\nname: my-skill\ndescription: does a thing\n---\n\nDo the thing carefully.')

    const content = await readSkillFile(filePath)

    expect(content).toContain('Do the thing carefully.')
  })
})

describe('listSkillsForRepo', () => {
  beforeEach(() => {
    loadSkillsMock.mockClear()
    loadSkillsMock.mockReturnValue({
      skills: [
        {
          name: 'my-skill',
          description: 'A project skill for testing.',
          filePath: '/repo/.pi/skills/my-skill/SKILL.md',
          baseDir: '/repo/.pi/skills/my-skill',
          sourceInfo: {},
          disableModelInvocation: false
        }
      ],
      diagnostics: []
    })
  })

  it('loads skills for the given repo cwd, including the Claude/Copilot user directories', async () => {
    const skills = await listSkillsForRepo('/repo')

    expect(loadSkillsMock).toHaveBeenCalledWith({
      cwd: '/repo',
      agentDir: '/fake/agent/dir',
      skillPaths: [join(homedir(), '.claude', 'skills'), join(homedir(), '.copilot', 'skills')],
      includeDefaults: true
    })
    expect(skills).toEqual([
      { name: 'my-skill', description: 'A project skill for testing.', filePath: '/repo/.pi/skills/my-skill/SKILL.md' }
    ])
  })
})
