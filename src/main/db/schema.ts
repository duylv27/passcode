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

  // sessions.session_file and sessions.last_opened_at were added after the
  // sessions table already shipped; CREATE TABLE IF NOT EXISTS above does
  // nothing for a table that already exists without these columns, so add
  // them explicitly for existing databases.
  const columns = db.prepare("SELECT name FROM pragma_table_info('sessions')").all() as Array<{
    name: string
  }>
  if (!columns.some((c) => c.name === 'session_file')) {
    db.exec('ALTER TABLE sessions ADD COLUMN session_file TEXT')
  }
  if (!columns.some((c) => c.name === 'last_opened_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_opened_at TEXT')
  }
  // A project-scoped session still has repo_id pointing at a "primary" repo
  // (used for its cwd and session file); project_id set marks it as
  // spanning every repo in the project instead of just that one.
  if (!columns.some((c) => c.name === 'project_id')) {
    db.exec('ALTER TABLE sessions ADD COLUMN project_id TEXT')
  }
}
