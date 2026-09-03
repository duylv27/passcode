export const SIDEBAR_MIN_WIDTH = 150
export const SIDEBAR_MAX_WIDTH = 400
export const SIDEBAR_DEFAULT_WIDTH = 180
export const SIDEBAR_WIDTH_KEY = 'passcode-sidebar-width'

export function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))
}
