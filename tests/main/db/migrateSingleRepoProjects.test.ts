import { describe, it, expect, beforeEach } from 'vitest'
import { DatabaseSync as Database } from 'node:sqlite'
import { initSchema } from '../../../src/main/db/schema'
import { createProjectsRepository } from '../../../src/main/db/projectsRepository'
import { createReposRepository } from '../../../src/main/db/reposRepository'
import { createSessionsRepository } from '../../../src/main/db/sessionsRepository'
import { migrateSingleRepoProjects } from '../../../src/main/db/migrateSingleRepoProjects'

describe('migrateSingleRepoProjects', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    initSchema(db)
  })

  it('leaves a project with exactly one repo untouched', () => {
    const projects = createProjectsRepository(db)
    const repos = createReposRepository(db)
    const sessions = createSessionsRepository(db)

    const projectId = projects.create('Solo Project').id
    const repoId = repos.create(projectId, '/path/a', 'repo-a').id
    const session = sessions.create(repoId, 'pi-1', 'A session')

    migrateSingleRepoProjects(db)

    expect(projects.list().map((p) => p.id)).toEqual([projectId])
    expect(repos.listByProject(projectId).map((r) => r.id)).toEqual([repoId])
    expect(sessions.getById(session.id)).toEqual(session)
  })

  it('leaves a project with zero repos untouched', () => {
    const projects = createProjectsRepository(db)
    const projectId = projects.create('Empty Project').id

    migrateSingleRepoProjects(db)

    expect(projects.list().map((p) => p.id)).toEqual([projectId])
  })

  it('splits a multi-repo project into one project per repo, named after each repo', () => {
    const projects = createProjectsRepository(db)
    const repos = createReposRepository(db)

    const projectId = projects.create('Big Project').id
    const repoAId = repos.create(projectId, '/path/a', 'repo-a').id
    const repoBId = repos.create(projectId, '/path/b', 'repo-b').id

    migrateSingleRepoProjects(db)

    const allProjects = projects.list()
    expect(allProjects).toHaveLength(2)
    expect(allProjects.map((p) => p.id)).not.toContain(projectId)
    const names = allProjects.map((p) => p.name).sort()
    expect(names).toEqual(['repo-a', 'repo-b'])

    const repoAProject = allProjects.find((p) => p.name === 'repo-a')!
    const repoBProject = allProjects.find((p) => p.name === 'repo-b')!
    expect(repos.listByProject(repoAProject.id).map((r) => r.id)).toEqual([repoAId])
    expect(repos.listByProject(repoBProject.id).map((r) => r.id)).toEqual([repoBId])
  })

  it('keeps repo-scoped sessions attached to their repo across the split', () => {
    const projects = createProjectsRepository(db)
    const repos = createReposRepository(db)
    const sessions = createSessionsRepository(db)

    const projectId = projects.create('Big Project').id
    const repoAId = repos.create(projectId, '/path/a', 'repo-a').id
    repos.create(projectId, '/path/b', 'repo-b')
    const repoASession = sessions.create(repoAId, 'pi-1', 'Repo A session')

    migrateSingleRepoProjects(db)

    const preserved = sessions.getById(repoASession.id)
    expect(preserved).toBeDefined()
    expect(preserved?.repoId).toBe(repoAId)
    const newRepoAProject = repos.listByProject(
      projects.list().find((p) => p.name === 'repo-a')!.id
    )
    expect(newRepoAProject.map((r) => r.id)).toEqual([repoAId])
  })

  it('deletes project-scoped sessions during the split', () => {
    const projects = createProjectsRepository(db)
    const repos = createReposRepository(db)
    const sessions = createSessionsRepository(db)

    const projectId = projects.create('Big Project').id
    repos.create(projectId, '/path/a', 'repo-a')
    repos.create(projectId, '/path/b', 'repo-b')
    const projectSession = sessions.create(repos.listByProject(projectId)[0].id, 'pi-1', 'Project-wide', projectId)

    migrateSingleRepoProjects(db)

    expect(sessions.getById(projectSession.id)).toBeUndefined()
  })

  it('is idempotent -- running it twice does not change an already-split state', () => {
    const projects = createProjectsRepository(db)
    const repos = createReposRepository(db)

    const projectId = projects.create('Big Project').id
    repos.create(projectId, '/path/a', 'repo-a')
    repos.create(projectId, '/path/b', 'repo-b')

    migrateSingleRepoProjects(db)
    const afterFirstRun = projects.list().map((p) => p.id).sort()

    migrateSingleRepoProjects(db)
    const afterSecondRun = projects.list().map((p) => p.id).sort()

    expect(afterSecondRun).toEqual(afterFirstRun)
  })
})
