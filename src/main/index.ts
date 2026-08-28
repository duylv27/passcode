import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createSessionsRepository } from './db/sessionsRepository'
import { createAppSettingsRepository } from './db/appSettingsRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { createSessionHandlers } from './ipc/sessionHandlers'
import { createGitHandlers } from './ipc/gitHandlers'
import { createSettingsHandlers } from './ipc/settingsHandlers'
import { createApprovalHandlers } from './ipc/approvalHandlers'
import { registerIpcHandlers } from './ipc/register'
import { isGitRepo } from './git/gitStatus'
import { createRepoSession } from './agent/piSession'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const db = openDatabase(join(app.getPath('userData'), 'pi-agent.db'))
  const projectsRepo = createProjectsRepository(db)
  const reposRepo = createReposRepository(db)
  const sessionsRepo = createSessionsRepository(db)
  const appSettingsRepo = createAppSettingsRepository(db)

  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const modelRuntime: ModelRuntime = await ModelRuntime.create()

  let mainWindow = createWindow()

  const approvalHandlers = createApprovalHandlers({
    getPolicy: () => appSettingsRepo.getToolApprovalPolicy(),
    setPolicy: (policy) => appSettingsRepo.setToolApprovalPolicy(policy),
    onRequest: (request) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('approvals:request', request)
    }
  })

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo),
    session: createSessionHandlers({
      reposRepo,
      sessionsRepo,
      openRepoSession: (cwd, requestApproval) => createRepoSession({ cwd, modelRuntime, requestApproval }),
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)
      },
      requestApproval: (sessionId, toolName, input) =>
        approvalHandlers.requestApproval(sessionId, toolName, input)
    }),
    git: createGitHandlers(reposRepo),
    settings: createSettingsHandlers(modelRuntime),
    approvals: approvalHandlers
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
