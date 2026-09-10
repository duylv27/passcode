import simpleGit from 'simple-git'
import type { ReposRepository } from '../db/reposRepository'

export interface FilesHandlersDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  showOpenFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface FilesHandlers {
  pickFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
  listRepoFiles(repoId: string): Promise<string[]>
}

export function createFilesHandlers(deps: FilesHandlersDeps, reposRepo: ReposRepository): FilesHandlers {
  return {
    async pickFile(): Promise<string | null> {
      const result = await deps.showOpenDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    async pickFolder(): Promise<string | null> {
      const result = await deps.showOpenFolderDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    async listRepoFiles(repoId: string): Promise<string[]> {
      const repo = reposRepo.getById(repoId)
      if (!repo) return []
      try {
        // --cached (tracked) + --others --exclude-standard (untracked but
        // not gitignored) gives every file a user would actually want to
        // attach, with no new dependency -- simple-git is already used for
        // gitStatus.ts.
        const raw = await simpleGit(repo.path).raw(['ls-files', '--cached', '--others', '--exclude-standard'])
        return raw.split('\n').filter((line) => line.trim().length > 0)
      } catch {
        return []
      }
    }
  }
}
