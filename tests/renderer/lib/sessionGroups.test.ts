import { describe, it, expect } from 'vitest'
import { groupSessionsByRepo } from '../../../src/renderer/src/lib/sessionGroups'
import type { Repo, SessionRecord } from '../../../src/shared/types'

function repo(id: string): Repo {
  return { id, projectId: 'p1', path: `/repos/${id}`, name: id }
}

function session(id: string, repoId: string): SessionRecord {
  return { id, repoId, projectId: 'p1', piSessionId: `pi-${id}`, title: id, createdAt: '2026-01-01' }
}

describe('groupSessionsByRepo', () => {
  it('groups sessions under their repo, preserving repo order', () => {
    const repos = [repo('a'), repo('b')]
    const sessions = [session('s1', 'b'), session('s2', 'a'), session('s3', 'a')]
    const groups = groupSessionsByRepo(sessions, repos)
    expect(groups.map((g) => g.repo.id)).toEqual(['a', 'b'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(groups[1].sessions.map((s) => s.id)).toEqual(['s1'])
  })

  it('omits repos with no sessions', () => {
    const repos = [repo('a'), repo('b')]
    const sessions = [session('s1', 'a')]
    const groups = groupSessionsByRepo(sessions, repos)
    expect(groups.map((g) => g.repo.id)).toEqual(['a'])
  })

  it('returns an empty array when there are no sessions', () => {
    expect(groupSessionsByRepo([], [repo('a')])).toEqual([])
  })
})
