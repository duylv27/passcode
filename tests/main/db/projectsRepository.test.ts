import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository, type ProjectsRepository } from '../../../src/main/db/projectsRepository'

describe('ProjectsRepository', () => {
  let repo: ProjectsRepository

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    repo = createProjectsRepository(db)
  })

  it('creates and lists a project', () => {
    const created = repo.create('My Project')
    const listed = repo.list()
    expect(listed).toHaveLength(1)
    expect(listed[0].name).toBe('My Project')
    expect(listed[0].id).toBe(created.id)
  })

  it('gets a project by id', () => {
    const created = repo.create('Another Project')
    expect(repo.getById(created.id)?.name).toBe('Another Project')
  })

  it('returns undefined for a missing project', () => {
    expect(repo.getById('missing')).toBeUndefined()
  })

  it('deletes a project', () => {
    const created = repo.create('To Delete')
    repo.delete(created.id)
    expect(repo.getById(created.id)).toBeUndefined()
  })

  it('renames a project', () => {
    const created = repo.create('Old Name')
    repo.rename(created.id, 'New Name')
    expect(repo.getById(created.id)?.name).toBe('New Name')
  })
})
