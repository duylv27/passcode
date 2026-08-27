import { ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'
import type { SessionHandlers } from './sessionHandlers'
import type { GitHandlers } from './gitHandlers'
import type { SettingsHandlers } from './settingsHandlers'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
  git: GitHandlers
  settings: SettingsHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))

  ipcMain.handle('session:list', (_e, repoId: string) => handlers.session.listSessions(repoId))
  ipcMain.handle('session:create', (_e, repoId: string, title?: string) =>
    handlers.session.createSession(repoId, title)
  )
  ipcMain.handle('session:rename', (_e, sessionId: string, title: string) =>
    handlers.session.renameSession(sessionId, title)
  )
  ipcMain.handle('session:delete', (_e, sessionId: string) => handlers.session.deleteSession(sessionId))
  ipcMain.handle('session:open', (_e, sessionId: string) => handlers.session.openSession(sessionId))
  ipcMain.handle('session:prompt', (_e, sessionId: string, text: string) =>
    handlers.session.sendPrompt(sessionId, text)
  )

  ipcMain.handle('git:status', (_e, repoId: string) => handlers.git.status(repoId))

  ipcMain.handle('settings:setAnthropicApiKey', (_e, apiKey: string) =>
    handlers.settings.setAnthropicApiKey(apiKey)
  )
  ipcMain.handle('settings:getAuthStatus', () => handlers.settings.getAuthStatus())
  ipcMain.handle('settings:loginCopilot', (event) =>
    handlers.settings.loginCopilot((challenge) => event.sender.send('settings:copilotChallenge', challenge))
  )
}
