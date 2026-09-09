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

  it('renames a project', () => {
    const project = handlers.createProject('Old Name')
    handlers.renameProject(project.id, 'New Name')
    expect(handlers.listProjects()[0].name).toBe('New Name')
  })

  it('rejects renaming to an empty name', () => {
    const project = handlers.createProject('Demo')
    expect(() => handlers.renameProject(project.id, '   ')).toThrow('Project name must not be empty')
  })

  it('deletes a project', () => {
    const project = handlers.createProject('Demo')
    handlers.deleteProject(project.id)
    expect(handlers.listProjects()).toHaveLength(0)
  })

  it('excludes the general-session project from listProjects when getGeneralProjectId names one', () => {
    const db = new Database(':memory:')
    initSchema(db)
    const repo = createProjectsRepository(db)
    const visible = repo.create('Demo')
    const hidden = repo.create('General')
    const localHandlers = createProjectsHandlers(repo, () => hidden.id)

    const listed = localHandlers.listProjects()
    expect(listed.map((p) => p.id)).toEqual([visible.id])
  })

  it('includes every project when getGeneralProjectId is omitted', () => {
    const project = handlers.createProject('Demo')
    expect(handlers.listProjects().map((p) => p.id)).toEqual([project.id])
  })
})
