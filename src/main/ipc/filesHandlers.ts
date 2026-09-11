import simpleGit from 'simple-git'
import type { ReposRepository } from '../db/reposRepository'

// Excluded regardless of the target repo's own .gitignore -- some repos
// don't gitignore these properly, or committed them before adding one
// (node_modules/vendor caught in history, a Maven/Gradle target/build dir).
// Matched as a path segment, not a substring, so a real source file like
// `src/build-tool.ts` is unaffected.
const DENYLISTED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  'vendor',
  '.gradle',
  '.m2'
])

function isDenylisted(path: string): boolean {
  return path.split(/[/\\]/).some((segment) => DENYLISTED_DIR_SEGMENTS.has(segment))
}

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
        return raw.split('\n').filter((line) => line.trim().length > 0 && !isDenylisted(line))
      } catch {
        return []
      }
    }
  }
}
