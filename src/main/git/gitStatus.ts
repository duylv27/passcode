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
    const status = await simpleGit(path).status()
    return { branch: status.current, dirty: !status.isClean() }
  } catch {
    return null
  }
}
