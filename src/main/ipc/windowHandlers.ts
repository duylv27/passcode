import type { BrowserWindow } from 'electron'

export interface WindowHandlers {
  minimize(): void
  toggleMaximize(): void
  close(): void
  isMaximized(): boolean
}

// Takes a getter rather than the BrowserWindow directly -- main/index.ts
// reassigns its window reference on 'activate' (e.g. after the last window
// closes on non-mac and a new one is created), so handlers must always
// resolve the *current* window, not the one that existed when they were
// constructed.
export function createWindowHandlers(getWindow: () => BrowserWindow): WindowHandlers {
  return {
    minimize() {
      getWindow().minimize()
    },
    toggleMaximize() {
      const win = getWindow()
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    },
    close() {
      getWindow().close()
    },
    isMaximized() {
      return getWindow().isMaximized()
    }
  }
}
