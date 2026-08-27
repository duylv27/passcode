import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '../../shared/types'

export interface SessionsRepository {
  create(repoId: string, piSessionId: string, title: string): SessionRecord
  getByRepoId(repoId: string): SessionRecord | undefined
  delete(id: string): void
}

export function createSessionsRepository(db: Database.Database): SessionsRepository {
  return {
    create(repoId: string, piSessionId: string, title: string): SessionRecord {
      const record: SessionRecord = {
        id: randomUUID(),
        repoId,
        piSessionId,
        title,
        createdAt: new Date().toISOString()
      }
      db.prepare(
        'INSERT INTO sessions (id, repo_id, pi_session_id, title, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(record.id, record.repoId, record.piSessionId, record.title, record.createdAt)
      return record
    },
    getByRepoId(repoId: string): SessionRecord | undefined {
      return db
        .prepare(
          'SELECT id, repo_id as repoId, pi_session_id as piSessionId, title, created_at as createdAt ' +
            'FROM sessions WHERE repo_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'
        )
        .get(repoId) as SessionRecord | undefined
    },
    delete(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    }
  }
}
