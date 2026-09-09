import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { SkillInfo, SkillSource } from '../../shared/types'

const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills')
const COPILOT_SKILLS_DIR = join(homedir(), '.copilot', 'skills')

/** User-root skill directories beyond the SDK's own default (~/.pi/agent/skills)
 * -- Claude Code's and GitHub Copilot's own per-user skill folders, both using
 * the same SKILL.md "Agent Skills" format our SDK already parses. Missing
 * directories are skipped silently by the SDK's loader, so no existence check
 * is needed here. */
export function getAdditionalSkillPaths(): string[] {
  return [CLAUDE_SKILLS_DIR, COPILOT_SKILLS_DIR]
}

function isUnder(filePath: string, dir: string): boolean {
  // Case-insensitive since Windows paths are case-insensitive and this is
  // only a display label, not a security check.
  const normalizedPath = resolve(filePath).toLowerCase()
  const normalizedDir = resolve(dir).toLowerCase()
  return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + sep)
}

/** Classifies a skill by which of the scanned directories its file lives
 * under, so the picker can show the user where a skill came from -- useful
 * once Claude Code's/Copilot's/a project's/the global skill set can
 * silently collide on a name and one wins over another. */
function classifySkillSource(filePath: string, cwd: string, agentDir: string): SkillSource {
  if (isUnder(filePath, CLAUDE_SKILLS_DIR)) return 'claude'
  if (isUnder(filePath, COPILOT_SKILLS_DIR)) return 'copilot'
  if (isUnder(filePath, join(agentDir, 'skills'))) return 'pi'
  if (isUnder(filePath, join(cwd, '.pi', 'skills'))) return 'project'
  return 'other'
}

export async function listSkillsForRepo(cwd: string): Promise<SkillInfo[]> {
  const { loadSkills, getAgentDir } = await import('@earendil-works/pi-coding-agent')
  const agentDir = getAgentDir()
  const { skills } = loadSkills({
    cwd,
    agentDir,
    skillPaths: getAdditionalSkillPaths(),
    includeDefaults: true
  })
  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    filePath: s.filePath,
    source: classifySkillSource(s.filePath, cwd, agentDir)
  }))
}

/** Reads a skill's SKILL.md content, for injecting into a prompt when the
 * skill was explicitly picked rather than left for the model to discover. */
export async function readSkillFile(skillFilePath: string): Promise<string> {
  return readFile(skillFilePath, 'utf-8')
}
