import { readFile } from 'node:fs/promises'
import type { PromptOptions } from '../../shared/types'
import { buildSkillPrompt } from './skills'

/** Combines the user's typed message with an attached file's content and/or
 * an explicitly-picked skill's instructions, in that order, into the single
 * text sent to the model. */
export async function buildPromptText(text: string, options?: PromptOptions): Promise<string> {
  let result = text

  if (options?.attachedFilePath) {
    try {
      const content = await readFile(options.attachedFilePath, 'utf-8')
      result = `Attached file: ${options.attachedFilePath}\n\n\`\`\`\n${content}\n\`\`\`\n\n---\n\n${result}`
    } catch (err) {
      result = `[Could not read attached file "${options.attachedFilePath}": ${(err as Error).message}]\n\n${result}`
    }
  }

  if (options?.skillFilePath && options.skillName) {
    result = await buildSkillPrompt(options.skillFilePath, options.skillName, result)
  }

  return result
}
