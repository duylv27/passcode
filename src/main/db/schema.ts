import type { DatabaseSync } from 'node:sqlite'

export function initSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repos (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      pi_session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      session_file TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // sessions.session_file was added after the sessions table already shipped;
  // CREATE TABLE IF NOT EXISTS above does nothing for a table that already
  // exists without this column, so add it explicitly for existing databases.
  const columns = db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{
    name: string
  }>
  if (!columns.some((c) => c.name === 'session_file')) {
    db.exec('ALTER TABLE sessions ADD COLUMN session_file TEXT')
  }
}
