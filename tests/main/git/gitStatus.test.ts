import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { isGitRepo, getGitStatus } from '../../../src/main/git/gitStatus'

describe('gitStatus', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pi-agent-test-'))
    const git = simpleGit(dir)
    await git.init()
    await git.addConfig('user.email', 'test@example.com')
    await git.addConfig('user.name', 'Test')
    writeFileSync(join(dir, 'a.txt'), 'hello')
    await git.add('a.txt')
    await git.commit('initial')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reports not a git repo for a plain folder', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'pi-agent-plain-'))
    expect(await isGitRepo(plain)).toBe(false)
    rmSync(plain, { recursive: true, force: true })
  })

  it('reports a valid git repo', async () => {
    expect(await isGitRepo(dir)).toBe(true)
  })

  it('reports branch and changed files', async () => {
    writeFileSync(join(dir, 'a.txt'), 'changed')
    writeFileSync(join(dir, 'b.txt'), 'new file')
    const status = await getGitStatus(dir)
    expect(status.branch).toBeTruthy()
    expect(status.changed).toContain('a.txt')
    expect(status.added).toContain('b.txt')
  })
})
