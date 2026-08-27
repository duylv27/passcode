import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createProjectsHandlers, type ProjectsHandlers } from '../../../src/main/ipc/projectsHandlers'

describe('projectsHandlers', () => {
  let handlers: ProjectsHandlers

  beforeEach(() => {
    const db = new Database(':memory:')
    initSchema(db)
    handlers = createProjectsHandlers(createProjectsRepository(db))
  })

  it('creates a project', () => {
    const project = handlers.createProject('Demo')
    expect(project.name).toBe('Demo')
    expect(handlers.listProjects()).toHaveLength(1)
  })

  it('rejects an empty name', () => {
    expect(() => handlers.createProject('   ')).toThrow('Project name must not be empty')
  })

  it('deletes a project', () => {
    const project = handlers.createProject('Demo')
    handlers.deleteProject(project.id)
    expect(handlers.listProjects()).toHaveLength(0)
  })
})
