import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createSessionsRepository } from './db/sessionsRepository'
import { createAppSettingsRepository } from './db/appSettingsRepository'
import { createPassportsRepository } from './db/passportsRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { createSessionHandlers } from './ipc/sessionHandlers'
import { createSettingsHandlers } from './ipc/settingsHandlers'
import { createPassportHandlers } from './ipc/passportHandlers'
import { migratePassportsFromLegacyAuth } from './passports/migratePassports'
import { getAuthMethodHandler } from './passports/authMethodHandlers'
import { createApprovalHandlers } from './ipc/approvalHandlers'
import { createUiPromptHandlers } from './ipc/uiPromptHandlers'
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
  const passportsRepo = createPassportsRepository(db)

  const { ModelRuntime, ModelRegistry } = await import('@earendil-works/pi-coding-agent')
  const modelRuntime: ModelRuntime = await ModelRuntime.create()
  // One-time: copy any pre-Passports credential into a real passports row.
  await migratePassportsFromLegacyAuth({
    appSettingsRepo,
    passportsRepo,
    checkAuth: (providerId) => modelRuntime.checkAuth(providerId)
  })
  // setRuntimeApiKey()/OAuth credentials are in-memory-only or SDK-owned --
  // replay every currently-active api_key passport's activation so it
  // takes effect again after this restart (an active oauth passport needs
  // no replay: its handler's activate() is a no-op, and the SDK's own
  // credential store already persisted the real tokens).
  for (const passport of passportsRepo.list()) {
    if (passport.isActive) await getAuthMethodHandler(passport.authMethod).activate(passport, modelRuntime)
  }
  const modelRegistry = new ModelRegistry(modelRuntime)
  await modelRegistry.refresh()
  const modelsHandlers = createModelsHandlers(modelRegistry)

  // Backing store for project-less "general" sessions -- a repo row always
  // needs a real project_id (schema FK, NOT NULL), so this hidden project +
  // one scratch-directory repo is created once (lazily, on first use) and
  // remembered rather than recreated every time. Excluded from
  // projectsHandlers' listProjects() so it never appears as a real project.
  async function ensureGeneralRepo(): Promise<{ projectId: string; repoId: string }> {
    const stored = appSettingsRepo.getGeneralRepo()
    if (stored && reposRepo.getById(stored.repoId)) return stored
    const scratchDir = join(app.getPath('userData'), 'general-scratch')
    await mkdir(scratchDir, { recursive: true })
    const project = projectsRepo.create('General')
    const repo = reposRepo.create(project.id, scratchDir, 'General')
    const info = { projectId: project.id, repoId: repo.id }
    appSettingsRepo.setGeneralRepo(info)
    return info
  }

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

  const uiPromptHandlers = createUiPromptHandlers({
    onRequest: (request) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('uiPrompt:request', request)
    },
    onCancel: (requestId) => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('uiPrompt:cancel', requestId)
    }
  })

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo, () => appSettingsRepo.getGeneralRepo()?.projectId),
    repos: createReposHandlers(reposRepo, isGitRepo, getGitStatus),
    session: createSessionHandlers({
      reposRepo,
      projectsRepo,
      sessionsRepo,
      openRepoSession: (cwd, requestApproval, uiPrompts, resumeSessionFile) =>
        createRepoSession({
          cwd,
          modelRuntime,
          requestApproval,
          requestSelect: uiPrompts.requestSelect,
          requestConfirm: uiPrompts.requestConfirm,
          requestInput: uiPrompts.requestInput,
          notify: uiPrompts.notify,
          resumeSessionFile
        }),
      onEvent: (sessionId, event) => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('session:event', sessionId, event)
      },
      requestApproval: (sessionId, toolName, input) =>
        approvalHandlers.requestApproval(sessionId, toolName, input),
      requestSelect: (sessionId, title, options, timeoutMs, signal) =>
        uiPromptHandlers.requestSelect(sessionId, title, options, timeoutMs, signal),
      requestConfirm: (sessionId, title, message, timeoutMs, signal) =>
        uiPromptHandlers.requestConfirm(sessionId, title, message, timeoutMs, signal),
      requestInput: (sessionId, title, placeholder, timeoutMs, signal) =>
        uiPromptHandlers.requestInput(sessionId, title, placeholder, timeoutMs, signal),
      findModel: (provider, modelId) => modelRegistry.find(provider, modelId),
      buildPromptText,
      getUsageTelemetryConfig: () => appSettingsRepo.getUsageTelemetryConfig(),
      recordPassportUsage: (providerId, usage) => passportsRepo.recordUsageForActiveProvider(providerId, usage),
      ensureGeneralRepo
    }),
    settings: createSettingsHandlers(appSettingsRepo),
    passports: createPassportHandlers(passportsRepo, modelRuntime, (url) => shell.openExternal(url), async (providerIds) => {
      await modelRegistry.refresh(providerIds ? { providers: providerIds } : undefined)
      modelsHandlers.invalidate()
    }),
    models: modelsHandlers,
    skills: createSkillsHandlers(reposRepo),
    files: createFilesHandlers(
      {
        showOpenDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openFile'] }),
        showOpenFolderDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
      },
      reposRepo
    ),
    approvals: approvalHandlers,
    uiPrompts: uiPromptHandlers,
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
