import { readFile } from 'node:fs/promises'

interface SessionMessageLine {
  type?: string
  message?: { role?: string; content?: unknown }
}

const PREVIEW_MAX_CHARS = 140

/** A short excerpt of the most recent user/assistant message in a saved
 * session file, for list-row previews -- reads the file directly rather
 * than opening the session through the Pi SDK, since resuming a session
 * (spinning up tools, resource loaders, etc.) is far too heavy to do for
 * every row in a sidebar list. Returns null if the session has never been
 * opened (no file yet) or has no text message to show. */
export async function getSessionPreview(sessionFile: string | undefined): Promise<string | null> {
  if (!sessionFile) return null
  let content: string
  try {
    content = await readFile(sessionFile, 'utf-8')
  } catch {
    return null
  }

  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) continue
    let entry: SessionMessageLine
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type !== 'message') continue
    const role = entry.message?.role
    if (role !== 'user' && role !== 'assistant') continue
    const text = extractText(entry.message?.content)
    if (text) return truncate(text)
  }
  return null
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      const p = part as { type?: string; text?: string }
      if (p.type === 'text' && p.text) return p.text
    }
  }
  return null
}

function truncate(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > PREVIEW_MAX_CHARS ? `${oneLine.slice(0, PREVIEW_MAX_CHARS)}…` : oneLine
}
