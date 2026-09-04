export interface FilesHandlersDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  showOpenFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface FilesHandlers {
  pickFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
}

export function createFilesHandlers(deps: FilesHandlersDeps): FilesHandlers {
  return {
    async pickFile(): Promise<string | null> {
      const result = await deps.showOpenDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
    async pickFolder(): Promise<string | null> {
      const result = await deps.showOpenFolderDialog()
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  }
}
