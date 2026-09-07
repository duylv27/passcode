# Paste Image into Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user paste a clipboard image (Ctrl+V) into the composer as a removable thumbnail chip, and send it to the agent as real multimodal image content — both live and on resumed history.

**Architecture:** The renderer captures paste events on the composer's `<textarea>`, downscales oversized images via an offscreen canvas, and holds them as `pastedImages` state rendered as thumbnail chips. On send, images cross IPC on the existing `session:prompt` channel as `{ data, mimeType }[]` (a new `PromptOptions.images` field), bypassing the text-injection prompt-builder entirely. The main process forwards them to the SDK's native `AgentSession.prompt(text, { images })` call. History reconstruction (`piSession.ts`'s `buildHistory`) is extended to pull `{ type: 'image' }` content parts back out for resumed sessions, alongside the text it already extracts.

**Tech Stack:** React (renderer), Electron IPC, `@earendil-works/pi-coding-agent` SDK (`AgentSession.prompt`'s `images?: ImageContent[]` option), `HTMLCanvasElement` for client-side resize, Vitest.

## Global Constraints

- Max image dimension: 1568px on the longest side (Anthropic's recommended cap) — from the spec's Goals section.
- No drag-and-drop, no paste outside the composer, no image editing/cropping, no main-process resizing — from the spec's Non-goals section.
- `promptBuilder.ts` must not be touched — images never flow through its text-injection logic.
- This repo has no jsdom/renderer component test harness (`vitest.config.mts` runs `environment: 'node'`) — renderer UI wiring is verified by typecheck + manual interaction, matching the existing pattern (see `tests/renderer/lib/sidebarWidth.test.ts` for the one kind of renderer code that *is* unit-tested: pure, DOM-free helpers).

---

## Task 1: Pure image-attachment helpers

**Files:**
- Create: `src/renderer/src/lib/imageAttachment.ts`
- Test: `tests/renderer/lib/imageAttachment.test.ts`

**Interfaces:**
- Produces: `PastedImage { id: string; dataUrl: string; mimeType: string }`, `MAX_IMAGE_DIMENSION = 1568`, `splitDataUrl(dataUrl: string): { data: string; mimeType: string }`, `computeScaledDimensions(width: number, height: number, maxDimension?: number): { width: number; height: number }`, `readBlobAsDataUrl(blob: Blob): Promise<string>`, `resizeImageDataUrl(dataUrl: string, mimeType: string): Promise<string>` — consumed by Task 5/6's `ChatPanel.tsx` changes and Task 4's `sessionHandlers`-facing code.

- [ ] **Step 1: Write the failing tests for the two pure functions**

Create `tests/renderer/lib/imageAttachment.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/renderer/lib/imageAttachment.test.ts`
Expected: FAIL — `Cannot find module '../../../src/renderer/src/lib/imageAttachment'`

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/lib/imageAttachment.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/renderer/lib/imageAttachment.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/lib/imageAttachment.ts tests/renderer/lib/imageAttachment.test.ts
git commit -m "feat: add pure helpers for pasted-image resize and data URL splitting"
```

---

## Task 2: Shared type additions

**Files:**
- Modify: `src/shared/types.ts:119-127` (`PromptOptions`)
- Modify: `src/shared/types.ts:77-89` (`HistoryItem`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `PromptOptions.images?: { data: string; mimeType: string }[]` (consumed by Task 4's `sessionHandlers.ts` and Task 5's `ChatPanel.tsx`); `HistoryItem`'s `'user'` variant gains `images?: { data: string; mimeType: string }[]` (consumed by Task 3's `buildHistory` and Task 6's `mapHistory`).

- [ ] **Step 1: Edit `PromptOptions`**

In `src/shared/types.ts`, replace:

```typescript
export interface PromptOptions {
  /** Absolute path to the SKILL.md (or skill .md) file, when the user
   * explicitly picked a skill for this turn rather than leaving discovery
   * to the model. */
  skillFilePath?: string
  skillName?: string
  /** Absolute path to a file the user attached as context for this turn. */
  attachedFilePath?: string
}
```

with:

```typescript
export interface PromptOptions {
  /** Absolute path to the SKILL.md (or skill .md) file, when the user
   * explicitly picked a skill for this turn rather than leaving discovery
   * to the model. */
  skillFilePath?: string
  skillName?: string
  /** Absolute path to a file the user attached as context for this turn. */
  attachedFilePath?: string
  /** Images pasted into the composer, sent as real multimodal content via
   * the SDK's own `images` prompt option -- not spliced into prompt text. */
  images?: { data: string; mimeType: string }[]
}
```

- [ ] **Step 2: Edit `HistoryItem`**

Replace:

```typescript
export type HistoryItem =
  | { kind: 'user'; text: string }
  | { kind: 'text'; text: string }
```

with:

```typescript
export type HistoryItem =
  | { kind: 'user'; text: string; images?: { data: string; mimeType: string }[] }
  | { kind: 'text'; text: string }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors (both fields are optional additions; no existing consumer breaks).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add images field to PromptOptions and HistoryItem's user variant"
```

---

## Task 3: `piSession.ts` — forward images to the SDK, reconstruct them from history

**Files:**
- Modify: `src/main/agent/piSession.ts:7-15` (`RepoSession` interface)
- Modify: `src/main/agent/piSession.ts:68-79` (`repoSession.prompt`)
- Modify: `src/main/agent/piSession.ts:83-150` (`buildHistory`, `extractText`)
- Test: `tests/main/agent/piSession.test.ts`

**Interfaces:**
- Consumes: `HistoryItem` from Task 2 (now carries `images?`).
- Produces: `RepoSession.prompt(text: string, images?: ImageContent[]): Promise<void>` — consumed by Task 4's `sessionHandlers.ts`.

- [ ] **Step 1: Update the existing prompt test (it currently fails) and add new failing tests**

This repo's `RepoSession.prompt` already always passes a `{ streamingBehavior: 'steer' }` options object to the underlying SDK call, but the test at line 69-71 still asserts the old single-argument call -- it's currently failing on `master` (verify: `npx vitest run tests/main/agent/piSession.test.ts` shows 1 failure before this task). Fix it in the same edit that adds `images`.

In `tests/main/agent/piSession.test.ts`, replace:

```typescript
    await repoSession.prompt('hello')
    expect(promptMock).toHaveBeenCalledWith('hello')
  })
```

with:

```typescript
    await repoSession.prompt('hello')
    expect(promptMock).toHaveBeenCalledWith('hello', { streamingBehavior: 'steer' })
  })

  it('forwards images to the underlying session alongside the steer behavior', async () => {
    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })
    const images = [{ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/png' }]

    await repoSession.prompt('what is in this screenshot?', images)

    expect(promptMock).toHaveBeenCalledWith('what is in this screenshot?', {
      images,
      streamingBehavior: 'steer'
    })
  })
