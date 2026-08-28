import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { SkillInfo } from '../../shared/types'

/** User-root skill directories beyond the SDK's own default (~/.pi/agent/skills)
 * -- Claude Code's and GitHub Copilot's own per-user skill folders, both using
 * the same SKILL.md "Agent Skills" format our SDK already parses. Missing
 * directories are skipped silently by the SDK's loader, so no existence check
 * is needed here. */
export function getAdditionalSkillPaths(): string[] {
  return [join(homedir(), '.claude', 'skills'), join(homedir(), '.copilot', 'skills')]
}

export async function listSkillsForRepo(cwd: string): Promise<SkillInfo[]> {
  const { loadSkills, getAgentDir } = await import('@earendil-works/pi-coding-agent')
  const { skills } = loadSkills({
    cwd,
    agentDir: getAgentDir(),
    skillPaths: getAdditionalSkillPaths(),
    includeDefaults: true
  })
  return skills.map((s) => ({ name: s.name, description: s.description, filePath: s.filePath }))
}

/** Reads a skill's SKILL.md content, for injecting into a prompt when the
 * skill was explicitly picked rather than left for the model to discover. */
export async function readSkillFile(skillFilePath: string): Promise<string> {
  return readFile(skillFilePath, 'utf-8')
}
