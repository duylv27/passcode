import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '../../shared/types'

export interface SessionsRepository {
  create(repoId: string, piSessionId: string, title: string): SessionRecord
  listByRepo(repoId: string): SessionRecord[]
  getById(id: string): SessionRecord | undefined
  rename(id: string, title: string): void
  setPiSessionId(id: string, piSessionId: string): void
  delete(id: string): void
}

const SELECT_COLUMNS =
  'id, repo_id as repoId, pi_session_id as piSessionId, title, created_at as createdAt'

export function createSessionsRepository(db: DatabaseSync): SessionsRepository {
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
    listByRepo(repoId: string): SessionRecord[] {
      return db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM sessions WHERE repo_id = ? ORDER BY created_at, rowid`
        )
        .all(repoId) as unknown as SessionRecord[]
    },
    getById(id: string): SessionRecord | undefined {
      return db.prepare(`SELECT ${SELECT_COLUMNS} FROM sessions WHERE id = ?`).get(id) as
        | SessionRecord
        | undefined
    },
    rename(id: string, title: string): void {
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
    },
    setPiSessionId(id: string, piSessionId: string): void {
      db.prepare('UPDATE sessions SET pi_session_id = ? WHERE id = ?').run(piSessionId, id)
    },
    delete(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    }
  }
}