```

Then add, inside the same `describe('createRepoSession', ...)` block, two new history-reconstruction tests right after the existing `'reconstructs user text, assistant text, and completed tool calls from history'` test (around line 200):

```typescript
  it('reconstructs a pasted image alongside user text', async () => {
    mockMessages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is in this screenshot?' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
        ]
      }
    ]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([
      {
        kind: 'user',
        text: 'what is in this screenshot?',
        images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }]
      }
    ])
  })

  it('omits the images field for a plain-text user turn', async () => {
    mockMessages = [{ role: 'user', content: 'add a health check' }]

    const { repoSession } = await createRepoSession({
      cwd: '/repo/path',
      modelRuntime: {} as never,
      requestApproval: noApproval
    })

    expect(repoSession.getHistory()).toEqual([{ kind: 'user', text: 'add a health check' }])
  })
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run tests/main/agent/piSession.test.ts`
Expected: FAIL — the "reconstructs a pasted image" test fails because `getHistory()` returns `[{ kind: 'user', text: '...' }]` with no `images` key; the "forwards images" test fails because `RepoSession.prompt` doesn't accept a second argument yet (TypeScript will also flag this at the call site once you run typecheck).

- [ ] **Step 3: Implement the `images` parameter and history extraction**

In `src/main/agent/piSession.ts`, add `ImageContent` to the existing `@earendil-works/pi-ai` import:

```typescript
import type { AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ImageContent, Model } from '@earendil-works/pi-ai'
import type { HistoryItem, TokenUsage } from '../../shared/types'
```

Update the `RepoSession` interface:

```typescript
export interface RepoSession {
  prompt(text: string, images?: ImageContent[]): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
  /** The conversation loaded so far -- empty for a brand-new session, populated when resumed. */
  getHistory(): HistoryItem[]
  getModel(): Model<any> | undefined
  setModel(model: Model<any>): Promise<void>
}
```

Update the returned `prompt` implementation:

```typescript
      prompt: (text: string, images?: ImageContent[]) =>
        session.prompt(text, { images, streamingBehavior: 'steer' }),
