import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Project } from '../../shared/types'

export interface ProjectsRepository {
  create(name: string): Project
  list(): Project[]
  getById(id: string): Project | undefined
  delete(id: string): void
}

export function createProjectsRepository(db: DatabaseSync): ProjectsRepository {
  return {
    create(name: string): Project {
      const project: Project = { id: randomUUID(), name, createdAt: new Date().toISOString() }
      db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(
        project.id,
        project.name,
        project.createdAt
      )
      return project
    },
    list(): Project[] {
      return db
        .prepare('SELECT id, name, created_at as createdAt FROM projects ORDER BY created_at')
        .all() as Project[]
    },
    getById(id: string): Project | undefined {
      return db
        .prepare('SELECT id, name, created_at as createdAt FROM projects WHERE id = ?')
        .get(id) as Project | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)
    }
  }
}
