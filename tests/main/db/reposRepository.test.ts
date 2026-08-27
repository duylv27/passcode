import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository, type ReposRepository } from '../../../src/main/db/reposRepository'

describe('ReposRepository', () => {
  let repos: ReposRepository
  let projectId: string

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    projectId = createProjectsRepository(db).create('Test Project').id
    repos = createReposRepository(db)
  })

  it('creates and lists repos for a project', () => {
    repos.create(projectId, '/path/to/repo', 'my-repo')
    const list = repos.listByProject(projectId)
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('my-repo')
    expect(list[0].path).toBe('/path/to/repo')
  })

  it('gets a repo by id', () => {
    const created = repos.create(projectId, '/path/a', 'a')
    expect(repos.getById(created.id)?.name).toBe('a')
  })

  it('deletes a repo', () => {
    const created = repos.create(projectId, '/path/a', 'a')
    repos.delete(created.id)
    expect(repos.getById(created.id)).toBeUndefined()
  })
})
