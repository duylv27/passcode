import { describe, it, expect } from 'vitest'
import { splitDataUrl, computeScaledDimensions, MAX_IMAGE_DIMENSION } from '../../../src/renderer/src/lib/imageAttachment'

describe('splitDataUrl', () => {
  it('splits a base64 data URL into its mime type and payload', () => {
    expect(splitDataUrl('data:image/png;base64,aGVsbG8=')).toEqual({
      mimeType: 'image/png',
      data: 'aGVsbG8='
    })
  })

  it('handles mime types with a plus sign, like image/svg+xml', () => {
    expect(splitDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toEqual({
      mimeType: 'image/svg+xml',
      data: 'PHN2Zz4='
    })
  })

  it('throws when given a non-data URL', () => {
    expect(() => splitDataUrl('https://example.com/cat.png')).toThrow()
  })
})

describe('computeScaledDimensions', () => {
  it('leaves dimensions already within the cap untouched', () => {
    expect(computeScaledDimensions(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('leaves dimensions exactly at the cap untouched', () => {
    expect(computeScaledDimensions(MAX_IMAGE_DIMENSION, 400)).toEqual({
      width: MAX_IMAGE_DIMENSION,
      height: 400
    })
  })

  it('scales a wide image down so the longest side hits the cap', () => {
    // 3136 x 1000 -> longest side (width) must become 1568, height halves too
    expect(computeScaledDimensions(3136, 1000)).toEqual({ width: 1568, height: 500 })
  })

  it('scales a tall image down so the longest side hits the cap', () => {
    expect(computeScaledDimensions(1000, 3136)).toEqual({ width: 500, height: 1568 })
  })

  it('respects a custom maxDimension', () => {
    expect(computeScaledDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 })
  })
})
