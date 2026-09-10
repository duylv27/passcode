# @-Mention Fuzzy File Search — Design Spec

## Goal

Typing `@` in the composer opens a dropup panel of repo files, fuzzy-matched
as the user keeps typing, replacing the native-OS-dialog-only way of
attaching a file as context today.

## Scope

- **In scope:** a `@`-triggered dropup file picker using subsequence fuzzy
  matching (VS Code Quick-Open style) over the current repo's file list.
- **Out of scope:** true semantic/embedding-based search (explicitly
  declined in favor of the lighter fuzzy approach) and multi-file mentions
  in one message (PassCode's `attachedFile`/`PromptOptions.attachedFilePath`
  is single-file today; this feature stays single-file, just adds a faster
  way to pick that one file). Both are candidate follow-ups, not part of
  this spec.

## Backend: listing files

No existing reusable file-listing utility exists in this codebase or in
`@earendil-works/pi-coding-agent`'s public API (`find`/`ls` tool logic is
internal to the SDK's bundled tool implementations). New `filesHandlers.ts`
method:

```ts
listRepoFiles(repoId: string): Promise<string[]>
```

Implementation spawns the bundled `fd` binary already present at
`~/.pi/agent/bin/fd.exe` (confirmed present on this machine; same binary the
SDK's own `find` tool already relies on) against the repo's path, which
natively respects `.gitignore`. Returns repo-relative paths. Cached
in-memory per `repoId` with no TTL — invalidated only by re-fetching when
the picker opens after more than e.g. 30s since the last fetch, since a
repo's file tree doesn't change every keystroke. `fd` not found/binary
missing falls back to an empty list (feature degrades to "no matches"
rather than crashing).

## Fuzzy matching (renderer-side)

A small local scoring function (no new dependency): for a query `q` and
candidate path `p`, check `q`'s characters appear in `p` in order
(case-insensitive), scoring by how contiguous/early the matched characters
are (denser, earlier matches rank higher) — the standard Quick-Open
algorithm. Runs client-side over the cached file list on every keystroke
(a repo's file count is small enough that this needs no debouncing or
worker thread). Non-matches are excluded entirely; results capped to the
top 20 by score.

## UI

- Composer: typing `@` opens the dropdown (mirrors the existing `/`-skills
  autocomplete's trigger/state pattern in `ChatPanel.tsx` — `slashQuery`
  becomes an equivalent `atQuery`). Text after `@` up to the next
  whitespace is the query; matches update live.
- Panel styling: dropup (`bottom: calc(100% + 4px)`, matching
  `.model-picker-menu`/`ThinkingSlider`'s existing pattern), thin and
  minimal — a plain list of file paths, no icons/previews, low visual
  weight (light background, small text), capped height with internal
  scroll for >20 results (though results are already capped at 20).
- Selecting a file (click or Enter on the highlighted row) sets
  `attachedFile` to that path and closes the panel and clears the `@query`
  from the composer text — same downstream behavior as picking a file via
  the existing "+" button today, since this is a faster on-ramp to the same
  single-file-attach mechanism, not a new one.
- Escape closes the panel without attaching anything, leaving the typed
  `@query` text in the composer as plain text.
- No matches: panel shows a single muted "No matching files" row rather
  than disappearing (avoids a jarring pop-in/out while still typing).

## Testing

- Backend: unit test for the fuzzy-scoring function's ordering (exact
  prefix match ranks above a scattered subsequence match; a query with a
  character not present in the candidate excludes it).
- `listRepoFiles`: unit test with a fake `fd` invocation returning a fixed
  file list, and the empty-list fallback when the binary path doesn't
  resolve.
- No test for the live keystroke-driven UI interaction itself (consistent
  with this codebase's existing convention of not testing `ChatPanel.tsx`'s
  interactive behavior directly).
