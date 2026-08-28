import { readFile } from 'node:fs/promises'
import type { PromptOptions } from '../../shared/types'
import { readSkillFile } from './skills'

/** Separates the short, human-readable label (what the transcript should
 * show for this turn) from any injected context that follows it in the
 * text actually sent to the model. History reconstruction splits on this
 * to display just the label instead of the full injected content. */
export const PROMPT_CONTEXT_DELIMITER = '\n\n<<<pi-agent-context>>>\n\n'

/** Builds what's actually sent to the model for a turn: a short label
 * (the skill reference plus the user's own text, e.g. "/code-review look
 * at this diff") followed by the delimiter and any injected context -- an
 * attached file's content, a picked skill's full instructions. */
export async function buildPromptText(text: string, options?: PromptOptions): Promise<string> {
  const label = options?.skillName ? `/${options.skillName} ${text}` : text
  const contextParts: string[] = []

  if (options?.attachedFilePath) {
    try {
      const content = await readFile(options.attachedFilePath, 'utf-8')
      contextParts.push(`Attached file: ${options.attachedFilePath}\n\n\`\`\`\n${content}\n\`\`\``)
    } catch (err) {
      contextParts.push(`[Could not read attached file "${options.attachedFilePath}": ${(err as Error).message}]`)
    }
  }

  if (options?.skillFilePath && options.skillName) {
    const skillContent = await readSkillFile(options.skillFilePath)
    contextParts.push(`Use the "${options.skillName}" skill for this request. Its full instructions:\n\n${skillContent}`)
  }

  if (contextParts.length === 0) return text

  return `${label}${PROMPT_CONTEXT_DELIMITER}${contextParts.join('\n\n---\n\n')}\n\n---\n\n${text}`
}