```

Update `buildHistory`'s user-message branch to also collect image parts:

```typescript
    if (message.role === 'user') {
      // Everything after the delimiter is context injected for the model
      // (a skill's instructions, an attached file's content) -- the
      // transcript only ever shows the short label ahead of it.
      const text = extractText(message.content).split(PROMPT_CONTEXT_DELIMITER)[0]
      const images = extractImages(message.content)
      if (text) items.push({ kind: 'user', text, ...(images.length > 0 ? { images } : {}) })
    } else if (message.role === 'assistant') {
```

Add `extractImages` next to `extractText`:

```typescript
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type: string; text: string } => (part as { type?: string })?.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  return ''
}

function extractImages(content: unknown): { data: string; mimeType: string }[] {
  if (!Array.isArray(content)) return []
  return content
    .filter(
      (part): part is { type: string; data: string; mimeType: string } =>
        (part as { type?: string })?.type === 'image'
    )
    .map((part) => ({ data: part.data, mimeType: part.mimeType }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/agent/piSession.test.ts`
Expected: PASS (17 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/piSession.ts tests/main/agent/piSession.test.ts
git commit -m "feat: forward pasted images to the SDK and reconstruct them from resumed history"
```

---

## Task 4: `sessionHandlers.ts` — pass `PromptOptions.images` through to `RepoSession.prompt`

**Files:**
- Modify: `src/main/ipc/sessionHandlers.ts:200-218` (`sendPrompt`)
- Test: `tests/main/ipc/sessionHandlers.test.ts`

**Interfaces:**
- Consumes: `PromptOptions.images` (Task 2), `RepoSession.prompt(text, images?)` (Task 3).
- Produces: no new public signature -- `sendPrompt`'s signature is unchanged, only its body changes.

- [ ] **Step 1: Write the failing test**

In `tests/main/ipc/sessionHandlers.test.ts`, add this test right after the existing `'builds the prompt text via buildPromptText...'` test (around line 134):

```typescript
  it('converts PromptOptions.images into SDK ImageContent and forwards them to the underlying session', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)
    const options = { images: [{ data: 'aGVsbG8=', mimeType: 'image/png' }] }

    await handlers.sendPrompt(session.id, 'what is this?', options)

    expect(promptMock).toHaveBeenCalledWith('what is this?', [
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
    ])
  })

  it('calls the underlying session prompt with a single argument when there are no images', async () => {
    const session = handlers.createSession(repoId)
    await handlers.openSession(session.id)

    await handlers.sendPrompt(session.id, 'hello')

    expect(promptMock).toHaveBeenCalledWith('hello')
  })
```

- [ ] **Step 2: Run the tests to verify the first one fails**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: FAIL — `promptMock` was called with `('what is this?')` (no images argument), not the expected 2-argument call.

- [ ] **Step 3: Implement**

In `src/main/ipc/sessionHandlers.ts`, replace the body of `sendPrompt`'s try block:

```typescript
      try {
        const session = await ensureSession(sessionId)
        const record = deps.sessionsRepo.getById(sessionId)
        const projectRepos = record?.projectId
          ? deps.reposRepo
              .listByProject(record.projectId)
              .map((r) => ({ name: r.name, path: r.path }))
          : undefined
        const promptText = await deps.buildPromptText(text, { ...options, projectRepos })
        // Images bypass buildPromptText entirely -- they're sent as real
        // multimodal content via the SDK's own `images` option, not spliced
        // into the prompt text. Only pass a second argument when there
        // actually are images, so a plain-text turn's call shape is
        // unchanged.
        if (options?.images && options.images.length > 0) {
          const images = options.images.map((img) => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType
          }))
          await session.prompt(promptText, images)
        } else {
          await session.prompt(promptText)
        }
      } catch (err) {
        deps.onEvent(sessionId, { type: 'error', message: (err as Error).message })
      } finally {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/main/ipc/sessionHandlers.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc/sessionHandlers.ts tests/main/ipc/sessionHandlers.test.ts
git commit -m "feat: forward PromptOptions.images to RepoSession.prompt as SDK ImageContent"
```

---

## Task 5: Composer — capture paste, resize, show removable thumbnail chips

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx:1` (imports)
- Modify: `src/renderer/src/components/ChatPanel.tsx:22-39` (`TranscriptItem` type)
- Modify: `src/renderer/src/components/ChatPanel.tsx:66` (state)
- Modify: `src/renderer/src/components/ChatPanel.tsx:73-89` (`sendNow`)
- Modify: `src/renderer/src/components/ChatPanel.tsx:385-388` (add `handlePaste` near `handleAttachFile`)
- Modify: `src/renderer/src/components/ChatPanel.tsx:515-558` (composer chips JSX + textarea `onPaste`)
- Modify: `src/renderer/src/theme.css` (new `.composer-image-chip` rule)

**Interfaces:**
- Consumes: `PastedImage`, `splitDataUrl`, `readBlobAsDataUrl`, `resizeImageDataUrl` from Task 1's `src/renderer/src/lib/imageAttachment.ts`; `PromptOptions.images` from Task 2.
- Produces: `TranscriptItem`'s `'user'` variant gains `images?: { dataUrl: string }[]`, populated by `sendNow` -- consumed by Task 6's `TranscriptRow`.

- [ ] **Step 1: Add the import and state**

At the top of `src/renderer/src/components/ChatPanel.tsx`, change:

```typescript
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { ChatEvent, HistoryItem, ModelInfo, SessionRecord, SkillInfo, TokenUsage } from '../../../shared/types'
```

to:

```typescript
import { memo, useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react'
import type { ChatEvent, HistoryItem, ModelInfo, SessionRecord, SkillInfo, TokenUsage } from '../../../shared/types'
import { readBlobAsDataUrl, resizeImageDataUrl, splitDataUrl, type PastedImage } from '../lib/imageAttachment'
```

Update the `TranscriptItem` type's `'user'` variant:

```typescript
type TranscriptItem =
  | { kind: 'user'; id: string; text: string; images?: { dataUrl: string }[] }
  | { kind: 'text'; id: string; text: string }
```

Add state next to `attachedFile`:

```typescript
  const [attachedFile, setAttachedFile] = useState<string | null>(null)
  const [pastedImages, setPastedImages] = useState<PastedImage[]>([])
```

- [ ] **Step 2: Wire pasted images into `sendNow`**

Replace `sendNow`:

```typescript
  async function sendNow(text: string): Promise<void> {
    // Matches what the main process actually shows for this turn once
    // history is reconstructed (see promptBuilder.ts's label) -- a skill
    // reference plus the typed text, not the skill's full instructions.
    const label = selectedSkill ? `/${selectedSkill.name} ${text}` : text
    const sentImages = pastedImages.map((img) => ({ dataUrl: img.dataUrl }))
    setItems((prev) => [
      ...prev,
      { kind: 'user', id: newId(), text: label, ...(sentImages.length > 0 ? { images: sentImages } : {}) }
    ])
    setBusy(true)
    setThinking(true)
    const options = {
      skillFilePath: selectedSkill?.filePath,
      skillName: selectedSkill?.name,
      attachedFilePath: attachedFile ?? undefined,
      images: pastedImages.length > 0 ? pastedImages.map((img) => splitDataUrl(img.dataUrl)) : undefined
    }
    setSelectedSkill(null)
    setAttachedFile(null)
    setPastedImages([])
    await window.api.session.prompt(session.id, text, options)
  }
```

- [ ] **Step 3: Add the paste handler**

Right after `handleAttachFile`, add:

```typescript
  async function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const imageItems = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    // Only intercept the paste when it actually carries image data -- a
    // normal text paste must fall through to the textarea's default
    // handling untouched.
    e.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      const dataUrl = await readBlobAsDataUrl(file)
      const resized = await resizeImageDataUrl(dataUrl, file.type)
      setPastedImages((prev) => [...prev, { id: newId(), dataUrl: resized, mimeType: file.type }])
    }
  }
```

- [ ] **Step 4: Render thumbnail chips and wire the textarea**

Replace the composer-chips block:

```jsx
        {(selectedSkill || attachedFile) && (
          <div className="composer-chips">
            {selectedSkill && (
```

with:

```jsx
        {(selectedSkill || attachedFile || pastedImages.length > 0) && (
          <div className="composer-chips">
            {selectedSkill && (
```

...and, right after the existing `{attachedFile && ( ... )}` block (before the closing `</div>` of `composer-chips`), add:

```jsx
            {pastedImages.map((img) => (
              <span key={img.id} className="composer-image-chip">
                <img src={img.dataUrl} alt="Pasted image" />
                <button
                  type="button"
                  className="composer-chip-remove"
                  onClick={() => setPastedImages((prev) => prev.filter((p) => p.id !== img.id))}
                  title="Remove image"
                >
                  ×
                </button>
              </span>
            ))}
```

Add `onPaste` to the `<textarea>`:

```jsx
        <textarea
          ref={composerFieldRef}
          className="composer-field"
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
```

- [ ] **Step 5: Add the thumbnail chip styling**

In `src/renderer/src/theme.css`, right after the existing `.composer-chip-remove:hover` rule (around line 1519), add:

```css
.composer-image-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--list-active);
  border-radius: 8px;
  padding: 2px;
}

.composer-image-chip img {
  width: 36px;
  height: 36px;
  object-fit: cover;
  border-radius: 6px;
  display: block;
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 7: Manual test — paste and remove**

Run the app (`npm run dev`), open a session, copy an image to the clipboard (e.g. a screenshot), click into the composer textarea, press Ctrl+V.
Expected: a small thumbnail chip appears in the composer, next to any skill/file chips, with a working × remove button. Paste a second image; both chips appear and are independently removable. Paste plain text; it lands in the textarea as normal text, unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/theme.css
git commit -m "feat: capture pasted images in the composer as removable thumbnail chips"
```

---

## Task 6: Transcript rendering — sent bubble and resumed history

**Files:**
- Modify: `src/renderer/src/components/ChatPanel.tsx:602-608` (`TranscriptRow`'s `'user'` case)
- Modify: `src/renderer/src/components/ChatPanel.tsx:868-870` (`mapHistory`'s `'user'` branch)
- Modify: `src/renderer/src/theme.css` (new `.turn-user-content` / `.turn-images` / `.turn-image-thumb` rules)

**Interfaces:**
- Consumes: `TranscriptItem`'s `'user'.images` (Task 5), `HistoryItem`'s `'user'.images` (Task 2/3), `useZoomViewer` from `./ZoomViewer` (existing).

- [ ] **Step 1: Add the zoom-viewer hook and render thumbnails in the sent bubble**

`ChatPanel.tsx` already imports `ZoomViewerProvider` from `./ZoomViewer` (it wraps the whole component's render tree, used today by `Markdown.tsx`'s image rendering). Extend that same import line to also bring in the `useZoomViewer` hook:

```typescript
import { ZoomViewerProvider, useZoomViewer } from './ZoomViewer'
```

In `TranscriptRow` (the `memo(function TranscriptRow({ item, streaming }) { ... })` component), add the hook at the top of the function body and replace the `'user'` case:

```typescript
const TranscriptRow = memo(function TranscriptRow({
  item,
  streaming
}: {
  item: SingleItem
  streaming: boolean
}): JSX.Element {
  const { open } = useZoomViewer()

  if (item.kind === 'user') {
    return (
      <div className="chat-line is-user">
        <div className="turn-user-content">
          {item.images && item.images.length > 0 && (
            <div className="turn-images">
              {item.images.map((img, i) => (
                <img
                  key={i}
                  src={img.dataUrl}
                  alt="Pasted image"
                  className="turn-image-thumb"
                  onClick={() => open({ type: 'image', src: img.dataUrl })}
                />
              ))}
            </div>
          )}
          <div className="turn-bubble">{item.text}</div>
        </div>
      </div>
    )
  }
```

- [ ] **Step 2: Reconstruct images when resuming a session**

In `mapHistory`, replace:

```typescript
    if (item.kind === 'user') return { kind: 'user', id: newId(), text: item.text }
```

with:

```typescript
    if (item.kind === 'user') {
      return {
        kind: 'user',
        id: newId(),
        text: item.text,
        ...(item.images && item.images.length > 0
          ? { images: item.images.map((img) => ({ dataUrl: `data:${img.mimeType};base64,${img.data}` })) }
          : {})
      }
    }
```

- [ ] **Step 3: Add the sent-bubble thumbnail styling**

In `src/renderer/src/theme.css`, right after the existing `.turn-bubble` rule (around line 891), add:

```css
.turn-user-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 85%;
}

.turn-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.turn-image-thumb {
  max-width: 220px;
  max-height: 160px;
  border-radius: 10px;
  cursor: zoom-in;
  object-fit: cover;
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: no errors

- [ ] **Step 5: Manual test — send, resize check, and history resume**

With the app running:
1. Paste an image, send a message with it. Expected: the sent bubble shows the thumbnail above the text, and the agent's response indicates it can see the image.
2. Click the sent thumbnail. Expected: the existing zoom viewer overlay opens on it (same as clicking a Markdown image), with working zoom in/out/reset and Escape-to-close.
3. Paste a screenshot larger than 1568px in either dimension (e.g. a 4K screenshot). Add a temporary `console.log` in `resizeImageDataUrl`'s `img.onload` to confirm the computed `{ width, height }` are capped correctly, then remove the log.
4. Send a message with a pasted image, close the session's tab, reopen it (or restart the app and reopen the session). Expected: the pasted image still renders in the historical transcript, in the same position as it did live.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/ChatPanel.tsx src/renderer/src/theme.css
git commit -m "feat: render pasted images in sent and resumed chat turns"
```
