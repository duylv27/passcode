# Paste Image into Composer — Design

## Problem

The composer has a paperclip "Attach a file" button, but it only supports text files —
`promptBuilder.ts` reads the picked file as UTF-8 text and splices its content into the
prompt string as a code block. There's no way to share a screenshot or image with the
agent; the only workaround is dropping an image's file path in as if it were a text
attachment, which would either fail to read as UTF-8 or send garbage binary content. The
underlying SDK (`@earendil-works/pi-coding-agent`) already supports real multimodal
prompts — `AgentSession.prompt(text, { images: ImageContent[] })`, where
`ImageContent = { type: 'image'; data: string /* base64 */; mimeType: string }` — but
nothing in this app calls that path today.

## Goals

- Paste (Ctrl+V) an image from the clipboard directly into the composer; it appears as a
  removable thumbnail chip, distinct from the existing filename-style attachment chip.
- Support multiple pasted images per message — each paste adds another thumbnail, each
  individually removable, all sent together on Send.
- Large images are downscaled client-side (max 1568px on the longest side, matching
  Anthropic's own recommended cap) before ever leaving the composer, so requests stay fast
  and cheap regardless of how large the original screenshot/photo was.
- Pasted images use the SDK's native multimodal `images` prompt option — not the existing
  text-injection attachment mechanism — so the model receives them as real image content,
  not a garbled text blob.
- A pasted image shows correctly both in the live turn it was sent in, and when a session
  is closed and reopened later (history resume) — the SDK's own session-file persistence
  already saves image content parts automatically (the same mechanism that already
  persists text turns); the gap is purely in this app's own history-reconstruction code,
  which currently drops non-text content parts.

## Non-goals

- No drag-and-drop of image files onto the composer — paste only, this pass. Can be a
  follow-up if wanted; it would reuse the same underlying image-attachment plumbing.
- No pasting images anywhere but the composer (e.g. not into settings, not into a rename
  field).
- No image editing, cropping, or annotation before sending.
- No change to the existing text-file attachment mechanism (`window.api.files.pickFile` +
  `attachedFilePath`) — it continues to work exactly as it does today, running in parallel
  with this new image path. The paperclip button and pasted-image chips are two visually
  and mechanically distinct attachment types.
- No server-side (main-process) image resizing — resizing happens in the renderer, before
  the image ever crosses IPC, so the main process and the SDK only ever see
  already-bounded payloads.

## Approach

### Capture & preview (renderer)

`ChatPanel.tsx`'s composer `<input>` gains an `onPaste` handler. Standard paste events with
image data fire on a plain `<input>` in Electron's Chromium renderer — no need to switch to
a `<textarea>` or a contentEditable div. The handler reads `event.clipboardData.items`,
filters for `image/*` MIME types, and for each match reads the `Blob` via `FileReader` (or
`createImageBitmap`, whichever proves simpler in implementation) into a new
`pastedImages: PastedImage[]` state array, where
`PastedImage = { id: string; dataUrl: string; mimeType: string }`. Each entry renders as a
small square thumbnail (`<img>` from the data URL) in the existing composer-chips row,
styled distinctly from the filename-style skill/file chips already there, each with its own
×-remove button. Multiple pastes accumulate; there is no hard cap on count in this pass.

### Resize (renderer, before state)

Before an image is added to `pastedImages`, it's drawn to an offscreen `<canvas>`: if
either dimension exceeds 1568px, both are scaled down proportionally so the longest side is
exactly 1568px. The canvas is then re-encoded via `toDataURL(mimeType)` using the pasted
image's original MIME type (preserving PNG for transparency/text-heavy screenshots, JPEG
for photos) — images already under the cap pass through unresized. No new dependencies;
`HTMLCanvasElement` is a standard renderer-available API.

### IPC / data flow

`PromptOptions` (`src/shared/types.ts`) gains an optional field:

```typescript
export interface PromptOptions {
  skillFilePath?: string
  skillName?: string
  attachedFilePath?: string
  images?: { data: string; mimeType: string }[]
}
```

