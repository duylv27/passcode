import simpleGit from 'simple-git'
import type { GitStatus } from '../../shared/types'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}

export async function getGitStatus(path: string): Promise<GitStatus | null> {
  try {
    const git = simpleGit(path)
    if (!(await git.checkIsRepo())) return null
    const status = await git.status()
    return { branch: status.current, dirty: !status.isClean() }
  } catch {
    return null
  }
}
