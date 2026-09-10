import { app, ipcMain } from 'electron'
import type { ProjectsHandlers } from './projectsHandlers'
import type { ReposHandlers } from './reposHandlers'
import type { SessionHandlers } from './sessionHandlers'
import type { SettingsHandlers } from './settingsHandlers'
import type { ApprovalHandlers } from './approvalHandlers'
import type { ModelsHandlers } from './modelsHandlers'
import type { SkillsHandlers } from './skillsHandlers'
import type { FilesHandlers } from './filesHandlers'
import type { WindowHandlers } from './windowHandlers'
import type { SessionPreviewHandlers } from './sessionPreviewHandlers'
import type { PromptOptions, ThinkingLevel, ToolApprovalPolicy, UsageTelemetryConfig } from '../../shared/types'

export interface IpcHandlers {
  projects: ProjectsHandlers
  repos: ReposHandlers
  session: SessionHandlers
  settings: SettingsHandlers
  models: ModelsHandlers
  skills: SkillsHandlers
  files: FilesHandlers
  approvals: ApprovalHandlers
  window: WindowHandlers
  sessionPreview: SessionPreviewHandlers
}

export function registerIpcHandlers(handlers: IpcHandlers): void {
  ipcMain.handle('projects:create', (_e, name: string) => handlers.projects.createProject(name))
  ipcMain.handle('projects:list', () => handlers.projects.listProjects())
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => handlers.projects.renameProject(id, name))
  ipcMain.handle('projects:delete', (_e, id: string) => handlers.projects.deleteProject(id))

  ipcMain.handle('repos:add', (_e, projectId: string, path: string) =>
    handlers.repos.addRepo(projectId, path)
  )
  ipcMain.handle('repos:list', (_e, projectId: string) => handlers.repos.listRepos(projectId))
  ipcMain.handle('repos:delete', (_e, id: string) => handlers.repos.deleteRepo(id))
  ipcMain.handle('repos:gitStatus', (_e, id: string) => handlers.repos.getGitStatus(id))

  ipcMain.handle('session:list', (_e, repoId: string) => handlers.session.listSessions(repoId))
  ipcMain.handle('session:create', (_e, repoId: string, title?: string) =>
    handlers.session.createSession(repoId, title)
  )
  ipcMain.handle('session:listAll', () => handlers.session.listAllSessions())
  ipcMain.handle('session:listByProject', (_e, projectId: string) =>
    handlers.session.listProjectSessions(projectId)
  )
  ipcMain.handle('session:createProjectSession', (_e, projectId: string, title?: string) =>
    handlers.session.createProjectSession(projectId, title)
  )
  ipcMain.handle('session:createGeneralSession', (_e, title?: string) =>
    handlers.session.createGeneralSession(title)
  )
  ipcMain.handle('session:rename', (_e, sessionId: string, title: string) =>
    handlers.session.renameSession(sessionId, title)
  )
  ipcMain.handle('session:setBookmarked', (_e, sessionId: string, bookmarked: boolean) =>
    handlers.session.setBookmarked(sessionId, bookmarked)
  )
  ipcMain.handle('session:delete', (_e, sessionId: string) => handlers.session.deleteSession(sessionId))
  ipcMain.handle('session:open', (_e, sessionId: string) => handlers.session.openSession(sessionId))
  ipcMain.handle('session:prompt', (_e, sessionId: string, text: string, options?: PromptOptions) =>
    handlers.session.sendPrompt(sessionId, text, options)
  )
  ipcMain.handle('session:abort', (_e, sessionId: string) => handlers.session.abortSession(sessionId))
  ipcMain.handle('session:setModel', (_e, sessionId: string, provider: string, modelId: string) =>
    handlers.session.setSessionModel(sessionId, provider, modelId)
  )
  ipcMain.handle('session:compact', (_e, sessionId: string) => handlers.session.compactSession(sessionId))
  ipcMain.handle('session:getAutoCompactionEnabled', (_e, sessionId: string) =>
    handlers.session.getAutoCompactionEnabled(sessionId)
  )
  ipcMain.handle('session:setAutoCompactionEnabled', (_e, sessionId: string, enabled: boolean) =>
    handlers.session.setAutoCompactionEnabled(sessionId, enabled)
  )
  ipcMain.handle('session:getCompactionThresholds', (_e, sessionId: string) =>
    handlers.session.getCompactionThresholds(sessionId)
  )
  ipcMain.handle('session:setContextWindowOverride', (_e, sessionId: string, contextWindow: number | null) =>
    handlers.session.setContextWindowOverride(sessionId, contextWindow)
  )
  ipcMain.handle('session:getSessionStats', (_e, sessionId: string) => handlers.session.getSessionStats(sessionId))
  ipcMain.handle('session:getToolsInfo', (_e, sessionId: string) => handlers.session.getToolsInfo(sessionId))
  ipcMain.handle('session:setActiveTools', (_e, sessionId: string, toolNames: string[]) =>
    handlers.session.setActiveTools(sessionId, toolNames)
  )
  ipcMain.handle('session:getThinkingInfo', (_e, sessionId: string) => handlers.session.getThinkingInfo(sessionId))
  ipcMain.handle('session:setThinkingLevel', (_e, sessionId: string, level: ThinkingLevel) =>
    handlers.session.setThinkingLevel(sessionId, level)
  )

  ipcMain.handle('models:list', () => handlers.models.listModels())

  ipcMain.handle('skills:list', (_e, repoId: string) => handlers.skills.listSkills(repoId))

  ipcMain.handle('files:pickFile', () => handlers.files.pickFile())
  ipcMain.handle('files:pickFolder', () => handlers.files.pickFolder())

  ipcMain.handle('settings:setAnthropicApiKey', (_e, apiKey: string) =>
    handlers.settings.setAnthropicApiKey(apiKey)
  )
  ipcMain.handle('settings:removeAnthropicApiKey', () => handlers.settings.removeAnthropicApiKey())
  ipcMain.handle('settings:setGeminiApiKey', (_e, apiKey: string) => handlers.settings.setGeminiApiKey(apiKey))
  ipcMain.handle('settings:getAuthStatus', () => handlers.settings.getAuthStatus())
  ipcMain.handle('settings:loginCopilot', (event) =>
    handlers.settings.loginCopilot((challenge) => event.sender.send('settings:copilotChallenge', challenge))
  )
  ipcMain.handle('settings:getCopilotQuota', () => handlers.settings.getCopilotQuota())
  ipcMain.handle('settings:loginAnthropicOAuth', (event) =>
    handlers.settings.loginAnthropicOAuth((prompt) => event.sender.send('settings:anthropicOAuthPrompt', prompt))
  )
  ipcMain.handle('settings:submitAnthropicOAuthCode', (_e, code: string) =>
    handlers.settings.submitAnthropicOAuthCode(code)
  )
  ipcMain.handle('settings:cancelAnthropicOAuth', () => handlers.settings.cancelAnthropicOAuth())
  ipcMain.handle('settings:getUsageTelemetryConfig', () => handlers.settings.getUsageTelemetryConfig())
  ipcMain.handle('settings:setUsageTelemetryConfig', (_e, config: UsageTelemetryConfig) =>
    handlers.settings.setUsageTelemetryConfig(config)
  )

  ipcMain.handle('approvals:getPolicy', () => handlers.approvals.getPolicy())
  ipcMain.handle('approvals:setPolicy', (_e, policy: ToolApprovalPolicy) =>
    handlers.approvals.setPolicy(policy)
  )
  ipcMain.handle('approvals:respond', (_e, requestId: string, approved: boolean) =>
    handlers.approvals.respond(requestId, approved)
  )

  ipcMain.handle('window:minimize', () => handlers.window.minimize())
  ipcMain.handle('window:toggleMaximize', () => handlers.window.toggleMaximize())
  ipcMain.handle('window:close', () => handlers.window.close())
  ipcMain.handle('window:isMaximized', () => handlers.window.isMaximized())

  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('sessionPreview:get', (_e, sessionId: string) => handlers.sessionPreview.getPreview(sessionId))
}
