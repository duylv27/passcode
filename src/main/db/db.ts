import { DatabaseSync } from 'node:sqlite'
import { initSchema } from './schema'
import { migrateSingleRepoProjects } from './migrateSingleRepoProjects'

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  initSchema(db)
  migrateSingleRepoProjects(db)
  return db
}
