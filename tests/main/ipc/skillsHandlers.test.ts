import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'

const listSkillsForRepoMock = vi.fn(async () => [
  { name: 'my-skill', description: 'does a thing', filePath: '/repo/.pi/skills/my-skill/SKILL.md' }
])

vi.mock('../../../src/main/agent/skills', () => ({
  listSkillsForRepo: listSkillsForRepoMock
}))

import { createSkillsHandlers } from '../../../src/main/ipc/skillsHandlers'

describe('skillsHandlers', () => {
  let repoId: string
  let reposRepo: ReturnType<typeof createReposRepository>

  beforeEach(() => {
    listSkillsForRepoMock.mockClear()
    const db = new Database(':memory:')
    initSchema(db)
    reposRepo = createReposRepository(db)
    const projectId = createProjectsRepository(db).create('Demo').id
    repoId = reposRepo.create(projectId, '/repo/path', 'demo-repo').id
  })

  it("lists skills for the repo's path", async () => {
    const handlers = createSkillsHandlers(reposRepo)

    const skills = await handlers.listSkills(repoId)

    expect(listSkillsForRepoMock).toHaveBeenCalledWith('/repo/path')
    expect(skills).toEqual([{ name: 'my-skill', description: 'does a thing', filePath: '/repo/.pi/skills/my-skill/SKILL.md' }])
  })

  it('returns an empty list for an unknown repo instead of throwing', async () => {
    const handlers = createSkillsHandlers(reposRepo)

    expect(await handlers.listSkills('missing')).toEqual([])
    expect(listSkillsForRepoMock).not.toHaveBeenCalled()
  })
})
