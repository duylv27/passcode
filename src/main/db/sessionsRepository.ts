import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '../../shared/types'

export interface SessionsRepository {
  /** projectId set makes this a project-scoped session -- repoId is still
   * its primary/cwd repo, but it isn't listed under that repo alone. */
  create(repoId: string, piSessionId: string, title: string, projectId?: string | null): SessionRecord
  /** Repo-scoped sessions only -- excludes project-scoped ones even if this
   * repo happens to be their primary repo. */
  listByRepo(repoId: string): SessionRecord[]
  listByProject(projectId: string): SessionRecord[]
  getById(id: string): SessionRecord | undefined
  /** The most recently opened session across every repo, falling back to
   * most recently created for a session that's never been opened -- used
   * to land on the last thing you were working on instead of an empty state. */
  getMostRecent(): SessionRecord | undefined
  /** Every session across every repo/project, most-recently-opened first
   * (falling back to creation time for a session that's never been opened). */
  listAll(): SessionRecord[]
  rename(id: string, title: string): void
  setPiSessionId(id: string, piSessionId: string): void
  /** The Pi SDK session file backing this session, if it has ever been opened. */
  getSessionFile(id: string): string | undefined
  setSessionFile(id: string, sessionFile: string): void
  touchOpened(id: string): void
  setBookmarked(id: string, bookmarked: boolean): void
  delete(id: string): void
}

const SELECT_COLUMNS =
  'id, repo_id as repoId, project_id as projectId, pi_session_id as piSessionId, title, created_at as createdAt, last_opened_at as lastOpenedAt, bookmarked'

// SQLite has no native boolean -- bookmarked comes back as 0/1 from every
// query using SELECT_COLUMNS, so each read path coerces it here rather than
// leaking the raw integer into SessionRecord's boolean field.
function mapRow(row: unknown): SessionRecord {
  const r = row as Omit<SessionRecord, 'bookmarked'> & { bookmarked: unknown }
  return { ...r, bookmarked: r.bookmarked === 1 || r.bookmarked === true }
}

export function createSessionsRepository(db: DatabaseSync): SessionsRepository {
  return {
    create(repoId: string, piSessionId: string, title: string, projectId: string | null = null): SessionRecord {
      const record: SessionRecord = {
        id: randomUUID(),
        repoId,
        projectId,
        piSessionId,
        title,
        createdAt: new Date().toISOString(),
        lastOpenedAt: null,
        bookmarked: false
      }
      db.prepare(
        'INSERT INTO sessions (id, repo_id, project_id, pi_session_id, title, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(record.id, record.repoId, record.projectId, record.piSessionId, record.title, record.createdAt)
      return record
    },
    listByRepo(repoId: string): SessionRecord[] {
      return (
        db
          .prepare(
            `SELECT ${SELECT_COLUMNS} FROM sessions WHERE repo_id = ? AND project_id IS NULL ORDER BY created_at, rowid`
          )
          .all(repoId) as unknown[]
      ).map(mapRow)
    },
    listByProject(projectId: string): SessionRecord[] {
      return (
        db
          .prepare(`SELECT ${SELECT_COLUMNS} FROM sessions WHERE project_id = ? ORDER BY created_at, rowid`)
          .all(projectId) as unknown[]
      ).map(mapRow)
    },
    getById(id: string): SessionRecord | undefined {
      const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM sessions WHERE id = ?`).get(id)
      return row ? mapRow(row) : undefined
    },
    getMostRecent(): SessionRecord | undefined {
      const row = db
        .prepare(
          `SELECT ${SELECT_COLUMNS} FROM sessions ORDER BY COALESCE(last_opened_at, created_at) DESC, rowid DESC LIMIT 1`
        )
        .get()
      return row ? mapRow(row) : undefined
    },
    listAll(): SessionRecord[] {
      return (
        db
          .prepare(
            `SELECT ${SELECT_COLUMNS} FROM sessions ORDER BY COALESCE(last_opened_at, created_at) DESC, rowid DESC`
          )
          .all() as unknown[]
      ).map(mapRow)
    },
    rename(id: string, title: string): void {
      db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
    },
    setPiSessionId(id: string, piSessionId: string): void {
      db.prepare('UPDATE sessions SET pi_session_id = ? WHERE id = ?').run(piSessionId, id)
    },
    getSessionFile(id: string): string | undefined {
      const row = db.prepare('SELECT session_file as sessionFile FROM sessions WHERE id = ?').get(id) as
        | { sessionFile: string | null }
        | undefined
      return row?.sessionFile ?? undefined
    },
    setSessionFile(id: string, sessionFile: string): void {
      db.prepare('UPDATE sessions SET session_file = ? WHERE id = ?').run(sessionFile, id)
    },
    touchOpened(id: string): void {
      db.prepare('UPDATE sessions SET last_opened_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    },
    setBookmarked(id: string, bookmarked: boolean): void {
      db.prepare('UPDATE sessions SET bookmarked = ? WHERE id = ?').run(bookmarked ? 1 : 0, id)
    },
    delete(id: string): void {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    }
  }
}
