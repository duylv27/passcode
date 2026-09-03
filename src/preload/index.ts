import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ApprovalRequest, ChatEvent, DeviceCodeChallenge, ToolApprovalPolicy } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    delete: (id) => ipcRenderer.invoke('projects:delete', id)
  },
  repos: {
    add: (projectId, path) => ipcRenderer.invoke('repos:add', projectId, path),
    list: (projectId) => ipcRenderer.invoke('repos:list', projectId),
    delete: (id) => ipcRenderer.invoke('repos:delete', id),
    gitStatus: (id) => ipcRenderer.invoke('repos:gitStatus', id)
  },
  session: {
    list: (repoId) => ipcRenderer.invoke('session:list', repoId),
    create: (repoId, title) => ipcRenderer.invoke('session:create', repoId, title),
    getMostRecent: () => ipcRenderer.invoke('session:getMostRecent'),
    listByProject: (projectId) => ipcRenderer.invoke('session:listByProject', projectId),
    createProjectSession: (projectId, title) =>
      ipcRenderer.invoke('session:createProjectSession', projectId, title),
    rename: (sessionId, title) => ipcRenderer.invoke('session:rename', sessionId, title),
    delete: (sessionId) => ipcRenderer.invoke('session:delete', sessionId),
    open: (sessionId) => ipcRenderer.invoke('session:open', sessionId),
    prompt: (sessionId, text, options) => ipcRenderer.invoke('session:prompt', sessionId, text, options),
    abort: (sessionId) => ipcRenderer.invoke('session:abort', sessionId),
    setModel: (sessionId, provider, modelId) =>
      ipcRenderer.invoke('session:setModel', sessionId, provider, modelId),
    onEvent: (listener) => {
      const wrapped = (_e: unknown, sessionId: string, event: ChatEvent): void => listener(sessionId, event)
      ipcRenderer.on('session:event', wrapped)
      return () => ipcRenderer.removeListener('session:event', wrapped)
    }
  },
  models: {
    list: () => ipcRenderer.invoke('models:list')
  },
  skills: {
    list: (repoId) => ipcRenderer.invoke('skills:list', repoId)
  },
  files: {
    pickFile: () => ipcRenderer.invoke('files:pickFile')
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
  },
  approvals: {
    getPolicy: () => ipcRenderer.invoke('approvals:getPolicy'),
    setPolicy: (policy: ToolApprovalPolicy) => ipcRenderer.invoke('approvals:setPolicy', policy),
    respond: (requestId, approved) => ipcRenderer.invoke('approvals:respond', requestId, approved),
    onRequest: (listener) => {
      const wrapped = (_e: unknown, request: ApprovalRequest): void => listener(request)
      ipcRenderer.on('approvals:request', wrapped)
      return () => ipcRenderer.removeListener('approvals:request', wrapped)
    }
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (listener) => {
      const wrapped = (_e: unknown, maximized: boolean): void => listener(maximized)
      ipcRenderer.on('window:maximizeChanged', wrapped)
      return () => ipcRenderer.removeListener('window:maximizeChanged', wrapped)
    }
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion')
  }
}

contextBridge.exposeInMainWorld('api', api)
