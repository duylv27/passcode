import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/db'
import { createProjectsRepository } from './db/projectsRepository'
import { createReposRepository } from './db/reposRepository'
import { createProjectsHandlers } from './ipc/projectsHandlers'
import { createReposHandlers } from './ipc/reposHandlers'
import { registerIpcHandlers } from './ipc/register'
import { isGitRepo } from './git/gitStatus'

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

app.whenReady().then(() => {
  const db = openDatabase(join(app.getPath('userData'), 'pi-agent.db'))
  const projectsRepo = createProjectsRepository(db)
  const reposRepo = createReposRepository(db)

  registerIpcHandlers({
    projects: createProjectsHandlers(projectsRepo),
    repos: createReposHandlers(reposRepo, isGitRepo)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
