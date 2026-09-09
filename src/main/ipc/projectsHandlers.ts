import type { ProjectsRepository } from '../db/projectsRepository'
import type { Project } from '../../shared/types'

export interface ProjectsHandlers {
  createProject(name: string): Project
  listProjects(): Project[]
  renameProject(id: string, name: string): void
  deleteProject(id: string): void
}

export function createProjectsHandlers(
  repo: ProjectsRepository,
  /** Id of the hidden project backing project-less "general" sessions (see
   * sessionHandlers.ts's createGeneralSession) -- excluded from the list so
   * it never shows up as a real project the user could open or delete.
   * Optional since not every caller (e.g. tests) needs one. */
  getGeneralProjectId?: () => string | undefined
): ProjectsHandlers {
  return {
    createProject(name: string): Project {
      if (!name.trim()) throw new Error('Project name must not be empty')
      return repo.create(name.trim())
    },
    listProjects(): Project[] {
      const generalId = getGeneralProjectId?.()
      const all = repo.list()
      return generalId ? all.filter((p) => p.id !== generalId) : all
    },
    renameProject(id: string, name: string): void {
      if (!name.trim()) throw new Error('Project name must not be empty')
      repo.rename(id, name.trim())
    },
    deleteProject(id: string): void {
      repo.delete(id)
    }
  }
}
