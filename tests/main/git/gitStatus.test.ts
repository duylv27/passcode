import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import simpleGit from 'simple-git'
import { isGitRepo } from '../../../src/main/git/gitStatus'

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
})
