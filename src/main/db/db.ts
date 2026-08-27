import Database from 'better-sqlite3'
import { initSchema } from './schema'

export function openDatabase(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}
