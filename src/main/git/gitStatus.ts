import simpleGit from 'simple-git'

export async function isGitRepo(path: string): Promise<boolean> {
  try {
    return await simpleGit(path).checkIsRepo()
  } catch {
    return false
  }
}
