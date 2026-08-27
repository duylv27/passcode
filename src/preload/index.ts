import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ChatEvent, DeviceCodeChallenge } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id)
  },
  session: {
    open: (repoId) => ipcRenderer.invoke('session:open', repoId),
    prompt: (repoId, text) => ipcRenderer.invoke('session:prompt', repoId, text),
    onEvent: (listener) => {
      const wrapped = (_e: unknown, repoId: string, event: ChatEvent): void => listener(repoId, event)
      ipcRenderer.on('session:event', wrapped)
      return () => ipcRenderer.removeListener('session:event', wrapped)
    }
  },
  git: {
    status: (repoId) => ipcRenderer.invoke('git:status', repoId)
  },
  settings: {
    setAnthropicApiKey: (apiKey) => ipcRenderer.invoke('settings:setAnthropicApiKey', apiKey),
    getAuthStatus: () => ipcRenderer.invoke('settings:getAuthStatus'),
    loginCopilot: () => ipcRenderer.invoke('settings:loginCopilot'),
    onCopilotChallenge: (listener) => {
      const wrapped = (_e: unknown, challenge: DeviceCodeChallenge): void => listener(challenge)
      ipcRenderer.on('settings:copilotChallenge', wrapped)
      return () => ipcRenderer.removeListener('settings:copilotChallenge', wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
