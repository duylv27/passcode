import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

/** A project used to be able to span multiple repos, with sessions that
 * could be either repo-scoped or project-scoped (spanning every repo in
 * the project). The app no longer supports that -- every project is now
 * 1:1 with a single repo. This one-time, idempotent migration splits any
 * existing multi-repo project: each of its repos becomes its own new
 * project (named after the repo), and any project-scoped sessions (which
 * have no single repo to follow) are deleted. Repo-scoped sessions are
 * untouched -- they reference repo_id directly, not project_id, so they
 * follow their repo to its new project automatically. Safe to run on
 * every app start: a project already down to one repo (or zero) is
 * excluded by the query below and left alone. */
export function migrateSingleRepoProjects(db: DatabaseSync): void {
  const multiRepoProjects = db
    .prepare('SELECT project_id FROM repos GROUP BY project_id HAVING COUNT(*) > 1')
    .all() as Array<{ project_id: string }>

  for (const { project_id: projectId } of multiRepoProjects) {
    db.prepare('DELETE FROM sessions WHERE project_id = ?').run(projectId)

    const repos = db.prepare('SELECT id, name FROM repos WHERE project_id = ?').all(projectId) as Array<{
      id: string
      name: string
    }>

    for (const repo of repos) {
      const newProjectId = randomUUID()
      db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(
        newProjectId,
        repo.name,
        new Date().toISOString()
      )
      // Repoint this repo to its new dedicated project BEFORE the old
      // project is deleted -- repos.project_id has ON DELETE CASCADE, so
      // deleting the old project while it still owned this repo would
      // destroy the repo (and its sessions) along with it.
      db.prepare('UPDATE repos SET project_id = ? WHERE id = ?').run(newProjectId, repo.id)
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
  }
}
