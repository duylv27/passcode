import type { ProjectsRepository } from '../db/projectsRepository'
import type { Project } from '../../shared/types'

export interface ProjectsHandlers {
  createProject(name: string): Project
  listProjects(): Project[]
  deleteProject(id: string): void
}

export function createProjectsHandlers(repo: ProjectsRepository): ProjectsHandlers {
  return {
    createProject(name: string): Project {
      if (!name.trim()) throw new Error('Project name must not be empty')
      return repo.create(name.trim())
    },
    listProjects(): Project[] {
      return repo.list()
    },
    deleteProject(id: string): void {
      repo.delete(id)
    }
  }
}
