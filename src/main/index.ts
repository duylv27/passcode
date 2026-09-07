import { app, BrowserWindow, dialog, Menu } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createSessionsRepository } from './db/sessionsRepository'
import { createAppSettingsRepository } from './db/appSettingsRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { createSessionHandlers } from './ipc/sessionHandlers'
import { createSettingsHandlers } from './ipc/settingsHandlers'
import { createApprovalHandlers } from './ipc/approvalHandlers'
import { createModelsHandlers } from './ipc/modelsHandlers'
import { createSkillsHandlers } from './ipc/skillsHandlers'
import { createFilesHandlers } from './ipc/filesHandlers'
import { createWindowHandlers } from './ipc/windowHandlers'
import { createSessionPreviewHandlers } from './ipc/sessionPreviewHandlers'
import { registerIpcHandlers } from './ipc/register'
import { isGitRepo, getGitStatus } from './git/gitStatus'
import { createRepoSession } from './agent/piSession'
import { buildPromptText } from './agent/promptBuilder'

// PassCode has its own title bar / status bar chrome; Electron's default
// File/Edit/View/Window menu bar doesn't fit that and exposes actions
// (reload, DevTools) not meant for end users.
Menu.setApplicationMenu(null)

function createWindow(): BrowserWindow {
  // The packaged .exe carries its icon from electron-builder's `win.icon`
  // config automatically; this only matters for `npm run dev`, where
  // Windows has no embedded icon to fall back on.
  const devIconPath = join(__dirname, '../../build/icon.png')

  const win = new BrowserWindow({
    frame: false,
    width: 1200,
    height: 800,
    show: false,
    ...(existsSync(devIconPath) ? { icon: devIconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Electron shows the window as soon as it's created by default, which
  // paints a blank white frame for however long the renderer takes to load
  // and produce its first frame. Waiting for 'ready-to-show' means the
  // window only appears once there's something real to show.
  win.once('ready-to-show', () => win.show())

  // Electron's default menu accelerator for zoom is unreliable across
  // keyboard layouts (Ctrl+Plus needs Shift, and "+" isn't always what
  // the accelerator parser sees) -- handle it directly instead.
  const ZOOM_STEP = 0.1
  const MIN_ZOOM = 0.5
  const MAX_ZOOM = 3
  win.webContents.on('before-input-event', (_event, input) => {
    if (!input.control || input.type !== 'keyDown') return
    if (input.key === '=' || input.key === '+') {
      win.webContents.setZoomFactor(Math.min(MAX_ZOOM, win.webContents.getZoomFactor() + ZOOM_STEP))
    } else if (input.key === '-') {
      win.webContents.setZoomFactor(Math.max(MIN_ZOOM, win.webContents.getZoomFactor() - ZOOM_STEP))
    } else if (input.key === '0') {
      win.webContents.setZoomFactor(1)
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

  const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
  const modelRuntime: ModelRuntime = await ModelRuntime.create()
  const modelRegistry = new ModelRegistry(modelRuntime)
  await modelRegistry.refresh()

  let mainWindow = createWindow()
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizeChanged', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizeChanged', false))

  const approvalHandlers = createApprovalHandlers({
    getPolicy: () => appSettingsRepo.getToolApprovalPolicy(),
    setPolicy: (policy) => appSettingsRepo.setToolApprovalPolicy(policy),
    onRequest: (request) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('approvals:request', request)
    }
  })

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo, getGitStatus),
    session: createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo,
      openRepoSession: (cwd, requestApproval, resumeSessionFile) =>
        createRepoSession({ cwd, modelRuntime, requestApproval, resumeSessionFile }),
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)
      },
      requestApproval: (sessionId, toolName, input) =>
        approvalHandlers.requestApproval(sessionId, toolName, input),
      findModel: (provider, modelId) => modelRegistry.find(provider, modelId),
      buildPromptText
    }),
    settings: createSettingsHandlers(modelRuntime, appSettingsRepo),
    models: createModelsHandlers(modelRegistry),
    skills: createSkillsHandlers(reposRepo),
    files: createFilesHandlers({
      showOpenDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }),
      showOpenFolderDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    }),
    approvals: approvalHandlers,
    window: createWindowHandlers(() => mainWindow),
    sessionPreview: createSessionPreviewHandlers(sessionsRepo)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
