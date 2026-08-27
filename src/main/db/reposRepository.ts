import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Repo } from '../../shared/types'

export interface ReposRepository {
  create(projectId: string, path: string, name: string): Repo
  listByProject(projectId: string): Repo[]
  getById(id: string): Repo | undefined
  delete(id: string): void
}

export function createReposRepository(db: DatabaseSync): ReposRepository {
  return {
    create(projectId: string, path: string, name: string): Repo {
      const repo: Repo = { id: randomUUID(), projectId, path, name }
      db.prepare('INSERT INTO repos (id, project_id, path, name) VALUES (?, ?, ?, ?)').run(
        repo.id,
        repo.projectId,
        repo.path,
        repo.name
      )
      return repo
    },
    listByProject(projectId: string): Repo[] {
      return db
        .prepare('SELECT id, project_id as projectId, path, name FROM repos WHERE project_id = ?')
        .all(projectId) as Repo[]
    },
    getById(id: string): Repo | undefined {
      return db
        .prepare('SELECT id, project_id as projectId, path, name FROM repos WHERE id = ?')
        .get(id) as Repo | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM repos WHERE id = ?').run(id)
    }
  }
}