`ChatPanel.tsx`'s `sendNow()` extracts the base64 payload (stripping the `data:<mime>;base64,`
prefix) and mime type from each `pastedImages` entry into this field, alongside the existing
`skillFilePath`/`attachedFilePath`, and clears `pastedImages` after sending — mirroring
exactly how `attachedFile` is already handled. This reuses the existing `session:prompt` IPC
channel; no new channel is added.

### Prompt building — bypasses the text-injection hack

`promptBuilder.ts` is untouched — images never flow through its context-injection logic,
since that mechanism (reading a file as UTF-8 text and splicing it into the prompt string)
is fundamentally the wrong shape for binary image data. Instead:

- `src/main/ipc/sessionHandlers.ts`'s `sendPrompt` passes `options?.images` through to
  `session.prompt(promptText, options.images)` (its own `RepoSession.prompt` signature,
  not the raw SDK call).
- `src/main/agent/piSession.ts`'s `RepoSession.prompt` gains an `images` parameter:
  `prompt(text: string, images?: ImageContent[]): Promise<void>`, and forwards it to the
  underlying SDK call: `session.prompt(text, { images, streamingBehavior: 'steer' })`,
  converting this app's `{ data, mimeType }` shape into the SDK's `ImageContent`
  (`{ type: 'image', data, mimeType }`) at that boundary.

### Transcript rendering — live send

`ChatPanel.tsx`'s `TranscriptItem`'s `'user'` variant gains an optional
`images?: { dataUrl: string }[]` field. `sendNow()`'s optimistic local push
(`setItems((prev) => [...prev, { kind: 'user', ... }])`) includes the just-sent
`pastedImages`' data URLs, so the sent bubble shows thumbnails immediately, before any
history round-trip.

### Transcript rendering — resumed history

The SDK's own `SessionManager` already persists full message content (including
`ImageContent` parts) to the session file automatically, the same mechanism that already
persists text turns — this needs no new code. The gap is `piSession.ts`'s `buildHistory()`
and its `extractText()` helper, which today only collects `{ type: 'text' }` parts from a
user message's content array, silently discarding anything else. `buildHistory()`'s
user-message branch is extended to also collect `{ type: 'image' }` parts from
`message.content` into the reconstructed `HistoryItem`'s new `images` field (parallel to the
existing text extraction, not a replacement of it).

`shared/types.ts`'s `HistoryItem`'s `'user'` variant gains the matching optional
`images?: { data: string; mimeType: string }[]` field, and `ChatPanel.tsx`'s history-to-item
mapping (where `TranscriptItem`s are built from `HistoryItem`s on session open) carries it
through, converting `{ data, mimeType }` into a displayable `dataUrl` for the same thumbnail
rendering used by the live-send path.

### `TranscriptRow`'s `is-user` case

Renders the new `images` array (if present) as a small row of thumbnails above the existing
text bubble, reusing the same thumbnail styling as the composer's pending-image chips (sized
for a sent/historical message rather than a pending one).

## Testing

- Manual: paste a single screenshot into the composer, confirm a removable thumbnail chip
  appears; send, confirm the thumbnail appears in the sent bubble and the agent's response
  indicates it can see the image's content.
- Manual: paste two different images before sending, confirm both thumbnails appear and
  both are removable independently; remove one, confirm only the remaining one sends.
- Manual: paste an image larger than 1568px in either dimension, confirm (via a quick
  console/log check during development, not a permanent UI indicator) that the resized
  data URL's dimensions are capped correctly.
- Manual: send a message with a pasted image, close the session tab, reopen it (or restart
  the app and reopen the session), confirm the pasted image still renders in the historical
  transcript.
- Manual: paste plain text (not an image) into the composer, confirm normal text-paste
  behavior is unaffected (the `onPaste` handler must not interfere with non-image clipboard
  content).
- `npm test` (vitest) for any new pure logic extracted during implementation (e.g. a
  data-URL-to-base64/mimetype splitting helper) — UI wiring itself is exercised manually,
  consistent with this repo's existing renderer test coverage pattern (no jsdom in this
  repo; renderer changes are verified by typecheck + manual interaction, not automated
  component tests).
