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

/** Builds the prompt text for a turn that explicitly invokes a skill: the
 * skill's full instructions precede the user's own message, matching how an
 * explicitly-picked skill (as opposed to one the model discovers on its own)
 * is meant to apply for that turn. */
export async function buildSkillPrompt(skillFilePath: string, skillName: string, userText: string): Promise<string> {
  const content = await readFile(skillFilePath, 'utf-8')
  return `Use the "${skillName}" skill for this request. Its full instructions:\n\n${content}\n\n---\n\n${userText}`
}
