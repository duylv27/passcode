import { describe, it, expect } from 'vitest'
import {
  clampSidebarWidth,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DEFAULT_WIDTH
} from '../../../src/renderer/src/lib/sidebarWidth'

describe('clampSidebarWidth', () => {
  it('leaves an in-range width untouched', () => {
    expect(clampSidebarWidth(200)).toBe(200)
  })

  it('clamps below the minimum up to the minimum', () => {
    expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH)
  })

  it('clamps above the maximum down to the maximum', () => {
    expect(clampSidebarWidth(1000)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('clamps a value exactly at the bounds to itself', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH)
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH)).toBe(SIDEBAR_MAX_WIDTH)
  })

  it('falls back to the default width for a corrupted (NaN) value instead of propagating NaN', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})
