import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ApprovalRequest, ChatEvent, PassportOAuthPrompt, ToolApprovalPolicy, UiPromptRequest } from '../shared/types'

const api: Api = {
  projects: {
    create: (name) => ipcRenderer.invoke('projects:create', name),
    list: () => ipcRenderer.invoke('projects:list'),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
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
    listAll: () => ipcRenderer.invoke('session:listAll'),
    listByProject: (projectId) => ipcRenderer.invoke('session:listByProject', projectId),
    createProjectSession: (projectId, title) =>
      ipcRenderer.invoke('session:createProjectSession', projectId, title),
    createGeneralSession: (title) => ipcRenderer.invoke('session:createGeneralSession', title),
    rename: (sessionId, title) => ipcRenderer.invoke('session:rename', sessionId, title),
    setBookmarked: (sessionId, bookmarked) => ipcRenderer.invoke('session:setBookmarked', sessionId, bookmarked),
    delete: (sessionId) => ipcRenderer.invoke('session:delete', sessionId),
    open: (sessionId) => ipcRenderer.invoke('session:open', sessionId),
    prompt: (sessionId, text, options) => ipcRenderer.invoke('session:prompt', sessionId, text, options),
    abort: (sessionId) => ipcRenderer.invoke('session:abort', sessionId),
    setModel: (sessionId, provider, modelId) =>
      ipcRenderer.invoke('session:setModel', sessionId, provider, modelId),
    compact: (sessionId) => ipcRenderer.invoke('session:compact', sessionId),
    getAutoCompactionEnabled: (sessionId) => ipcRenderer.invoke('session:getAutoCompactionEnabled', sessionId),
    setAutoCompactionEnabled: (sessionId, enabled) =>
      ipcRenderer.invoke('session:setAutoCompactionEnabled', sessionId, enabled),
    getCompactionThresholds: (sessionId) => ipcRenderer.invoke('session:getCompactionThresholds', sessionId),
    setContextWindowOverride: (sessionId, contextWindow) =>
      ipcRenderer.invoke('session:setContextWindowOverride', sessionId, contextWindow),
    getSessionStats: (sessionId) => ipcRenderer.invoke('session:getSessionStats', sessionId),
    getThinkingInfo: (sessionId) => ipcRenderer.invoke('session:getThinkingInfo', sessionId),
    setThinkingLevel: (sessionId, level) => ipcRenderer.invoke('session:setThinkingLevel', sessionId, level),
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
    pickFile: () => ipcRenderer.invoke('files:pickFile'),
    pickFolder: () => ipcRenderer.invoke('files:pickFolder'),
    listRepoFiles: (repoId) => ipcRenderer.invoke('files:listRepoFiles', repoId)
  },
  settings: {
    getCopilotQuota: () => ipcRenderer.invoke('settings:getCopilotQuota'),
    getUsageTelemetryConfig: () => ipcRenderer.invoke('settings:getUsageTelemetryConfig'),
    setUsageTelemetryConfig: (config) => ipcRenderer.invoke('settings:setUsageTelemetryConfig', config)
  },
  passports: {
    list: () => ipcRenderer.invoke('passports:list'),
    createApiKey: (providerId, displayName, apiKey) =>
      ipcRenderer.invoke('passports:createApiKey', providerId, displayName, apiKey),
    createOAuth: (providerId, displayName) => ipcRenderer.invoke('passports:createOAuth', providerId, displayName),
    onOAuthPrompt: (listener) => {
      const wrapped = (_e: unknown, prompt: PassportOAuthPrompt): void => listener(prompt)
      ipcRenderer.on('passports:oauthPrompt', wrapped)
      return () => ipcRenderer.removeListener('passports:oauthPrompt', wrapped)
    },
    submitOAuthCode: (code) => ipcRenderer.invoke('passports:submitOAuthCode', code),
    cancelOAuth: () => ipcRenderer.invoke('passports:cancelOAuth'),
    setActive: (id) => ipcRenderer.invoke('passports:setActive', id),
    rename: (id, displayName) => ipcRenderer.invoke('passports:rename', id, displayName),
    remove: (id) => ipcRenderer.invoke('passports:remove', id)
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
  uiPrompts: {
    respond: (requestId, value) => ipcRenderer.invoke('uiPrompt:respond', requestId, value),
    onRequest: (listener) => {
      const wrapped = (_e: unknown, request: UiPromptRequest): void => listener(request)
      ipcRenderer.on('uiPrompt:request', wrapped)
      return () => ipcRenderer.removeListener('uiPrompt:request', wrapped)
    },
    onCancel: (listener) => {
      const wrapped = (_e: unknown, requestId: string): void => listener(requestId)
      ipcRenderer.on('uiPrompt:cancel', wrapped)
      return () => ipcRenderer.removeListener('uiPrompt:cancel', wrapped)
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
  },
  sessionPreview: {
    get: (sessionId) => ipcRenderer.invoke('sessionPreview:get', sessionId)
  }
}

contextBridge.exposeInMainWorld('api', api)
