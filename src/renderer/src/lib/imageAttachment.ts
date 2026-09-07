export interface PastedImage {
  id: string
  dataUrl: string
  mimeType: string
}

/** Longest side, in pixels, a pasted image is allowed to keep before being
 * downscaled -- matches Anthropic's own recommended image size cap, so
 * requests stay fast and cheap regardless of the original screenshot size. */
export const MAX_IMAGE_DIMENSION = 1568

/** Splits a `data:<mime>;base64,<payload>` URL into the shape the SDK's
 * multimodal prompt option and this app's IPC boundary both expect. */
export function splitDataUrl(dataUrl: string): { data: string; mimeType: string } {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl)
  if (!match) throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 32)}`)
  return { mimeType: match[1], data: match[2] }
}

/** Proportionally scales dimensions down so neither exceeds maxDimension;
 * dimensions already within the cap are returned unchanged. */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxDimension: number = MAX_IMAGE_DIMENSION
): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) return { width, height }
  const scale = maxDimension / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Reads a pasted image Blob into a base64 data URL. */
export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image'))
    reader.readAsDataURL(blob)
  })
}

/** Downscales a data URL image to MAX_IMAGE_DIMENSION on its longest side,
 * re-encoding as the same MIME type (preserving PNG for
 * transparency/screenshots, JPEG for photos). Images already within the
 * cap are returned unchanged -- no canvas round-trip, no quality loss. */
export function resizeImageDataUrl(dataUrl: string, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { width, height } = computeScaledDimensions(img.naturalWidth, img.naturalHeight)
      if (width === img.naturalWidth && height === img.naturalHeight) {
        resolve(dataUrl)
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL(mimeType))
    }
    img.onerror = () => reject(new Error('Failed to load pasted image for resizing'))
    img.src = dataUrl
  })
}
