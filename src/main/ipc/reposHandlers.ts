import { basename } from 'node:path'
import type { ReposRepository } from '../db/reposRepository'
import type { AddRepoResult, AddRepoError, Repo } from '../../shared/types'

export interface ReposHandlers {
  addRepo(projectId: string, path: string): Promise<AddRepoResult | AddRepoError>
  listRepos(projectId: string): Repo[]
  deleteRepo(id: string): void
}

export function createReposHandlers(
  repo: ReposRepository,
  isGitRepo: (path: string) => Promise<boolean>
): ReposHandlers {
  return {
    async addRepo(projectId: string, path: string): Promise<AddRepoResult | AddRepoError> {
      const valid = await isGitRepo(path)
      if (!valid) {
        return { ok: false, error: `"${path}" is not a git repository` }
      }
      return { ok: true, repo: repo.create(projectId, path, basename(path)) }
    },
    listRepos(projectId: string): Repo[] {
      return repo.listByProject(projectId)
    },
    deleteRepo(id: string): void {
      repo.delete(id)
    }
  }
}
