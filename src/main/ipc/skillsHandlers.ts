import type { SkillInfo } from '../../shared/types'
import type { ReposRepository } from '../db/reposRepository'
import { listSkillsForRepo } from '../agent/skills'

export interface SkillsHandlers {
  listSkills(repoId: string): Promise<SkillInfo[]>
}

export function createSkillsHandlers(reposRepo: ReposRepository): SkillsHandlers {
  return {
    async listSkills(repoId: string): Promise<SkillInfo[]> {
      const repo = reposRepo.getById(repoId)
      if (!repo) return []
      return listSkillsForRepo(repo.path)
    }
  }
}
