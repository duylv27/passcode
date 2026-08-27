import { getGitStatus } from '../git/gitStatus'
import type { ReposRepository } from '../db/reposRepository'
import type { GitStatus } from '../../shared/types'

export interface GitHandlers {
  status(repoId: string): Promise<GitStatus>
}

export function createGitHandlers(reposRepo: ReposRepository): GitHandlers {
  return {
    async status(repoId: string): Promise<GitStatus> {
      const repo = reposRepo.getById(repoId)
      if (!repo) throw new Error(`Unknown repo: ${repoId}`)
      return getGitStatus(repo.path)
    }
  }
}
